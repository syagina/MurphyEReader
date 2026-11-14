import { create } from 'zustand';
import { errorMessage } from '../lib/errors';
import { clampPage } from '../lib/pdf';
import { resolveToggleTargetPage } from '../lib/toggle';

export interface ReaderSelection {
  text: string;
  pageNo: number;
}

export interface ReaderState {
  paperId: number | null;
  version: 'original' | 'translated';
  pageCount: number;
  currentPage: number;
  zoom: number;
  error: string | null;
  selection: ReaderSelection | null;
  /**
   * The version whose load failed last, when known. The error panel's
   * relocation action targets it instead of the version currently displayed.
   */
  failedVersion: 'original' | 'translated' | null;
  /**
   * Opens a paper in the reader. `initialPage`, when given (e.g. a global
   * search hit), wins over the paper's `lastPageOriginal` for the restored
   * page; both are clamped to the paper's page count.
   */
  open(paperId: number, initialPage?: number): Promise<void>;
  /**
   * Switches the open reader between the original PDF and its translation.
   * Only `version`, `pageCount` and `currentPage` change; a failed switch keeps
   * the current version and reports the failure through `error`.
   */
  setVersion(version: 'original' | 'translated'): Promise<void>;
  close(): void;
  setCurrentPage(page: number): void;
  setZoom(z: number): void;
  setSelection(sel: ReaderSelection | null): void;
  jumpToPage(page: number): void;
  /**
   * Extension for PDF viewer load failures (missing/corrupt files): the viewer
   * mirrors its local error here so other panels can see that reading failed.
   * A non-null message marks the current version as failed; null clears both.
   */
  setError(message: string | null): void;
}

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;

/**
 * Monotonic generation for `open` and `setVersion`. Overlapping document
 * switches are possible when the user acts quickly; only the newest generation
 * may write state.
 */
let openSeq = 0;

interface ReaderFields {
  paperId: number | null;
  version: 'original' | 'translated';
  pageCount: number;
  currentPage: number;
  zoom: number;
  error: string | null;
  selection: ReaderSelection | null;
  failedVersion: 'original' | 'translated' | null;
}

function initialFields(): ReaderFields {
  return {
    paperId: null,
    version: 'original',
    pageCount: 0,
    currentPage: 1,
    zoom: 1,
    error: null,
    selection: null,
    failedVersion: null,
  };
}

function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) {
    return 1;
  }
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

export const useReaderStore = create<ReaderState>()((set, get) => ({
  ...initialFields(),

  async open(paperId, initialPage) {
    const seq = ++openSeq;
    set({ ...initialFields(), paperId });
    try {
      const paper = await window.api.papers.get(paperId);
      if (seq !== openSeq) {
        return;
      }
      if (paper === null) {
        set({ error: `文献不存在: ${paperId}` });
        return;
      }
      const pageCount = paper.pageCountOriginal;
      set({
        pageCount,
        currentPage: clampPage(
          initialPage !== undefined ? initialPage : paper.lastPageOriginal || 1,
          pageCount,
        ),
      });
      try {
        // Validation read only. The buffer is intentionally not kept in state:
        // PdfViewer re-reads it for pdfjs (double IPC read is accepted in v1).
        await window.api.pdf.load(paperId, 'original');
      } catch (error) {
        if (seq !== openSeq) {
          return;
        }
        set({ error: errorMessage(error), failedVersion: 'original' });
      }
    } catch (error) {
      if (seq !== openSeq) {
        return;
      }
      // Metadata lookup failures (e.g. DB errors) surface in the viewer error UI.
      set({ error: errorMessage(error) });
    }
  },

  async setVersion(version) {
    const state = get();
    const paperId = state.paperId;
    if (paperId === null || state.version === version) {
      return;
    }
    const seq = ++openSeq;
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
        version === 'translated' &&
        (paper.filePathTranslated === null ||
          paper.filePathTranslated === '' ||
          paper.pageCountTranslated === null)
      ) {
        set({ error: '未绑定译本', failedVersion: version });
        return;
      }
      const pageCount =
        version === 'original' ? paper.pageCountOriginal : (paper.pageCountTranslated ?? 0);
      await window.api.pdf.load(paperId, version);
      if (seq !== openSeq) {
        return;
      }
      // Resolve after the validation read so a scroll made meanwhile wins: the
      // seq guard above proves the session (and thus `version`) is unchanged.
      const latest = get();
      const currentPage = resolveToggleTargetPage({
        from: latest.version,
        to: version,
        currentPage: latest.currentPage,
        lastPageOriginal: paper.lastPageOriginal,
        lastPageTranslated: paper.lastPageTranslated,
        pageCountOriginal: paper.pageCountOriginal,
        pageCountTranslated: paper.pageCountTranslated,
      });
      // `zoom` is intentionally untouched: the reader keeps its scale.
      set({
        version,
        pageCount,
        currentPage,
        error: null,
        failedVersion: null,
        selection: null,
      });
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
    ++openSeq;
    set(initialFields());
  },

  setCurrentPage(page) {
    set({ currentPage: clampPage(page, get().pageCount) });
  },

  setZoom(z) {
    set({ zoom: clampZoom(z) });
  },

  setSelection(sel) {
    set({ selection: sel });
  },

  jumpToPage(page) {
    set({ currentPage: clampPage(page, get().pageCount) });
  },

  setError(message) {
    // A non-null message means the viewer failed to load the CURRENT document;
    // remember that version so relocation repairs the right file.
    set({ error: message, failedVersion: message === null ? null : get().version });
  },
}));
