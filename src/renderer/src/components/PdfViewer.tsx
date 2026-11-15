import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { Paper } from '@shared/types';
import { TRANSLATION_TARGET_LABELS, detectTranslationTarget } from '@shared/translation';
import {
  buildPageWindow,
  configurePdfWorker,
  findInDocument,
  getSelectionInPage,
} from '../lib/pdf';
import { errorMessage } from '../lib/errors';
import { cropToDataUrl, toSourceRect } from '../lib/screenshot';
import type { Rect } from '../lib/screenshot';
import { useReaderStore } from '../stores/reader';
import type { ReaderSelection } from '../stores/reader';
import { useLibraryStore } from '../stores/library';
import { useSettingsStore } from '../stores/settings';
import { PdfPage } from './PdfPage';
import { RegionCapture } from './RegionCapture';
import { SelectionTranslationCard } from './SelectionTranslationCard';

export interface PdfViewerProps {
  paper: Paper;
  focusMode: boolean;
  onToggleFocusMode(): void;
  onAskAI?(selection: ReaderSelection): void;
  onJudgeDepth?(selection: ReaderSelection): void;
  onSaveNote?(selection: ReaderSelection): void;
  onCaptureAsk?(imageDataUrl: string): void;
  /** Opens the settings dialog from the translation card's unconfigured hint. */
  onOpenSettings?(): void;
}

interface PageSize {
  width: number;
  height: number;
}

interface PendingMarkRead {
  paperId: number;
  version: 'original' | 'translated';
  page: number;
}

interface ToolbarPosition {
  top: number;
  left: number;
}

/** An open free-selection translation request and where its card points. */
interface TranslationCardTarget {
  text: string;
  top: number;
  left: number;
  seq: number;
}

const AI_NOT_CONFIGURED = '请先在设置中配置 AI 接口';

export function PdfViewer({
  paper,
  focusMode,
  onToggleFocusMode,
  onAskAI,
  onJudgeDepth,
  onSaveNote,
  onCaptureAsk,
  onOpenSettings,
}: PdfViewerProps): React.JSX.Element {
  const paperId = useReaderStore((state) => state.paperId);
  const version = useReaderStore((state) => state.version);
  const currentPage = useReaderStore((state) => state.currentPage);
  const zoom = useReaderStore((state) => state.zoom);
  const storeError = useReaderStore((state) => state.error);
  const selection = useReaderStore((state) => state.selection);
  const open = useReaderStore((state) => state.open);
  const setVersion = useReaderStore((state) => state.setVersion);
  const setCurrentPage = useReaderStore((state) => state.setCurrentPage);
  const setZoom = useReaderStore((state) => state.setZoom);
  const jumpToPage = useReaderStore((state) => state.jumpToPage);
  const setSelection = useReaderStore((state) => state.setSelection);
  const setError = useReaderStore((state) => state.setError);
  // Vision capture is only offered when a vision model is configured; the
  // settings store is loaded once at App mount so this is known up front.
  const visionModel = useSettingsStore((state) => state.settings?.visionModel ?? '');
  const hasVisionModel = visionModel.trim() !== '';
  const translationBound =
    paper.filePathTranslated !== null &&
    paper.filePathTranslated !== '' &&
    paper.pageCountTranslated !== null;

  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [pageSizes, setPageSizes] = useState<PageSize[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [relocating, setRelocating] = useState(false);
  const [switching, setSwitching] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [matches, setMatches] = useState<number[] | null>(null);
  const [matchIndex, setMatchIndex] = useState(0);
  const [searching, setSearching] = useState(false);

  const [toolbarPosition, setToolbarPosition] = useState<ToolbarPosition | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);

  // Free-selection translation lives in the viewer only: nothing is persisted
  // and the card is independent of the AI panel.
  const [translationTarget, setTranslationTarget] = useState<TranslationCardTarget | null>(null);
  const [translationLoading, setTranslationLoading] = useState(false);
  const [translationResult, setTranslationResult] = useState<string | null>(null);
  const [translationError, setTranslationError] = useState<string | null>(null);
  const [translationUnconfigured, setTranslationUnconfigured] = useState(false);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const searchSeqRef = useRef(0);
  const markReadTimerRef = useRef<number | null>(null);
  const pendingMarkRef = useRef<PendingMarkRead | null>(null);
  const lastMarkedRef = useRef<{ paperId: number; page: number } | null>(null);
  const lastScrollDerivedPageRef = useRef<number | null>(null);
  const programmaticScrollRef = useRef<number | null>(null);
  const programmaticTimerRef = useRef<number | null>(null);
  const translationCardRef = useRef<HTMLDivElement | null>(null);
  // Monotonic request sequence: only the newest translation may set state.
  const translationSeqRef = useRef(0);

  const closeTranslation = useCallback((): void => {
    translationSeqRef.current += 1;
    setTranslationTarget(null);
    setTranslationLoading(false);
    setTranslationResult(null);
    setTranslationError(null);
    setTranslationUnconfigured(false);
  }, []);

  const startTranslation = useCallback((text: string, top: number, left: number): void => {
    const seq = translationSeqRef.current + 1;
    translationSeqRef.current = seq;
    setTranslationTarget({ text, top, left, seq });
    setTranslationLoading(true);
    setTranslationResult(null);
    setTranslationError(null);
    setTranslationUnconfigured(false);
    window.api.translate.text({ text }).then(
      (result) => {
        if (translationSeqRef.current !== seq) {
          return;
        }
        setTranslationResult(result.translation);
        setTranslationLoading(false);
      },
      (error: unknown) => {
        if (translationSeqRef.current !== seq) {
          return;
        }
        const message = errorMessage(error);
        if (message.includes(AI_NOT_CONFIGURED)) {
          setTranslationUnconfigured(true);
        } else {
          setTranslationError(message);
        }
        setTranslationLoading(false);
      },
    );
  }, []);

  // Load (and reload after relocation) the document for the current paper.
  useEffect(() => {
    let cancelled = false;
    let loadingTask: PDFDocumentLoadingTask | null = null;

    setPdf(null);
    setPageSizes([]);
    setLoadError(null);
    setMatches(null);
    setMatchIndex(0);
    setSearching(false);
    setToolbarPosition(null);
    setCapturing(false);
    setCaptureError(null);
    closeTranslation();
    searchSeqRef.current += 1;
    lastMarkedRef.current = null;
    lastScrollDerivedPageRef.current = null;

    const load = async (): Promise<void> => {
      // A paper change (or the initial mount) must open a new reader session;
      // a version switch already updated the store and must keep its state.
      if (useReaderStore.getState().paperId !== paper.id) {
        // open() validates metadata and file readability and fills the store.
        await open(paper.id);
        if (cancelled) {
          return;
        }
      }
      if (useReaderStore.getState().error !== null) {
        // The store error UI already explains the failure; do not read twice.
        return;
      }

      configurePdfWorker();
      const currentVersion = useReaderStore.getState().version;
      try {
        const { data } = await window.api.pdf.load(paper.id, currentVersion);
        if (cancelled) {
          return;
        }
        loadingTask = getDocument({ data: new Uint8Array(data) });
        const loadedPdf = await loadingTask.promise;
        if (cancelled) {
          void loadingTask.destroy();
          return;
        }
        const sizes: PageSize[] = [];
        for (let pageNo = 1; pageNo <= loadedPdf.numPages; pageNo += 1) {
          const page = await loadedPdf.getPage(pageNo);
          const viewport = page.getViewport({ scale: 1 });
          sizes.push({ width: viewport.width, height: viewport.height });
          if (cancelled) {
            void loadingTask.destroy();
            return;
          }
        }
        setPageSizes(sizes);
        setPdf(loadedPdf);
      } catch (error) {
        if (cancelled) {
          return;
        }
        const message = errorMessage(error);
        setLoadError(message);
        // Mirror viewer-owned failures into the store for other panels.
        setError(message);
      }
    };

    void load();

    return () => {
      cancelled = true;
      if (loadingTask !== null) {
        void loadingTask.destroy();
      }
    };
  }, [paper.id, reloadToken, version, open, setError, closeTranslation]);

  const flushMarkRead = useCallback((): void => {
    if (markReadTimerRef.current !== null) {
      window.clearTimeout(markReadTimerRef.current);
      markReadTimerRef.current = null;
    }
    const pending = pendingMarkRef.current;
    pendingMarkRef.current = null;
    if (pending === null) {
      return;
    }
    window.api.papers
      .markRead(pending.paperId, pending.version, pending.page)
      .catch((error: unknown) => {
        console.warn('记录阅读进度失败', error);
      });
  }, []);

  // Flush a still-debounced progress update when the viewer unmounts.
  useEffect(
    () => () => {
      flushMarkRead();
    },
    [flushMarkRead],
  );

  // Persist the reading position 500ms after the page settles.
  useEffect(() => {
    if (pdf === null || paperId === null) {
      return;
    }
    const previous = lastMarkedRef.current;
    lastMarkedRef.current = { paperId, page: currentPage };
    if (previous === null || previous.paperId !== paperId || previous.page === currentPage) {
      return;
    }
    pendingMarkRef.current = { paperId, version, page: currentPage };
    if (markReadTimerRef.current !== null) {
      window.clearTimeout(markReadTimerRef.current);
    }
    markReadTimerRef.current = window.setTimeout(() => {
      markReadTimerRef.current = null;
      flushMarkRead();
    }, 500);
  }, [pdf, paperId, version, currentPage, flushMarkRead]);

  // Switch between the original and translated PDF. The pending progress write
  // still carries the old version and is flushed before the new document loads.
  const handleToggleVersion = useCallback(async (): Promise<void> => {
    if (switching || !translationBound) {
      return;
    }
    const target = useReaderStore.getState().version === 'original' ? 'translated' : 'original';
    flushMarkRead();
    lastMarkedRef.current = null;
    setSwitching(true);
    try {
      await setVersion(target);
    } finally {
      setSwitching(false);
    }
  }, [switching, translationBound, flushMarkRead, setVersion]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey) || !event.shiftKey) {
        return;
      }
      if (event.repeat || event.key.toLowerCase() !== 't' || switching || !translationBound) {
        return;
      }
      event.preventDefault();
      void handleToggleVersion();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [switching, translationBound, handleToggleVersion]);

  const updateCurrentPageFromScroll = useCallback((): void => {
    const container = scrollRef.current;
    if (container === null || programmaticScrollRef.current !== null) {
      return;
    }
    const containerTop = container.getBoundingClientRect().top;
    let nearestPage: number | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;
    const wrappers = container.querySelectorAll<HTMLElement>('[data-page-no]');
    wrappers.forEach((wrapper) => {
      const distance = Math.abs(wrapper.getBoundingClientRect().top - containerTop);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestPage = Number(wrapper.dataset.pageNo);
      }
    });
    if (nearestPage === null) {
      return;
    }
    if (nearestPage !== useReaderStore.getState().currentPage) {
      lastScrollDerivedPageRef.current = nearestPage;
      setCurrentPage(nearestPage);
    }
  }, [setCurrentPage]);

  // Restore the saved page after load and follow outline/search jumps. Scroll
  // updates produced by this effect are suppressed in the scroll handler.
  useEffect(() => {
    if (pdf === null || pageSizes.length === 0) {
      return;
    }
    const container = scrollRef.current;
    if (container === null) {
      return;
    }
    const page = useReaderStore.getState().currentPage;
    if (lastScrollDerivedPageRef.current === page) {
      lastScrollDerivedPageRef.current = null;
      return;
    }
    const wrapper = container.querySelector<HTMLElement>(`[data-page-no="${page}"]`);
    if (wrapper === null) {
      return;
    }
    programmaticScrollRef.current = page;
    if (programmaticTimerRef.current !== null) {
      window.clearTimeout(programmaticTimerRef.current);
    }
    programmaticTimerRef.current = window.setTimeout(() => {
      programmaticScrollRef.current = null;
      programmaticTimerRef.current = null;
    }, 200);
    wrapper.scrollIntoView({ block: 'start' });
    return () => {
      if (programmaticTimerRef.current !== null) {
        window.clearTimeout(programmaticTimerRef.current);
        programmaticTimerRef.current = null;
      }
      programmaticScrollRef.current = null;
    };
  }, [pdf, pageSizes.length, currentPage]);

  // Ctrl/Cmd + wheel zooms the PDF, not the Electron page. The listener is
  // native and non-passive so preventDefault reliably stops Chromium's own
  // page zoom. The scroll position is adjusted afterwards to keep the point
  // under the cursor on the same part of the same page.
  useEffect(() => {
    const container = scrollRef.current;
    if (container === null) {
      return;
    }
    const handleWheel = (event: WheelEvent): void => {
      if (!event.ctrlKey && !event.metaKey) {
        return;
      }
      event.preventDefault();
      const state = useReaderStore.getState();
      const direction = event.deltaY < 0 ? 1 : -1;
      const nextZoom = Math.round((state.zoom + direction * 0.1) * 10) / 10;
      const clamped = Math.min(3, Math.max(0.5, nextZoom));
      if (clamped === state.zoom) {
        return;
      }

      const target =
        event.target instanceof Element
          ? event.target.closest<HTMLElement>('[data-page-no]')
          : null;
      const bounds = target?.getBoundingClientRect() ?? null;
      const pageNo = target === null ? null : Number(target.dataset.pageNo);
      const anchorRatio =
        bounds === null || bounds.height === 0
          ? 0
          : Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height));

      state.setZoom(clamped);
      if (pageNo === null || bounds === null) {
        return;
      }
      // The page wrapper is resized by React before the next animation frame.
      window.requestAnimationFrame(() => {
        const current = scrollRef.current;
        if (current === null) {
          return;
        }
        const nextTarget = current.querySelector<HTMLElement>(
          `[data-page-no="${pageNo}"]`,
        );
        if (nextTarget === null) {
          return;
        }
        const nextBounds = nextTarget.getBoundingClientRect();
        const anchoredY = nextBounds.top + anchorRatio * nextBounds.height;
        current.scrollTop += anchoredY - event.clientY;
      });
    };
    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, [pdf]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        const input = searchInputRef.current;
        if (input !== null) {
          input.focus();
          input.select();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') {
        return;
      }
      useReaderStore.getState().setSelection(null);
      setToolbarPosition(null);
      closeTranslation();
      window.getSelection()?.removeAllRanges();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [closeTranslation]);

  useEffect(() => {
    if (selection === null) {
      return;
    }
    const handleMouseDown = (event: MouseEvent): void => {
      const target = event.target;
      if (target instanceof Node && toolbarRef.current?.contains(target)) {
        return;
      }
      useReaderStore.getState().setSelection(null);
      setToolbarPosition(null);
    };
    window.addEventListener('mousedown', handleMouseDown);
    return () => {
      window.removeEventListener('mousedown', handleMouseDown);
    };
  }, [selection]);

  // Clicking anywhere outside the translation card dismisses it; clicks inside
  // (copy, retry, settings, close) must not.
  useEffect(() => {
    if (translationTarget === null) {
      return;
    }
    const handleMouseDown = (event: MouseEvent): void => {
      const target = event.target;
      if (target instanceof Node && translationCardRef.current?.contains(target)) {
        return;
      }
      closeTranslation();
    };
    window.addEventListener('mousedown', handleMouseDown);
    return () => {
      window.removeEventListener('mousedown', handleMouseDown);
    };
  }, [translationTarget, closeTranslation]);

  const runSearch = useCallback(async (): Promise<void> => {
    if (pdf === null) {
      return;
    }
    const query = searchQuery.trim();
    const seq = searchSeqRef.current + 1;
    searchSeqRef.current = seq;
    if (query === '') {
      setMatches(null);
      setMatchIndex(0);
      return;
    }
    setSearching(true);
    try {
      const pages = await findInDocument(pdf, query);
      if (searchSeqRef.current !== seq) {
        return;
      }
      setMatches(pages);
      setMatchIndex(0);
      if (pages.length > 0) {
        jumpToPage(pages[0]);
      }
    } catch (error) {
      if (searchSeqRef.current === seq) {
        setMatches([]);
        console.warn('页内搜索失败', error);
      }
    } finally {
      if (searchSeqRef.current === seq) {
        setSearching(false);
      }
    }
  }, [pdf, searchQuery, jumpToPage]);

  const handleQueryChange = (value: string): void => {
    setSearchQuery(value);
    // Any edit invalidates an in-flight scan: its results belong to the old
    // query text and must never set matches or jump the document.
    searchSeqRef.current += 1;
    setSearching(false);
    if (value.trim() === '') {
      setMatches(null);
      setMatchIndex(0);
    }
  };

  const stepMatch = (delta: 1 | -1): void => {
    if (matches === null || matches.length === 0) {
      return;
    }
    const next = (matchIndex + delta + matches.length) % matches.length;
    setMatchIndex(next);
    jumpToPage(matches[next]);
  };

  const handleSelectionEvent = (
    event: React.MouseEvent<HTMLDivElement> | React.KeyboardEvent<HTMLDivElement>,
  ): void => {
    const target = event.target;
    const wrapper =
      target instanceof Element ? target.closest<HTMLElement>('[data-page-no]') : null;
    if (wrapper === null) {
      return;
    }
    const selected = getSelectionInPage(wrapper);
    if (selected === null) {
      setSelection(null);
      setToolbarPosition(null);
      return;
    }
    setSelection({ text: selected.text, pageNo: Number(wrapper.dataset.pageNo) });
    const range = window.getSelection()?.getRangeAt(0) ?? null;
    const rect = range?.getBoundingClientRect() ?? null;
    if (rect === null) {
      setToolbarPosition(null);
      return;
    }
    const top = Math.max(8, rect.top - 44);
    const left = Math.min(
      Math.max(16, rect.left + rect.width / 2),
      Math.max(16, window.innerWidth - 16),
    );
    setToolbarPosition({ top, left });
  };

  const handleCopy = (): void => {
    if (selection === null) {
      return;
    }
    navigator.clipboard.writeText(selection.text).catch((error: unknown) => {
      console.warn('复制选中文字失败', error);
    });
  };

  const handleTranslate = (): void => {
    if (selection === null || toolbarPosition === null) {
      return;
    }
    // The card is centered on `left` and 420px wide (see styles.css); keep it
    // inside the window when the selection sits near an edge.
    const halfWidth = Math.min(210, Math.max(0, window.innerWidth / 2 - 16));
    const left = Math.min(
      Math.max(toolbarPosition.left, halfWidth + 8),
      Math.max(halfWidth + 8, window.innerWidth - halfWidth - 8),
    );
    startTranslation(selection.text, toolbarPosition.top + 48, left);
  };

  const handleRelocate = async (): Promise<void> => {
    setRelocating(true);
    try {
      // Repair the file whose load failed; fall back to the displayed version.
      const state = useReaderStore.getState();
      const target = state.failedVersion ?? state.version;
      const updated = await window.api.papers.relocate(paper.id, target);
      // A stale continuation must not act on a paper that is no longer open.
      if (useReaderStore.getState().paperId !== paper.id) {
        return;
      }
      if (updated !== null) {
        setLoadError(null);
        setError(null);
        flushMarkRead();
        lastMarkedRef.current = null;
        // Reload metadata (path, page count, outline) for the relocated file.
        await open(paper.id);
        if (useReaderStore.getState().paperId !== paper.id) {
          return;
        }
        if (target === 'translated') {
          // open() reset the session to the original; restore the translated view.
          await setVersion('translated');
          if (useReaderStore.getState().paperId !== paper.id) {
            return;
          }
        } else {
          setReloadToken((token) => token + 1);
        }
        void useLibraryStore
          .getState()
          .load()
          .catch((refreshError: unknown) => {
            console.warn('刷新文献库失败', refreshError);
          });
      }
    } catch (error) {
      setLoadError(errorMessage(error));
    } finally {
      setRelocating(false);
    }
  };

  const windowPages = useMemo(
    () => buildPageWindow(currentPage, pdf?.numPages ?? 0, 2),
    [currentPage, pdf],
  );
  const windowPageSet = useMemo(() => new Set(windowPages), [windowPages]);

  // A capture is accepted only when it sits fully inside one rendered page
  // canvas; anything else (margin, gutter, two pages) sends nothing.
  const handleCaptureRegion = useCallback(
    (rect: Rect): void => {
      setCapturing(false);
      const canvases =
        scrollRef.current?.querySelectorAll<HTMLCanvasElement>(
          '.pdf-page-wrapper[data-page-no] canvas.pdf-canvas',
        ) ?? [];
      for (const canvas of canvases) {
        const bounds = canvas.getBoundingClientRect();
        const contained =
          rect.width > 0 &&
          rect.height > 0 &&
          rect.x >= bounds.left &&
          rect.y >= bounds.top &&
          rect.x + rect.width <= bounds.right &&
          rect.y + rect.height <= bounds.bottom;
        if (!contained) {
          continue;
        }
        const cssRect = {
          x: rect.x - bounds.left,
          y: rect.y - bounds.top,
          width: rect.width,
          height: rect.height,
        };
        const sourceRect = toSourceRect(
          cssRect,
          { width: bounds.width, height: bounds.height },
          { width: canvas.width, height: canvas.height },
        );
        void cropToDataUrl(canvas, sourceRect)
          .then((dataUrl) => {
            onCaptureAsk?.(dataUrl);
          })
          .catch((cropError: unknown) => {
            setCaptureError(errorMessage(cropError));
          });
        return;
      }
      setCaptureError('请框选单页内的区域');
    },
    [onCaptureAsk],
  );

  const cancelCapture = useCallback((): void => {
    setCapturing(false);
    setCaptureError(null);
  }, []);

  const captureTitle =
    onCaptureAsk === undefined
      ? '将在后续任务接入'
      : !hasVisionModel
        ? '未配置视觉模型，请在设置中填写视觉模型'
        : '框选页面区域向 AI 提问';
  const captureEnabled = pdf !== null && hasVisionModel && onCaptureAsk !== undefined;

  const errorDetail = loadError ?? storeError;
  const toggleTitle = !translationBound
    ? '未绑定译本'
    : version === 'original'
      ? '切换到中文译本'
      : '切换到原文';

  return (
    <div className="pdf-viewer">
      <div className="pdf-toolbar">
        <form
          className="pdf-search"
          onSubmit={(event) => {
            event.preventDefault();
            void runSearch();
          }}
        >
          <input
            ref={searchInputRef}
            className="pdf-search-input"
            value={searchQuery}
            placeholder="页内搜索（Ctrl+F）"
            aria-label="页内搜索"
            disabled={pdf === null}
            onChange={(event) => handleQueryChange(event.target.value)}
          />
          <button type="submit" className="pdf-toolbar-button" disabled={pdf === null || searching}>
            {searching ? '搜索中…' : '搜索'}
          </button>
          <button
            type="button"
            className="pdf-toolbar-button"
            title="上一处"
            disabled={matches === null || matches.length === 0}
            onClick={() => stepMatch(-1)}
          >
            上一处
          </button>
          <button
            type="button"
            className="pdf-toolbar-button"
            title="下一处"
            disabled={matches === null || matches.length === 0}
            onClick={() => stepMatch(1)}
          >
            下一处
          </button>
          {matches !== null &&
            (matches.length === 0 ? (
              <span className="pdf-search-status">无匹配</span>
            ) : (
              <span className="pdf-search-status">
                {matchIndex + 1}/{matches.length}
              </span>
            ))}
        </form>
        <div className="pdf-toolbar-right">
          <button
            type="button"
            className="pdf-toolbar-button"
            aria-label={captureTitle}
            title={captureTitle}
            disabled={!captureEnabled}
            onClick={() => {
              setCaptureError(null);
              setCapturing(true);
            }}
          >
            选框提问
          </button>
          <button
            type="button"
            className="pdf-toolbar-button"
            aria-label={toggleTitle}
            title={toggleTitle}
            disabled={switching || !translationBound}
            onClick={() => {
              void handleToggleVersion();
            }}
          >
            中/英
          </button>
          <button
            type="button"
            className={focusMode ? 'pdf-toolbar-button active' : 'pdf-toolbar-button'}
            aria-label={focusMode ? '退出全屏阅读' : '全屏阅读'}
            title={focusMode ? '退出全屏阅读（Esc）' : '全屏阅读（F11）'}
            aria-pressed={focusMode}
            onClick={onToggleFocusMode}
          >
            {focusMode ? '退出全屏' : '全屏'}
          </button>
          <div className="pdf-zoom">
            <button
              type="button"
              className="pdf-toolbar-button"
              title="缩小"
              aria-label="缩小"
              disabled={zoom <= 0.5}
              onClick={() => setZoom(zoom - 0.25)}
            >
              −
            </button>
            <span className="pdf-zoom-value" title="Ctrl + 滚轮可缩放">
              {Math.round(zoom * 100)}%
            </span>
            <button
              type="button"
              className="pdf-toolbar-button"
              title="放大"
              aria-label="放大"
              disabled={zoom >= 3}
              onClick={() => setZoom(zoom + 0.25)}
            >
              +
            </button>
          </div>
        </div>
      </div>

      {captureError !== null && (
        <div className="viewer-capture-error" role="alert">
          <span>{captureError}</span>
          <button type="button" className="menu-button" onClick={() => setCaptureError(null)}>
            关闭
          </button>
        </div>
      )}

      {errorDetail !== null ? (
        <div className="viewer-error" role="alert">
          <p className="viewer-error-title">文件缺失或无法打开</p>
          <p className="viewer-error-detail">{errorDetail}</p>
          <div className="viewer-error-actions">
            <button
              type="button"
              className="primary-button relocate-button"
              disabled={relocating}
              onClick={() => {
                void handleRelocate();
              }}
            >
              {relocating ? '正在重新定位…' : '重新定位'}
            </button>
            {pdf !== null && (
              <button
                type="button"
                className="secondary-button"
                disabled={relocating}
                onClick={() => {
                  setLoadError(null);
                  setError(null);
                }}
              >
                返回阅读
              </button>
            )}
          </div>
        </div>
      ) : pdf === null ? (
        <p className="pdf-loading">正在加载 PDF…</p>
      ) : (
        <div
          className="pdf-scroll"
          ref={scrollRef}
          onScroll={() => {
            // Scrolling the reading area invalidates the anchored card.
            closeTranslation();
            updateCurrentPageFromScroll();
          }}
          onMouseUp={handleSelectionEvent}
          onKeyUp={handleSelectionEvent}
        >
          <div className="pdf-pages">
            {Array.from({ length: pdf.numPages }, (_, index) => {
              const pageNo = index + 1;
              const size = pageSizes[index];
              return (
                <div
                  key={pageNo}
                  className="pdf-page-wrapper"
                  data-page-no={pageNo}
                  style={{
                    width: size === undefined ? 0 : size.width * zoom,
                    height: size === undefined ? 0 : size.height * zoom,
                  }}
                >
                  {windowPageSet.has(pageNo) ? (
                    <PdfPage pdf={pdf} pageNo={pageNo} zoom={zoom} />
                  ) : (
                    <div className="pdf-page-placeholder" />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {selection !== null && toolbarPosition !== null && (
        <div
          ref={toolbarRef}
          className="selection-toolbar"
          role="toolbar"
          aria-label="选中文字操作"
          style={{ top: toolbarPosition.top, left: toolbarPosition.left }}
        >
          <button
            type="button"
            disabled={onAskAI === undefined}
            title={onAskAI === undefined ? '将在后续任务接入' : '就选中文字向 AI 提问'}
            onClick={() => onAskAI?.(selection)}
          >
            问 AI
          </button>
          <button type="button" title="翻译选中文字" onClick={handleTranslate}>
            翻译
          </button>
          <button
            type="button"
            disabled={onJudgeDepth === undefined}
            title={onJudgeDepth === undefined ? '将在后续任务接入' : '判断选中文字的深度'}
            onClick={() => onJudgeDepth?.(selection)}
          >
            判断深度
          </button>
          <button
            type="button"
            disabled={onSaveNote === undefined}
            title={onSaveNote === undefined ? '将在后续任务接入' : '把选中文字存入笔记'}
            onClick={() => onSaveNote?.(selection)}
          >
            存笔记
          </button>
          <button type="button" onClick={handleCopy}>
            复制
          </button>
        </div>
      )}

      {translationTarget !== null && (
        <div ref={translationCardRef}>
          <SelectionTranslationCard
            key={translationTarget.seq}
            text={translationTarget.text}
            targetLabel={
              TRANSLATION_TARGET_LABELS[detectTranslationTarget(translationTarget.text)]
            }
            top={translationTarget.top}
            left={translationTarget.left}
            loading={translationLoading}
            translation={translationResult}
            error={translationError}
            unconfigured={translationUnconfigured}
            onRetry={() => {
              startTranslation(
                translationTarget.text,
                translationTarget.top,
                translationTarget.left,
              );
            }}
            onClose={closeTranslation}
            onOpenSettings={
              onOpenSettings === undefined
                ? undefined
                : () => {
                    onOpenSettings();
                    closeTranslation();
                  }
            }
          />
        </div>
      )}

      {capturing && <RegionCapture onSelect={handleCaptureRegion} onCancel={cancelCapture} />}
    </div>
  );
}
