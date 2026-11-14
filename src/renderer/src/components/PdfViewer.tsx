import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import 'pdfjs-dist/web/pdf_viewer.css';
import type { Paper } from '@shared/types';
import {
  buildPageWindow,
  configurePdfWorker,
  findInDocument,
  getSelectionInPage,
} from '../lib/pdf';
import { useReaderStore } from '../stores/reader';
import type { ReaderSelection } from '../stores/reader';
import { useLibraryStore } from '../stores/library';
import { PdfPage } from './PdfPage';

export interface PdfViewerProps {
  paper: Paper;
  onAskAI?(selection: ReaderSelection): void;
  onJudgeDepth?(selection: ReaderSelection): void;
  onSaveNote?(selection: ReaderSelection): void;
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function PdfViewer({
  paper,
  onAskAI,
  onJudgeDepth,
  onSaveNote,
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
  }, [paper.id, reloadToken, version, open, setError]);

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
      window.getSelection()?.removeAllRanges();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

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
            aria-label={toggleTitle}
            title={toggleTitle}
            disabled={switching || !translationBound}
            onClick={() => {
              void handleToggleVersion();
            }}
          >
            中/英
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
            <span className="pdf-zoom-value">{Math.round(zoom * 100)}%</span>
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
          onScroll={updateCurrentPageFromScroll}
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
    </div>
  );
}
