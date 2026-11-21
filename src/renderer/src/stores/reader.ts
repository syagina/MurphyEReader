import { create } from 'zustand';
import { TRANSLATION_REPAIRED_NOTICE } from '@shared/translation';
import { PDF_VERSION_LABELS } from '@shared/sticky-notes';
import type { Paper, PdfVersion, StickyNoteRect } from '@shared/types';
import { errorMessage } from '../lib/errors';
import { clampPage } from '../lib/pdf';
import { invalidatePaper, keyFor, peek } from '../lib/pdf-document-cache';
import {
  clampOffset,
  mapReadingPosition,
  pageCountFor,
  positionAt,
} from '../lib/reading-position';
import type { ReadingPosition } from '../lib/reading-position';
import { useLibraryStore } from './library';

export interface ReaderSelection {
  text: string;
  pageNo: number;
  version: PdfVersion;
  /** Selection rectangles normalized to the page wrapper. */
  rects: StickyNoteRect[];
}

export interface ReaderState {
  paperId: number | null;
  version: PdfVersion;
  pageCount: number;
  currentPage: number;
  currentOffset: number;
  /**
   * Incremented only for programmatic position changes (open restore, version
   * switch, jump). Scrolling updates the position without touching it, so the
   * viewer can key its restore effect on it.
   */
  positionSeq: number;
  zoom: number;
  error: string | null;
  selection: ReaderSelection | null;
  /**
   * The version whose load failed last, when known. The error panel's
   * relocation action targets it instead of the version currently displayed.
   */
  failedVersion: PdfVersion | null;
  /**
   * One-shot message shown above the PDF after an incomplete managed
   * translation was silently rebound to its complete dual output.
   */
  versionNotice: string | null;
  /**
   * One-shot start page requested for a paper that is about to open. The App
   * stores it before switching papers; the viewer's own `open` consumes it.
   * It never mutates the current session, unlike calling `open` directly.
   */
  pendingInitialPage: { paperId: number; page: number } | null;
  /**
   * Opens a paper in the reader. `initialPage`, when given (e.g. a global
   * search hit), forces the original layout at that page. Otherwise the last
   * used version, page and intra-page offset are restored.
   */
  open(paperId: number, initialPage?: number): Promise<void>;
  /** Requests the page `open(paperId)` should restore; consumed by that open. */
  requestInitialPage(paperId: number, page: number): void;
  /**
   * Drops a pending one-shot page request, e.g. when its result click was
   * superseded before the viewer could consume it.
   */
  clearInitialPage(): void;
  /**
   * Switches the open reader between the original PDF and either translated
   * layout. The current reading progress is mapped onto the target layout
   * instead of using that layout's historical page.
   */
  setVersion(version: PdfVersion): Promise<void>;
  /** Hides the auto-repair notice until another translation is repaired. */
  dismissVersionNotice(): void;
  close(): void;
  /** Records the position under the reading area's top edge (scroll path). */
  setCurrentPosition(page: number, offset: number): void;
  /** Programmatic page jump; resets the intra-page offset and restores scroll. */
  jumpToPage(page: number): void;
  setZoom(z: number): void;
  setSelection(sel: ReaderSelection | null): void;
  /** Flushes a throttled position write; resolves after the IPC call. */
  flushPosition(): Promise<void>;
  /**
   * Called by PdfViewer after PDF.js reports the real page count. Corrects a
   * provisional legacy bilingual count and completes a deferred mapping.
   */
  adoptDocumentPageCount(numPages: number): void;
  /**
   * Extension for PDF viewer load failures (missing/corrupt files): the viewer
   * mirrors its local error here so other panels can see that reading failed.
   * A non-null message marks the current version as failed; null clears both.
   */
  setError(message: string | null): void;
}

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;
const POSITION_WRITE_INTERVAL_MS = 500;
const OFFSET_EPSILON = 1e-6;

/**
 * Monotonic generation for `open` and `setVersion`. Overlapping document
 * switches are possible when the user acts quickly; only the newest generation
 * may write state.
 */
let openSeq = 0;

interface StoredPosition {
  paperId: number;
  version: PdfVersion;
  page: number;
  offset: number;
}

interface PendingMapping {
  paperId: number;
  version: PdfVersion;
  from: ReadingPosition;
  fromPageCount: number;
  notice: string | null;
}

let positionTimer: ReturnType<typeof setTimeout> | null = null;
let pendingPosition: StoredPosition | null = null;
let lastPersisted: StoredPosition | null = null;
let writeChain: Promise<void> = Promise.resolve();
let pendingMapping: PendingMapping | null = null;

interface ReaderFields {
  paperId: number | null;
  version: PdfVersion;
  pageCount: number;
  currentPage: number;
  currentOffset: number;
  positionSeq: number;
  zoom: number;
  error: string | null;
  selection: ReaderSelection | null;
  failedVersion: PdfVersion | null;
  versionNotice: string | null;
  pendingInitialPage: { paperId: number; page: number } | null;
}

function initialFields(): ReaderFields {
  return {
    paperId: null,
    version: 'original',
    pageCount: 0,
    currentPage: 1,
    currentOffset: 0,
    positionSeq: 0,
    zoom: 1,
    error: null,
    selection: null,
    failedVersion: null,
    versionNotice: null,
    pendingInitialPage: null,
  };
}

function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) {
    return 1;
  }
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

function translationBound(paper: Paper): boolean {
  return (
    paper.filePathTranslated !== null &&
    paper.filePathTranslated !== '' &&
    paper.pageCountTranslated !== null
  );
}

function samePosition(a: StoredPosition, b: StoredPosition | null): boolean {
  return (
    b !== null &&
    a.paperId === b.paperId &&
    a.version === b.version &&
    a.page === b.page &&
    Math.abs(a.offset - b.offset) < OFFSET_EPSILON
  );
}

function clearPositionTimer(): void {
  if (positionTimer !== null) {
    clearTimeout(positionTimer);
    positionTimer = null;
  }
}

function enqueuePositionWrite(position: StoredPosition): void {
  lastPersisted = position;
  writeChain = writeChain.then(async () => {
    try {
      await window.api.papers.markRead(
        position.paperId,
        position.version,
        position.page,
        position.offset,
      );
    } catch (error) {
      // Keep `lastPersisted` so the next position change retries the write.
      console.warn('记录阅读进度失败', error);
    }
  });
}

function currentStoredPosition(): StoredPosition | null {
  const state = useReaderStore.getState();
  if (state.paperId === null) {
    return null;
  }
  return {
    paperId: state.paperId,
    version: state.version,
    page: state.currentPage,
    offset: state.currentOffset,
  };
}

function writeCurrentPosition(): void {
  const current = currentStoredPosition();
  if (current === null) {
    return;
  }
  pendingPosition = null;
  clearPositionTimer();
  enqueuePositionWrite(current);
}

function schedulePositionWrite(immediate = false): void {
  const current = currentStoredPosition();
  if (current === null || samePosition(current, lastPersisted)) {
    return;
  }
  pendingPosition = current;
  if (immediate) {
    writeCurrentPosition();
    return;
  }
  // Throttle, not debounce: continuous scrolling still writes every interval.
  if (positionTimer === null) {
    positionTimer = setTimeout(() => {
      positionTimer = null;
      const pending = pendingPosition;
      pendingPosition = null;
      if (pending !== null) {
        enqueuePositionWrite(pending);
      }
    }, POSITION_WRITE_INTERVAL_MS);
  }
}

function flushPosition(): Promise<void> {
  clearPositionTimer();
  const current = currentStoredPosition();
  const pending =
    pendingPosition ??
    (current !== null && !samePosition(current, lastPersisted) ? current : null);
  pendingPosition = null;
  if (pending !== null) {
    enqueuePositionWrite(pending);
  }
  return writeChain;
}

function savedPosition(paper: Paper, version: PdfVersion): ReadingPosition {
  return version === 'original'
    ? { page: paper.lastPageOriginal, offset: paper.lastOffsetOriginal }
    : { page: paper.lastPageTranslated, offset: paper.lastOffsetTranslated };
}

function fallbackNotice(from: PdfVersion, to: PdfVersion): string {
  return `上次阅读的${PDF_VERSION_LABELS[from]}暂时无法打开，已切换到${PDF_VERSION_LABELS[to]}。`;
}

export const useReaderStore = create<ReaderState>()((set, get) => ({
  ...initialFields(),

  async open(paperId, initialPage) {
    // Claim the generation before the first await so a close() during the
    // flush invalidates this open instead of being overwritten by it.
    const seq = ++openSeq;
    // The previous session's last position must land before this one starts.
    await flushPosition();
    if (seq !== openSeq) {
      return;
    }
    const pending = get().pendingInitialPage;
    const pendingPage =
      pending !== null && pending.paperId === paperId ? pending.page : undefined;
    pendingMapping = null;
    lastPersisted = null;
    clearPositionTimer();
    pendingPosition = null;

    // A request for another paper survives: opening some other paper must not
    // silently eat the page a later open of that paper still has to apply.
    set({
      ...initialFields(),
      paperId,
      pendingInitialPage: pendingPage === undefined ? pending : null,
    });

    try {
      const paper = await window.api.papers.get(paperId);
      if (seq !== openSeq) {
        return;
      }
      if (paper === null) {
        set({ error: `文献不存在: ${paperId}` });
        return;
      }

      const requestedPage = initialPage ?? pendingPage;
      const explicit = requestedPage !== undefined;
      const sourceVersion = paper.lastVersion;
      const source = savedPosition(paper, sourceVersion);
      const sourceCount = pageCountFor(paper, sourceVersion);
      const sourceCountUnknown =
        sourceVersion === 'bilingual' && paper.pageCountBilingual === null;

      const candidates: PdfVersion[] = [];
      const addCandidate = (version: PdfVersion): void => {
        if (!candidates.includes(version)) {
          candidates.push(version);
        }
      };
      if (explicit) {
        addCandidate('original');
      } else {
        if (sourceVersion === 'original') {
          addCandidate('original');
        } else if (translationBound(paper)) {
          addCandidate(sourceVersion);
          if (sourceVersion === 'bilingual') {
            addCandidate('translated');
          }
          addCandidate('original');
        } else {
          addCandidate('original');
        }
      }

      let lastFailure: { version: PdfVersion; message: string } | null = null;

      for (const version of candidates) {
        if (
          version !== 'original' &&
          (!translationBound(paper) || pageCountFor(paper, version) <= 0)
        ) {
          lastFailure = { version, message: '未绑定译本' };
          continue;
        }

        const key = keyFor(paper, version);
        const cached = peek(key);
        let pageCount = pageCountFor(paper, version);
        let repaired = false;

        if (cached !== null) {
          pageCount = cached.pdf.numPages;
        } else {
          try {
            const loaded = await window.api.pdf.load(paperId, version);
            if (seq !== openSeq) {
              return;
            }
            repaired = loaded.repaired === true;
            if (repaired) {
              pageCount = loaded.pageCountTranslated ?? pageCount;
              invalidatePaper(paperId);
              void useLibraryStore.getState().load().catch(() => undefined);
            }
          } catch (error) {
            if (seq !== openSeq) {
              return;
            }
            lastFailure = { version, message: errorMessage(error) };
            continue;
          }
        }

        if (seq !== openSeq) {
          return;
        }

        const sameVersion = !explicit && version === sourceVersion;
        const targetCountUnknown =
          version === 'bilingual' &&
          paper.pageCountBilingual === null &&
          cached === null;
        let position: ReadingPosition;
        let notice: string | null = repaired ? TRANSLATION_REPAIRED_NOTICE : null;

        if (explicit) {
          position = positionAt(requestedPage ?? 1, 0, pageCount);
        } else if (sameVersion) {
          position =
            version === 'bilingual' &&
            paper.pageCountBilingual === null &&
            cached === null
              ? { page: source.page, offset: clampOffset(source.offset) }
              : positionAt(source.page, source.offset, pageCount);
        } else {
          notice = fallbackNotice(sourceVersion, version);
          if (
            !sourceCountUnknown &&
            sourceCount > 0 &&
            pageCount > 0 &&
            !targetCountUnknown
          ) {
            position = mapReadingPosition(source, sourceCount, pageCount);
          } else if (pageCount > 0) {
            position = {
              page: clampPage(source.page, pageCount),
              offset: clampOffset(source.offset),
            };
          } else {
            position = { page: 1, offset: 0 };
          }
        }

        if (targetCountUnknown && !sameVersion) {
          pendingMapping = {
            paperId,
            version,
            from: source,
            fromPageCount: sourceCount,
            notice,
          };
        }

        set({
          version,
          pageCount,
          currentPage: position.page,
          currentOffset: position.offset,
          positionSeq: sameVersion ? get().positionSeq : get().positionSeq + 1,
          error: null,
          failedVersion: null,
          selection: null,
          versionNotice: notice,
        });

        lastPersisted = {
          paperId,
          version,
          page: position.page,
          offset: position.offset,
        };
        if (explicit || !sameVersion) {
          writeCurrentPosition();
        }
        return;
      }

      const failure = lastFailure ?? {
        version: 'original' as PdfVersion,
        message: '无法打开文献',
      };
      // Keep the metadata page count so the error panel can still describe
      // the document even though the PDF itself could not be opened.
      set({
        version: failure.version,
        pageCount: pageCountFor(paper, failure.version),
        error: failure.message,
        failedVersion: failure.version,
      });
    } catch (error) {
      if (seq !== openSeq) {
        return;
      }
      // Metadata lookup failures (e.g. DB errors) surface in the viewer error UI.
      set({ error: errorMessage(error) });
    }
  },

  requestInitialPage(paperId, page) {
    set({ pendingInitialPage: { paperId, page } });
  },

  clearInitialPage() {
    set({ pendingInitialPage: null });
  },

  async setVersion(version) {
    const state = get();
    const paperId = state.paperId;
    if (paperId === null || state.version === version) {
      return;
    }

    // Claim the generation before the first await so a close() during the
    // flush wins, and rapid double-switches cannot both commit.
    const seq = ++openSeq;
    // The old version's last position must land before the new version is
    // written, otherwise `last_version` would describe the wrong layout.
    await flushPosition();
    if (seq !== openSeq) {
      return;
    }
    try {
      const paper = await window.api.papers.get(paperId);
      if (seq !== openSeq) {
        return;
      }
      if (paper === null) {
        set({ error: `文献不存在: ${paperId}`, failedVersion: version });
        return;
      }
      if (
        version !== 'original' &&
        (!translationBound(paper) || pageCountFor(paper, version) <= 0)
      ) {
        set({ error: '未绑定译本', failedVersion: version });
        return;
      }

      const key = keyFor(paper, version);
      const cached = peek(key);
      let pageCount = pageCountFor(paper, version);
      let repaired = false;

      if (cached !== null) {
        pageCount = cached.pdf.numPages;
      } else {
        const loaded = await window.api.pdf.load(paperId, version);
        if (seq !== openSeq) {
          return;
        }
        repaired = loaded.repaired === true;
        if (repaired) {
          pageCount = loaded.pageCountTranslated ?? pageCount;
          invalidatePaper(paperId);
        }
      }

      if (seq !== openSeq) {
        return;
      }
      const latest = get();
      if (latest.paperId !== paperId) {
        return;
      }

      const targetCountUnknown =
        version === 'bilingual' &&
        paper.pageCountBilingual === null &&
        cached === null;
      const from: ReadingPosition = {
        page: latest.currentPage,
        offset: latest.currentOffset,
      };
      const notice = repaired ? TRANSLATION_REPAIRED_NOTICE : null;

      if (targetCountUnknown) {
        // PDF.js has not measured the bilingual layout yet. Keep the position
        // provisional; adoptDocumentPageCount completes the mapping.
        pendingMapping = {
          paperId,
          version,
          from,
          fromPageCount: latest.pageCount,
          notice,
        };
        const provisional = positionAt(from.page, from.offset, pageCount);
        set({
          version,
          pageCount,
          currentPage: provisional.page,
          currentOffset: provisional.offset,
          positionSeq: latest.positionSeq + 1,
          error: null,
          failedVersion: null,
          selection: null,
          versionNotice: repaired ? TRANSLATION_REPAIRED_NOTICE : null,
        });
        return;
      }

      const position = mapReadingPosition(
        from,
        latest.pageCount,
        pageCount,
      );
      // `zoom` is intentionally untouched: the reader keeps its scale.
      set({
        version,
        pageCount,
        currentPage: position.page,
        currentOffset: position.offset,
        positionSeq: latest.positionSeq + 1,
        error: null,
        failedVersion: null,
        selection: null,
        versionNotice: repaired ? TRANSLATION_REPAIRED_NOTICE : null,
      });
      if (repaired) {
        void useLibraryStore.getState().load().catch(() => undefined);
      }
      // Persist the new layout immediately, even if the user closes right away.
      writeCurrentPosition();
    } catch (error) {
      if (seq !== openSeq) {
        return;
      }
      set({ error: errorMessage(error), failedVersion: version });
    }
  },

  close() {
    // Invalidate any in-flight open/setVersion so it cannot resurrect a
    // session after the reader was closed.
    void flushPosition();
    ++openSeq;
    pendingMapping = null;
    lastPersisted = null;
    set(initialFields());
  },

  setCurrentPosition(page, offset) {
    const state = get();
    if (state.paperId === null) {
      return;
    }
    const position = positionAt(page, offset, state.pageCount);
    if (
      position.page === state.currentPage &&
      Math.abs(position.offset - state.currentOffset) < OFFSET_EPSILON
    ) {
      return;
    }
    set({
      currentPage: position.page,
      currentOffset: position.offset,
    });
    schedulePositionWrite();
  },

  jumpToPage(page) {
    const state = get();
    if (state.paperId === null) {
      return;
    }
    const position = positionAt(page, 0, state.pageCount);
    set({
      currentPage: position.page,
      currentOffset: 0,
      positionSeq: state.positionSeq + 1,
    });
    schedulePositionWrite();
  },

  setZoom(z) {
    set({ zoom: clampZoom(z) });
  },

  setSelection(sel) {
    set({ selection: sel });
  },

  flushPosition() {
    return flushPosition();
  },

  adoptDocumentPageCount(numPages) {
    const count = Math.floor(numPages);
    if (!Number.isFinite(count) || count <= 0) {
      return;
    }
    const state = get();
    if (state.paperId === null) {
      return;
    }

    if (
      pendingMapping !== null &&
      pendingMapping.paperId === state.paperId &&
      pendingMapping.version === state.version
    ) {
      const mapped = mapReadingPosition(
        pendingMapping.from,
        pendingMapping.fromPageCount,
        count,
      );
      const notice = pendingMapping.notice;
      pendingMapping = null;
      set({
        pageCount: count,
        currentPage: mapped.page,
        currentOffset: mapped.offset,
        positionSeq: state.positionSeq + 1,
        versionNotice: notice,
      });
      // The deferred position is the session's real starting point.
      writeCurrentPosition();
      return;
    }

    const position = positionAt(
      state.currentPage,
      state.currentOffset,
      count,
    );
    const changed =
      position.page !== state.currentPage ||
      Math.abs(position.offset - state.currentOffset) >= OFFSET_EPSILON;
    set({
      pageCount: count,
      currentPage: position.page,
      currentOffset: position.offset,
      positionSeq: changed ? state.positionSeq + 1 : state.positionSeq,
    });
    if (changed) {
      schedulePositionWrite();
    }
  },

  setError(message) {
    // A non-null message means the viewer failed to load the CURRENT document;
    // remember that version so relocation repairs the right file.
    set({ error: message, failedVersion: message === null ? null : get().version });
  },

  dismissVersionNotice() {
    set({ versionNotice: null });
  },
}));
