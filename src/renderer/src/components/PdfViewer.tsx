import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type {
  AnnotationDrawing,
  AnnotationMarkStyle,
  AnnotationPin,
  AnnotationShapeData,
  AnnotationStroke,
  Paper,
  PdfVersion,
  StickyNote,
  StickyNoteAnchor,
  StickyNoteCreateInput,
  StickyNoteSource,
} from '@shared/types';
import {
  TRANSLATION_ENGINE_MISSING,
  TRANSLATION_NOT_CONFIGURED,
  TRANSLATION_TARGET_LABELS,
  detectTranslationTarget,
} from '@shared/translation';
import {
  buildPageWindow,
  findInDocument,
  getSelectionInPage,
} from '../lib/pdf';
import {
  PDF_CACHE_INVALIDATED,
  clearAll,
  invalidatePaper,
  keyFor,
  load as loadCachedDocument,
  parsePdfDocument,
  peek,
} from '../lib/pdf-document-cache';
import type { PageSize } from '../lib/pdf-document-cache';
import {
  positionFromGeometry,
} from '../lib/reading-position';
import type { PageGeometry } from '../lib/reading-position';
import { confirm } from '../stores/confirm';
import { errorMessage, stripIpcErrorPrefix } from '../lib/errors';
import { cropToDataUrl, toSourceRect } from '../lib/screenshot';
import type { Rect } from '../lib/screenshot';
import { normalizeTranslationError } from '../lib/translation-error';
import { translationCardPosition } from '../lib/translation-position';
import {
  PAGE_NOTE_ICON_SIZE,
  anchorPopupPosition,
  freePopupPosition,
  hitTestTextNote,
  normalizeSelectionRects,
  noteAnchorPoint,
  pinPositionFromDrag,
  rightPopupPosition,
  textNotePopupAnchor,
} from '../lib/sticky-note-geometry';
import { findMarkForSelection, markFamily } from '../lib/annotation-marks';
import type { AnnotationMarkFamily } from '../lib/annotation-marks';
import { DEFAULT_DRAWING_COLOR } from '../lib/annotation-colors';
import type { DrawingTool } from '../lib/annotation-drawing';
import { useReaderStore } from '../stores/reader';
import type { ReaderSelection } from '../stores/reader';
import { useLibraryStore } from '../stores/library';
import { useSettingsStore } from '../stores/settings';
import { useStickyNotesStore } from '../stores/sticky-notes';
import { useTranslationStore } from '../stores/translation';
import { AnnotationPins } from './AnnotationPins';
import { AnnotationToolbar } from './AnnotationToolbar';
import { DrawingToolbar } from './DrawingToolbar';
import { PdfPage } from './PdfPage';
import { StickyNoteDialog } from './StickyNoteDialog';
import type { StickyNoteFormValue } from './StickyNoteDialog';
import { StickyNoteHighlights } from './StickyNoteHighlights';
import { StickyNotePopup } from './StickyNotePopup';
import { RegionCapture } from './RegionCapture';
import { SelectionTranslationCard } from './SelectionTranslationCard';

export interface PdfViewerProps {
  paper: Paper;
  focusMode: boolean;
  onToggleFocusMode(): void;
  /** 大纲面板是否展开；关闭后由工具栏「大纲」按钮重新打开。 */
  outlineOpen: boolean;
  onToggleOutline(): void;
  /** 智慧阅读面板是否显示；由工具栏按钮开关。 */
  aiPanelOpen: boolean;
  onToggleAiPanel(): void;
  onAskAI?(selection: ReaderSelection): void;
  onJudgeDepth?(selection: ReaderSelection): void;
  onSaveNote?(selection: ReaderSelection): void;
  onCaptureAsk?(imageDataUrl: string): void;
  /** Opens the settings dialog from the translation card's unconfigured hint. */
  onOpenSettings?(): void;
  /** Opens the translation-engine tab when whole-paper translation cannot start. */
  onOpenEngineSettings?(): void;
}

interface ToolbarPosition {
  top: number;
  left: number;
}

/** An open free-selection translation request and where its card points. */
interface TranslationCardTarget {
  /** Full snapshot so a saved sticky note keeps the original page/version. */
  selection: ReaderSelection;
  top: number;
  left: number;
  seq: number;
}

// Card geometry: width matches styles.css; the height is the estimated maximum
// (3-line original + 300px scrollable result + status + actions).
const TRANSLATION_CARD_WIDTH = 420;
const TRANSLATION_CARD_MAX_HEIGHT = 440;
const TRANSLATION_CARD_GAP = 48;
const TRANSLATION_CARD_MARGIN = 8;

// Sticky-note popup: 380px wide (matches styles.css) with an estimated height
// used for all three placement modes.
const STICKY_POPUP_WIDTH = 380;
const STICKY_POPUP_MAX_HEIGHT = 380;

// Fullscreen reading lets the toolbar retreat after this idle period.
const FOCUS_TOOLBAR_IDLE_MS = 2800;
// How long the "move to the top" hint stays after the toolbar hides.
const FOCUS_TOOLBAR_HINT_MS = 3000;

/** Fixed placement fields for a note that does not exist yet. */
interface StickyNoteDraft {
  quote: string;
  pageNo: number;
  version: PdfVersion;
  source: StickyNoteSource;
  anchor: StickyNoteAnchor;
  /** Pin fixed by a click on the page, instead of the default side stack. */
  pin?: AnnotationPin | null;
}

type StickyNoteDialogState =
  | { mode: 'create'; draft: StickyNoteDraft }
  | { mode: 'edit'; note: StickyNote };

/** One undoable drawing operation; `notes` are the created or erased rows. */
interface DrawingHistoryEntry {
  action: 'create' | 'erase';
  notes: StickyNote[];
}

/** True while the reader still shows the paper/version an operation targeted. */
function readerDomainUnchanged(
  paperId: number,
  version: PdfVersion,
): boolean {
  const state = useReaderStore.getState();
  return state.paperId === paperId && state.version === version;
}

/**
 * Store writes clear `error` when they start. After a failed replay the
 * compensation writes would hide the failure that triggered them, so the
 * original message is put back once compensation settled.
 */
function restoreStoreError(message: string | null): void {
  if (message === null || useStickyNotesStore.getState().error !== null) {
    return;
  }
  useStickyNotesStore.setState({ error: message });
}

/** Recreate payload: every stored field except the row's identity/timestamps. */
function drawingCreateInput(note: StickyNote): StickyNoteCreateInput {
  return {
    paperId: note.paperId,
    pdfVersion: note.pdfVersion,
    pageNo: note.pageNo,
    quote: note.quote,
    contentMd: note.contentMd,
    anchor: note.anchor,
    source: note.source,
    kind: note.kind,
    markStyle: note.markStyle,
    color: note.color,
    pin: note.pin,
    popup: note.popup,
    drawing: note.drawing,
  };
}

export function PdfViewer({
  paper,
  focusMode,
  onToggleFocusMode,
  outlineOpen,
  onToggleOutline,
  aiPanelOpen,
  onToggleAiPanel,
  onAskAI,
  onJudgeDepth,
  onSaveNote,
  onCaptureAsk,
  onOpenSettings,
  onOpenEngineSettings,
}: PdfViewerProps): React.JSX.Element {
  const version = useReaderStore((state) => state.version);
  const currentPage = useReaderStore((state) => state.currentPage);
  const positionSeq = useReaderStore((state) => state.positionSeq);
  const zoom = useReaderStore((state) => state.zoom);
  const storeError = useReaderStore((state) => state.error);
  const versionNotice = useReaderStore((state) => state.versionNotice);
  const dismissVersionNotice = useReaderStore((state) => state.dismissVersionNotice);
  const selection = useReaderStore((state) => state.selection);
  const open = useReaderStore((state) => state.open);
  const setVersion = useReaderStore((state) => state.setVersion);
  const setCurrentPosition = useReaderStore((state) => state.setCurrentPosition);
  const flushPosition = useReaderStore((state) => state.flushPosition);
  const adoptDocumentPageCount = useReaderStore(
    (state) => state.adoptDocumentPageCount,
  );
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
  // checkFiles reports the sibling BabelDOC dual output. A primary that is
  // itself bilingual must not be offered again as 仅译文.
  const fileStatus = useLibraryStore((state) => state.fileStatus[paper.id]);
  const translatedOnlyAvailable =
    translationBound && !(fileStatus?.translatedIsBilingual ?? false);
  const bilingualAvailable =
    translationBound && fileStatus?.bilingualExists === true;
  const translationJob = useTranslationStore((state) => state.job);
  const donePaper = useTranslationStore((state) => state.donePaper);
  const startPaperTranslation = useTranslationStore((state) => state.start);
  const paperTranslating =
    translationJob !== null &&
    translationJob.status === 'running' &&
    translationJob.paperId === paper.id;
  const stickyNotes = useStickyNotesStore((state) => state.notes);
  const activeNoteId = useStickyNotesStore((state) => state.activeNoteId);
  const openNote = useStickyNotesStore((state) => state.openNote);
  const stickyError = useStickyNotesStore((state) => state.error);
  const clearStickyError = useStickyNotesStore((state) => state.clearError);
  const activeNote = useMemo(
    () => stickyNotes.find((note) => note.id === activeNoteId) ?? null,
    [stickyNotes, activeNoteId],
  );

  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [pageSizes, setPageSizes] = useState<PageSize[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [relocating, setRelocating] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [translationStartError, setTranslationStartError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [matches, setMatches] = useState<number[] | null>(null);
  const [matchIndex, setMatchIndex] = useState(0);
  const [searching, setSearching] = useState(false);

  const [toolbarPosition, setToolbarPosition] = useState<ToolbarPosition | null>(null);
  const [annotationMenuOpen, setAnnotationMenuOpen] = useState(false);
  // Fullscreen: hide the toolbar until the reader moves, types or scrolls
  // again. Hovering it, an open menu or an active tool keeps it pinned.
  const [toolbarHidden, setToolbarHidden] = useState(false);
  const [toolbarHovered, setToolbarHovered] = useState(false);
  const [toolbarHintVisible, setToolbarHintVisible] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [popupPosition, setPopupPosition] = useState<ToolbarPosition | null>(null);
  const [stickyNoteDialog, setStickyNoteDialog] = useState<StickyNoteDialogState | null>(
    null,
  );
  // Armed by 便签 when nothing is selected. It stays on while reading so a
  // right-click on any page can add a note at that point; the mode itself
  // never creates anything.
  const [noteMode, setNoteMode] = useState(false);

  // Drawing mode state lives here (not in PdfPage) so one history spans pages.
  const [drawingMode, setDrawingMode] = useState(false);
  const [drawingTool, setDrawingTool] = useState<DrawingTool>('pen');
  const [drawingColor, setDrawingColor] = useState<string>(DEFAULT_DRAWING_COLOR);
  const [drawingWidth, setDrawingWidth] = useState(3);
  const [undoStack, setUndoStack] = useState<DrawingHistoryEntry[]>([]);
  const [redoStack, setRedoStack] = useState<DrawingHistoryEntry[]>([]);

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
  const pdfToolbarRef = useRef<HTMLDivElement | null>(null);
  const toolbarAutoHideTimerRef = useRef<number | null>(null);
  const toolbarHintTimerRef = useRef<number | null>(null);
  const popupRef = useRef<HTMLDivElement | null>(null);
  // First-render placement uses the estimated card box; the real, measured
  // size replaces it as soon as the card has rendered (see the layout effect).
  const popupSizeRef = useRef({
    width: STICKY_POPUP_WIDTH,
    height: STICKY_POPUP_MAX_HEIGHT,
  });
  const searchSeqRef = useRef(0);
  const pageGeometryRef = useRef<PageGeometry[]>([]);
  const programmaticScrollRef = useRef<number | null>(null);
  const programmaticTimerRef = useRef<number | null>(null);
  const translationCardRef = useRef<HTMLDivElement | null>(null);
  // Monotonic request sequence: only the newest translation may set state.
  const translationSeqRef = useRef(0);
  // Serializes undo/redo so a double click cannot interleave stack moves.
  const historyBusyRef = useRef(false);

  // Menus, hover and active tools pin the fullscreen toolbar.
  const toolbarAutoHideBlocked =
    !focusMode ||
    toolbarHovered ||
    searchOpen ||
    annotationMenuOpen ||
    capturing ||
    drawingMode;

  const clearToolbarAutoHide = useCallback((): void => {
    if (toolbarAutoHideTimerRef.current !== null) {
      window.clearTimeout(toolbarAutoHideTimerRef.current);
      toolbarAutoHideTimerRef.current = null;
    }
  }, []);

  const scheduleToolbarAutoHide = useCallback((): void => {
    clearToolbarAutoHide();
    if (toolbarAutoHideBlocked) {
      return;
    }
    toolbarAutoHideTimerRef.current = window.setTimeout(() => {
      toolbarAutoHideTimerRef.current = null;
      // A control that still has keyboard focus must stay reachable.
      if (pdfToolbarRef.current?.contains(document.activeElement)) {
        return;
      }
      setToolbarHidden(true);
    }, FOCUS_TOOLBAR_IDLE_MS);
  }, [clearToolbarAutoHide, toolbarAutoHideBlocked]);

  // Fullscreen chrome retreats when idle; the top edge or Tab brings it back.
  useEffect(() => {
    if (!focusMode) {
      clearToolbarAutoHide();
      setToolbarHidden(false);
      return;
    }
    setToolbarHidden(false);
    scheduleToolbarAutoHide();
    // Tab remains a deliberate way to reach the toolbar for keyboard users;
    // ordinary pointer movement and scrolling never reveal it.
    const revealOnTab = (event: KeyboardEvent): void => {
      if (event.key !== 'Tab') {
        return;
      }
      setToolbarHidden(false);
      scheduleToolbarAutoHide();
    };
    window.addEventListener('keydown', revealOnTab);
    return () => {
      window.removeEventListener('keydown', revealOnTab);
      clearToolbarAutoHide();
    };
  }, [clearToolbarAutoHide, focusMode, scheduleToolbarAutoHide]);

  const revealToolbar = (): void => {
    setToolbarHidden(false);
    scheduleToolbarAutoHide();
  };

  // Each time the toolbar retreats, briefly explain how to bring it back.
  useEffect(() => {
    if (toolbarHintTimerRef.current !== null) {
      window.clearTimeout(toolbarHintTimerRef.current);
      toolbarHintTimerRef.current = null;
    }
    if (!focusMode || !toolbarHidden) {
      setToolbarHintVisible(false);
      return;
    }
    setToolbarHintVisible(true);
    toolbarHintTimerRef.current = window.setTimeout(() => {
      toolbarHintTimerRef.current = null;
      setToolbarHintVisible(false);
    }, FOCUS_TOOLBAR_HINT_MS);
    return () => {
      if (toolbarHintTimerRef.current !== null) {
        window.clearTimeout(toolbarHintTimerRef.current);
        toolbarHintTimerRef.current = null;
      }
    };
  }, [focusMode, toolbarHidden]);

  // Clicking the gray space around the pages counts as a request to clear the
  // chrome. Clicks inside a page keep the selection/annotation flow intact.
  const handleReadingPointerDown = (
    event: React.PointerEvent<HTMLDivElement>,
  ): void => {
    if (!focusMode) {
      return;
    }
    const target = event.target;
    if (
      target instanceof Element &&
      target.closest('.pdf-page-wrapper') !== null
    ) {
      return;
    }
    clearToolbarAutoHide();
    setToolbarHidden(true);
  };

  const closeTranslation = useCallback((): void => {
    translationSeqRef.current += 1;
    setTranslationTarget(null);
    setTranslationLoading(false);
    setTranslationResult(null);
    setTranslationError(null);
    setTranslationUnconfigured(false);
  }, []);

  const startTranslation = useCallback(
    (selected: ReaderSelection, top: number, left: number): void => {
      const seq = translationSeqRef.current + 1;
      translationSeqRef.current = seq;
      setTranslationTarget({ selection: selected, top, left, seq });
      setTranslationLoading(true);
      setTranslationResult(null);
      setTranslationError(null);
      setTranslationUnconfigured(false);
      window.api.translate.text({ text: selected.text }).then(
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
          const message = normalizeTranslationError(error);
          if (message === TRANSLATION_NOT_CONFIGURED) {
            setTranslationUnconfigured(true);
          } else {
            setTranslationError(message);
          }
          setTranslationLoading(false);
        },
      );
    },
    [],
  );

  // Load (and reload after relocation) the document for the current paper.
  useEffect(() => {
    let cancelled = false;
    // Direct parses (repaired files) are not cached, so this effect owns them.
    let directTask: PDFDocumentLoadingTask | null = null;

    setPdf(null);
    setPageSizes([]);
    pageGeometryRef.current = [];
    setLoadError(null);
    setMatches(null);
    setMatchIndex(0);
    setSearching(false);
    setToolbarPosition(null);
    setCapturing(false);
    setCaptureError(null);
    setTranslationStartError(null);
    closeTranslation();
    searchSeqRef.current += 1;

    const loadDocument = async (): Promise<void> => {
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

      const currentVersion = useReaderStore.getState().version;
      const key = keyFor(paper, currentVersion);
      try {
        const cached = peek(key);
        if (cached !== null) {
          // Metadata page counts can be provisional for legacy bilingual rows;
          // PDF.js's actual count is authoritative before the first restore.
          adoptDocumentPageCount(cached.pdf.numPages);
          setPageSizes(cached.pageSizes);
          setPdf(cached.pdf);
          return;
        }

        const loaded = await window.api.pdf.load(paper.id, currentVersion);
        if (cancelled) {
          return;
        }
        if (loaded.repaired === true) {
          // A repaired document must not stay under the stale binding key.
          invalidatePaper(paper.id);
          void useLibraryStore
            .getState()
            .load()
            .catch((refreshError: unknown) => {
              console.warn('刷新文献库失败', refreshError);
            });
          const parsed = await parsePdfDocument(loaded.data);
          directTask = parsed.loadingTask;
          if (cancelled) {
            void parsed.loadingTask.destroy();
            return;
          }
          adoptDocumentPageCount(parsed.pdf.numPages);
          setPageSizes(parsed.pageSizes);
          setPdf(parsed.pdf);
          return;
        }

        const entry = await loadCachedDocument(key, () =>
          parsePdfDocument(loaded.data),
        );
        if (cancelled) {
          return;
        }
        adoptDocumentPageCount(entry.pdf.numPages);
        setPageSizes(entry.pageSizes);
        setPdf(entry.pdf);
      } catch (error) {
        if (cancelled) {
          return;
        }
        if (error instanceof Error && error.message === PDF_CACHE_INVALIDATED) {
          // A newer generation owns the document; re-enter through the effect.
          setReloadToken((token) => token + 1);
          return;
        }
        const message = errorMessage(error);
        setLoadError(message);
        // Mirror viewer-owned failures into the store for other panels.
        setError(message);
      }
    };

    void loadDocument();

    return () => {
      cancelled = true;
      if (directTask !== null) {
        void directTask.destroy();
      }
    };
  }, [
    paper.id,
    reloadToken,
    version,
    open,
    setError,
    closeTranslation,
    adoptDocumentPageCount,
  ]);

  // The cached task outlives this view on purpose; only the session teardown
  // destroys parsed documents.
  useEffect(
    () => () => {
      void flushPosition();
      clearAll();
    },
    [flushPosition],
  );

  // Switch to one of the available document layouts. The pending progress
  // write still carries the old version and is flushed before the new load.
  const switchVersion = useCallback(
    async (target: PdfVersion): Promise<void> => {
      if (switching || target === useReaderStore.getState().version) {
        return;
      }
      if (target !== 'original') {
        if (!translationBound) {
          return;
        }
        if (target === 'translated' && !translatedOnlyAvailable) {
          return;
        }
        if (target === 'bilingual' && !bilingualAvailable) {
          return;
        }
      }
      setSwitching(true);
      try {
        await setVersion(target);
      } finally {
        setSwitching(false);
      }
    },
    [
      switching,
      translationBound,
      translatedOnlyAvailable,
      bilingualAvailable,
      setVersion,
    ],
  );

  // Ctrl+Shift+T cycles 原文 → 仅译文 → 中英对照, skipping unavailable views.
  const cycleVersion = useCallback((): void => {
    if (switching) {
      return;
    }
    const versions: PdfVersion[] = ['original'];
    if (translatedOnlyAvailable) {
      versions.push('translated');
    }
    if (bilingualAvailable) {
      versions.push('bilingual');
    }
    if (versions.length === 1) {
      return;
    }
    const current = useReaderStore.getState().version;
    const index = versions.indexOf(current);
    const next = versions[(index + 1) % versions.length] ?? 'original';
    void switchVersion(next);
  }, [switching, translatedOnlyAvailable, bilingualAvailable, switchVersion]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey) || !event.shiftKey) {
        return;
      }
      if (event.repeat || event.key.toLowerCase() !== 't') {
        return;
      }
      event.preventDefault();
      cycleVersion();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [cycleVersion]);

  // Page tops in the reading container's scroll coordinates. The wrappers have
  // explicit widths/heights, so only a document or zoom change moves them.
  useLayoutEffect(() => {
    const container = scrollRef.current;
    if (container === null) {
      pageGeometryRef.current = [];
      return;
    }
    const containerRect = container.getBoundingClientRect();
    const geometry: PageGeometry[] = [];
    container
      .querySelectorAll<HTMLElement>('[data-page-no]')
      .forEach((wrapper) => {
        const page = Number(wrapper.dataset.pageNo);
        if (!Number.isFinite(page)) {
          return;
        }
        const rect = wrapper.getBoundingClientRect();
        geometry.push({
          page,
          top: rect.top - containerRect.top + container.scrollTop,
          height: rect.height,
        });
      });
    pageGeometryRef.current = geometry;
  }, [pdf, pageSizes.length, zoom]);

  const updatePositionFromScroll = useCallback((): void => {
    const container = scrollRef.current;
    if (container === null || programmaticScrollRef.current !== null) {
      return;
    }
    if (pageGeometryRef.current.length === 0) {
      return;
    }
    const position = positionFromGeometry(
      pageGeometryRef.current,
      container.scrollTop,
    );
    const state = useReaderStore.getState();
    if (
      position.page === state.currentPage &&
      Math.abs(position.offset - state.currentOffset) < 1e-6
    ) {
      return;
    }
    setCurrentPosition(position.page, position.offset);
  }, [setCurrentPosition]);

  // Restore the saved page and intra-page offset after load, and follow
  // outline/search jumps and version switches. Scroll updates produced by this
  // effect are suppressed in the scroll handler.
  useLayoutEffect(() => {
    if (pdf === null || pageSizes.length === 0) {
      return;
    }
    const container = scrollRef.current;
    if (container === null) {
      return;
    }
    const state = useReaderStore.getState();
    const wrapper = container.querySelector<HTMLElement>(
      `[data-page-no="${state.currentPage}"]`,
    );
    if (wrapper === null) {
      return;
    }
    programmaticScrollRef.current = state.currentPage;
    if (programmaticTimerRef.current !== null) {
      window.clearTimeout(programmaticTimerRef.current);
    }
    programmaticTimerRef.current = window.setTimeout(() => {
      programmaticScrollRef.current = null;
      programmaticTimerRef.current = null;
    }, 200);
    const wrapperRect = wrapper.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    container.scrollTop +=
      wrapperRect.top -
      containerRect.top +
      state.currentOffset * wrapperRect.height;
    return () => {
      if (programmaticTimerRef.current !== null) {
        window.clearTimeout(programmaticTimerRef.current);
        programmaticTimerRef.current = null;
      }
      programmaticScrollRef.current = null;
    };
  }, [pdf, pageSizes.length, zoom, positionSeq]);

  // Warm the other available layouts once the current page is on screen so a
  // later version switch does not wait on IPC + parsing. Failures (including a
  // repaired file, which must not be cached under a stale binding key) are
  // ignored here and retried by the normal open path.
  useEffect(() => {
    if (pdf === null || pageSizes.length === 0) {
      return;
    }
    const activeVersion = useReaderStore.getState().version;
    const targets: PdfVersion[] = [];
    if (translatedOnlyAvailable) {
      targets.push('translated');
    }
    if (bilingualAvailable) {
      targets.push('bilingual');
    }
    const pending = targets.filter(
      (target) =>
        target !== activeVersion && peek(keyFor(paper, target)) === null,
    );
    if (pending.length === 0) {
      return;
    }

    let cancelled = false;
    const run = (): void => {
      void (async () => {
        for (const target of pending) {
          if (cancelled) {
            return;
          }
          const key = keyFor(paper, target);
          if (peek(key) !== null) {
            continue;
          }
          try {
            await loadCachedDocument(key, async () => {
              const loaded = await window.api.pdf.load(paper.id, target);
              if (loaded.repaired === true) {
                throw new Error('修复后的 PDF 不进入预载缓存');
              }
              return parsePdfDocument(loaded.data);
            });
          } catch {
            // The on-demand path reports real errors to the user.
          }
        }
      })();
    };

    const supportsIdle = typeof window.requestIdleCallback === 'function';
    const handle = supportsIdle
      ? window.requestIdleCallback(run)
      : window.setTimeout(run, 200);
    return () => {
      cancelled = true;
      if (supportsIdle) {
        window.cancelIdleCallback(handle);
      } else {
        window.clearTimeout(handle);
      }
    };
  }, [
    pdf,
    pageSizes.length,
    paper,
    translatedOnlyAvailable,
    bilingualAvailable,
  ]);

  // A finished whole-paper translation rebinds the files behind the paper, so
  // every parsed document for it is stale. A translated/bilingual view reloads
  // in place; the original layout is unaffected visually but its cache entry
  // is still invalidated so the next switch sees the new binding.
  useEffect(() => {
    if (donePaper === null || donePaper.id !== paper.id) {
      return;
    }
    invalidatePaper(paper.id);
    if (useReaderStore.getState().version !== 'original') {
      setReloadToken((token) => token + 1);
    }
  }, [donePaper, paper.id]);

  // Fixed-position note popup. Placement depends on the note's stored mode:
  // `anchor` follows the mark (and closes on user movement so a fixed card
  // never drifts away from it), `right` pins to the reading area's right edge,
  // and `free` restores the drag-saved reading-area position.
  const placeActiveNotePopup = useCallback((note: StickyNote): void => {
    const container = scrollRef.current;
    if (container === null) {
      setPopupPosition(null);
      return;
    }
    const readingBounds = container.getBoundingClientRect();
    const popupSize = popupSizeRef.current;
    // Notes without a stored placement open as draggable cards, matching the
    // create dialog's default and keeping the last dropped position. A pure
    // mark keeps following its highlight, where the card is most useful.
    const mode = note.popup?.mode ?? (note.kind === 'note' ? 'free' : 'anchor');

    if (mode === 'free') {
      const position =
        note.popup !== null && note.popup.mode === 'free'
          ? { x: note.popup.x, y: note.popup.y }
          : { x: 0.5, y: 0.25 };
      setPopupPosition(freePopupPosition(position, readingBounds, popupSize));
      return;
    }

    const wrapper = container.querySelector<HTMLElement>(
      `[data-page-no="${note.pageNo}"]`,
    );
    if (wrapper === null) {
      setPopupPosition(null);
      return;
    }
    const wrapperRect = wrapper.getBoundingClientRect();
    if (wrapperRect.width <= 0 || wrapperRect.height <= 0) {
      setPopupPosition(null);
      return;
    }

    if (note.anchor.kind === 'text') {
      // A body-mark note follows its first selection rect. A markless note's
      // visible pin is its only marker, so the card follows the dragged pin.
      const anchor = textNotePopupAnchor(note, {
        width: wrapperRect.width,
        height: wrapperRect.height,
      });
      if (anchor === null) {
        setPopupPosition(null);
        return;
      }
      if (mode === 'right') {
        setPopupPosition(
          rightPopupPosition(
            wrapperRect.top + anchor.rightY,
            readingBounds,
            popupSize,
          ),
        );
        return;
      }
      setPopupPosition(
        anchorPopupPosition(
          {
            x: wrapperRect.left + anchor.x,
            y: wrapperRect.top + anchor.bottom,
          },
          readingBounds,
          popupSize,
        ),
      );
      return;
    }

    // Same stack as AnnotationPins and the PDF export: every page-anchored
    // note occupies a slot, even one whose visible pin overrides the icon.
    const pageNotes = useStickyNotesStore
      .getState()
      .notes.filter(
        (candidate) =>
          candidate.pageNo === note.pageNo &&
          candidate.kind === 'note' &&
          candidate.anchor.kind === 'page',
      )
      .sort((a, b) => a.createdAt - b.createdAt || a.id - b.id);
    const index = pageNotes.findIndex((candidate) => candidate.id === note.id);
    const point = noteAnchorPoint(
      note,
      { width: wrapperRect.width, height: wrapperRect.height },
      index < 0 ? 0 : index,
    );
    if (point === null) {
      setPopupPosition(null);
      return;
    }

    if (mode === 'right') {
      setPopupPosition(
        rightPopupPosition(wrapperRect.top + point.y, readingBounds, popupSize),
      );
      return;
    }
    setPopupPosition(
      anchorPopupPosition(
        {
          x: wrapperRect.left + point.x,
          y: wrapperRect.top + point.y + PAGE_NOTE_ICON_SIZE / 2,
        },
        readingBounds,
        popupSize,
      ),
    );
  }, []);

  // Anchor popups are invalidated by any reading-area movement, but the fixed
  // right/free placements only need to be recomputed.
  const repositionActiveNote = useCallback((): void => {
    const store = useStickyNotesStore.getState();
    const id = store.activeNoteId;
    if (id === null) {
      return;
    }
    const note = store.notes.find((candidate) => candidate.id === id);
    if (note === undefined) {
      return;
    }
    const mode = note.popup?.mode ?? (note.kind === 'note' ? 'free' : 'anchor');
    if (mode === 'anchor') {
      store.openNote(null);
      return;
    }
    placeActiveNotePopup(note);
  }, [placeActiveNotePopup]);

  useEffect(() => {
    if (activeNote === null) {
      setPopupPosition(null);
      return;
    }
    if (pdf === null) {
      return;
    }
    // A rebuilt translation can have fewer pages than when the note was made.
    // Such notes stay in the list but do not open here.
    if (activeNote.pageNo > pdf.numPages) {
      openNote(null);
      return;
    }
    placeActiveNotePopup(activeNote);
  }, [
    activeNote,
    pdf,
    pageSizes.length,
    currentPage,
    openNote,
    placeActiveNotePopup,
  ]);

  // The estimate is only a first-render fallback: once the fixed card has a
  // layout box, adopt its measured size so every placement mode clamps with
  // the box the user actually sees (otherwise a short free card snaps upward
  // by the height difference after a drop). The 0.5px tolerance stops the
  // effect from re-placing once the measurement settles.
  useLayoutEffect(() => {
    if (activeNote === null) {
      return;
    }
    const card = popupRef.current?.querySelector<HTMLElement>(
      '.sticky-note-popup',
    );
    if (card === null || card === undefined) {
      return;
    }
    const rect = card.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return;
    }
    const measured = popupSizeRef.current;
    if (
      Math.abs(rect.width - measured.width) <= 0.5 &&
      Math.abs(rect.height - measured.height) <= 0.5
    ) {
      return;
    }
    popupSizeRef.current = { width: rect.width, height: rect.height };
    placeActiveNotePopup(activeNote);
  }, [activeNote, popupPosition, placeActiveNotePopup]);

  // Zooming invalidates anchored cards' page coordinates; right/free re-place.
  useEffect(() => {
    repositionActiveNote();
  }, [zoom, repositionActiveNote]);

  // Version switches must not leave a note from the old layout on screen.
  useEffect(() => {
    const store = useStickyNotesStore.getState();
    if (store.activeNoteId !== null) {
      store.openNote(null);
    }
    setStickyNoteDialog(null);
  }, [version]);

  // Drawing is view-scoped: another paper or version invalidates both the
  // mode and the local undo/redo history that referred to the old rows.
  useEffect(() => {
    setDrawingMode(false);
    setUndoStack([]);
    setRedoStack([]);
  }, [paper.id, version]);

  useEffect(() => {
    const handleResize = (): void => {
      repositionActiveNote();
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [repositionActiveNote]);

  // Clicking anywhere outside the popup closes it. Clicks inside (edit,
  // delete, close, content selection) pass through untouched.
  useEffect(() => {
    if (activeNote === null) {
      return;
    }
    const handleMouseDown = (event: MouseEvent): void => {
      const target = event.target;
      if (target instanceof Node && popupRef.current?.contains(target)) {
        return;
      }
      openNote(null);
    };
    window.addEventListener('mousedown', handleMouseDown);
    return () => {
      window.removeEventListener('mousedown', handleMouseDown);
    };
  }, [activeNote, openNote]);


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
        setSearchOpen(true);
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
    if (!searchOpen) {
      return;
    }
    const input = searchInputRef.current;
    if (input !== null) {
      input.focus();
      input.select();
    }
  }, [searchOpen]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') {
        return;
      }
      // In drawing mode Esc only leaves the mode; other UI stays as it is and
      // the drawing history is kept for a later drawing session.
      if (drawingMode) {
        setDrawingMode(false);
        return;
      }
      // Esc leaves note mode only when no note dialog is open; inside the
      // dialog it just closes the dialog and keeps the mode armed.
      if (noteMode && stickyNoteDialog === null) {
        setNoteMode(false);
        return;
      }
      useReaderStore.getState().setSelection(null);
      setToolbarPosition(null);
      closeTranslation();
      useStickyNotesStore.getState().openNote(null);
      setStickyNoteDialog(null);
      window.getSelection()?.removeAllRanges();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [closeTranslation, drawingMode, noteMode, stickyNoteDialog]);

  useEffect(() => {
    if (selection === null) {
      return;
    }
    const handleMouseDown = (event: MouseEvent): void => {
      const target = event.target;
      if (target instanceof Node && toolbarRef.current?.contains(target)) {
        return;
      }
      // The top annotation toolbar acts on the current selection, so clicking
      // it must keep that selection alive.
      if (
        target instanceof Element &&
        target.closest('[data-keep-selection="true"]') !== null
      ) {
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
    // Drawing mode owns pointer/keyboard gestures on the page: neither a
    // pointer drag nor a keyboard selection may open the floating toolbar.
    if (drawingMode) {
      return;
    }
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
    const bounds = wrapper.getBoundingClientRect();
    const rects = normalizeSelectionRects(
      {
        left: bounds.left,
        top: bounds.top,
        width: bounds.width,
        height: bounds.height,
      },
      selected.range.getClientRects(),
    );
    setSelection({
      text: selected.text,
      pageNo: Number(wrapper.dataset.pageNo),
      version,
      rects,
    });
    const rect = selected.range.getBoundingClientRect();
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

  // A drag-select ends with a live selection and keeps the existing toolbar
  // flow. A plain click leaves none, so it can hit-test text marks without
  // ever interfering with text selection. Page-margin pins are handled by
  // AnnotationPins, which stops the event before it reaches this handler.
  const handleMouseUp = (event: React.MouseEvent<HTMLDivElement>): void => {
    // Drawing mode never hit-tests text marks; the capture layer owns the
    // gesture and the text layer has pointer-events disabled.
    if (drawingMode) {
      return;
    }
    // Only the primary button drives selection and mark hit-testing; right
    // clicks belong to the note-mode context menu.
    if (event.button !== 0) {
      return;
    }
    const target = event.target;
    const wrapper =
      target instanceof Element ? target.closest<HTMLElement>('[data-page-no]') : null;
    if (wrapper !== null && getSelectionInPage(wrapper) === null) {
      const bounds = wrapper.getBoundingClientRect();
      const pageNo = Number(wrapper.dataset.pageNo);
      const pageNotes = useStickyNotesStore
        .getState()
        .notes.filter(
          (note) =>
            note.paperId === paper.id &&
            note.pdfVersion === version &&
            note.pageNo === pageNo,
        );
      const hit =
        bounds.width > 0 && bounds.height > 0
          ? hitTestTextNote(pageNotes, {
              x: (event.clientX - bounds.left) / bounds.width,
              y: (event.clientY - bounds.top) / bounds.height,
            })
          : null;
      if (hit !== null) {
        openNote(hit.id);
        setSelection(null);
        setToolbarPosition(null);
        window.getSelection()?.removeAllRanges();
        return;
      }
    }
    handleSelectionEvent(event);
  };

  // In note mode a right-click on a page opens the create dialog with the pin
  // fixed at that point. Left clicks keep working as normal (selection,
  // text-mark hit-testing), so the mode can stay on while reading.
  const handleContextMenu = (
    event: React.MouseEvent<HTMLDivElement>,
  ): void => {
    if (!noteMode || drawingMode) {
      return;
    }
    event.preventDefault();
    const target = event.target;
    const wrapper =
      target instanceof Element
        ? target.closest<HTMLElement>('[data-page-no]')
        : null;
    if (wrapper === null) {
      return;
    }
    const bounds = wrapper.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) {
      return;
    }
    const point = pinPositionFromDrag(
      bounds,
      { x: event.clientX, y: event.clientY },
      { x: PAGE_NOTE_ICON_SIZE / 2, y: PAGE_NOTE_ICON_SIZE / 2 },
    );
    setStickyNoteDialog({
      mode: 'create',
      draft: {
        quote: '',
        pageNo: Number(wrapper.dataset.pageNo),
        version,
        source: 'manual',
        anchor: { kind: 'page' },
        pin: { x: point.x, y: point.y, visible: true },
      },
    });
    setSelection(null);
    setToolbarPosition(null);
    useStickyNotesStore.getState().openNote(null);
    window.getSelection()?.removeAllRanges();
  };

  const handleEditActiveNote = (): void => {
    if (activeNote === null) {
      return;
    }
    openNote(null);
    setStickyNoteDialog({ mode: 'edit', note: activeNote });
  };

  const handleCreateStickyNote = (): void => {
    const selected = selection;
    if (selected === null) {
      // No selection: toggle note mode. Turning it on adds nothing by
      // itself; a right-click later places the note. Clicking 便签 again
      // (or Esc) leaves the mode.
      setNoteMode((current) => !current);
      setSelection(null);
      setToolbarPosition(null);
      useStickyNotesStore.getState().openNote(null);
      window.getSelection()?.removeAllRanges();
      return;
    }
    setNoteMode(false);
    setStickyNoteDialog({
      mode: 'create',
      draft: {
        quote: selected.text,
        pageNo: selected.pageNo,
        version: selected.version,
        source: 'manual',
        anchor:
          selected.rects.length > 0
            ? { kind: 'text', rects: selected.rects }
            : { kind: 'page' },
      },
    });
    setSelection(null);
    setToolbarPosition(null);
    window.getSelection()?.removeAllRanges();
  };

  /**
   * Creates, recolours, restyles or removes the pure mark of `style`'s family
   * for the current selection. The selection and floating toolbar survive the
   * operation.
   */
  const handleApplyMark = async (
    style: AnnotationMarkStyle,
    color: string,
  ): Promise<void> => {
    const selected = selection;
    if (selected === null || selected.rects.length === 0) {
      return;
    }
    const family = markFamily(style);
    if (family === null) {
      return;
    }
    const store = useStickyNotesStore.getState();
    const existing = findMarkForSelection(
      store.notes,
      selected.pageNo,
      selected.rects,
      family,
    );

    const createMark = (): Promise<StickyNote | null> =>
      store.create({
        paperId: paper.id,
        pdfVersion: selected.version,
        pageNo: selected.pageNo,
        quote: selected.text,
        contentMd: '',
        anchor: { kind: 'text', rects: selected.rects },
        source: 'manual',
        kind: 'mark',
        markStyle: style,
        color,
        pin: null,
        popup: null,
        drawing: null,
      });

    if (family === 'highlight') {
      if (existing === null) {
        await createMark();
        return;
      }
      if (existing.color === color) {
        return;
      }
      await store.update(existing.id, { markStyle: 'highlight', color });
      return;
    }

    if (family === 'underline') {
      if (existing === null) {
        await createMark();
        return;
      }
      if (existing.markStyle === style) {
        if (existing.color === color) {
          await store.remove(existing.id);
        } else {
          await store.update(existing.id, { color });
        }
        return;
      }
      await store.update(existing.id, { markStyle: style, color });
      return;
    }

    // Strikeout: same colour toggles it off, a different colour is recoloured.
    if (existing === null) {
      await createMark();
      return;
    }
    if (existing.color === color) {
      await store.remove(existing.id);
    } else {
      await store.update(existing.id, { color });
    }
  };

  /** Removes the same-family pure mark on the current selection, if any. */
  const handleClearMark = async (
    family: AnnotationMarkFamily,
  ): Promise<void> => {
    const selected = selection;
    if (selected === null || selected.rects.length === 0) {
      return;
    }
    const store = useStickyNotesStore.getState();
    const existing = findMarkForSelection(
      store.notes,
      selected.pageNo,
      selected.rects,
      family,
    );
    if (existing === null) {
      return;
    }
    await store.remove(existing.id);
  };

  /**
   * Persists one drawing as a page-anchored ink/shape row. The optional
   * pageNo is carried by the per-page closure because the layer callbacks
   * themselves only receive the drawing.
   */
  const commitDrawing = useCallback(
    async (
      pageNo: number,
      kind: 'ink' | 'shape',
      drawing: AnnotationDrawing,
    ): Promise<boolean> => {
      const startPaperId = paper.id;
      const startVersion = version;
      const created = await useStickyNotesStore.getState().create({
        paperId: startPaperId,
        pdfVersion: startVersion,
        pageNo,
        quote: '',
        contentMd: '',
        anchor: { kind: 'page' },
        source: 'manual',
        kind,
        markStyle: 'none',
        color: null,
        pin: null,
        popup: null,
        drawing,
      });
      if (created === null) {
        return false;
      }
      // The DB write stands, but a paper/version switch already cleared the
      // history that this entry belonged to.
      if (!readerDomainUnchanged(startPaperId, startVersion)) {
        return true;
      }
      setUndoStack((stack) => [...stack, { action: 'create', notes: [created] }]);
      setRedoStack([]);
      return true;
    },
    [paper.id, version],
  );

  const handleCommitStroke = useCallback(
    (pageNo: number, stroke: AnnotationStroke): Promise<boolean> =>
      commitDrawing(pageNo, 'ink', stroke),
    [commitDrawing],
  );

  const handleCommitShape = useCallback(
    (pageNo: number, shape: AnnotationShapeData): Promise<boolean> =>
      commitDrawing(pageNo, 'shape', shape),
    [commitDrawing],
  );

  /** Erases every candidate it can; only successful removals enter history. */
  const handleErase = useCallback(
    async (candidates: StickyNote[]): Promise<void> => {
      const startPaperId = paper.id;
      const startVersion = version;
      const removed: StickyNote[] = [];
      let failure: string | null = null;
      for (const note of candidates) {
        const ok = await useStickyNotesStore.getState().remove(note.id);
        if (!readerDomainUnchanged(startPaperId, startVersion)) {
          return;
        }
        if (ok) {
          removed.push(note);
        } else if (failure === null) {
          // Capture the first failure before a later successful remove starts
          // with `set({ error: null })` and hides it from the banner.
          failure = useStickyNotesStore.getState().error;
        }
      }
      if (removed.length > 0) {
        setUndoStack((stack) => [...stack, { action: 'erase', notes: removed }]);
        setRedoStack([]);
      }
      // Even with no successful removal, a failed candidate must keep its
      // store error visible (restoreStoreError is a no-op for a null message).
      restoreStoreError(failure);
    },
    [paper.id, version],
  );

  /**
   * Moves one entry between the stacks only after its database work settled.
   * A partial erase replay is compensated (best effort) and leaves both
   * stacks untouched, so the history never claims a state the DB lost.
   */
  const handleUndo = useCallback(async (): Promise<void> => {
    if (historyBusyRef.current) {
      return;
    }
    const entry = undoStack.at(-1);
    if (entry === undefined) {
      return;
    }
    historyBusyRef.current = true;
    const startPaperId = paper.id;
    const startVersion = version;
    try {
      if (entry.action === 'create') {
        const removed: StickyNote[] = [];
        for (const note of entry.notes) {
          const ok = await useStickyNotesStore.getState().remove(note.id);
          if (!readerDomainUnchanged(startPaperId, startVersion)) {
            return;
          }
          if (!ok) {
            const failure = useStickyNotesStore.getState().error;
            for (const gone of removed) {
              if (!readerDomainUnchanged(startPaperId, startVersion)) {
                return;
              }
              await useStickyNotesStore
                .getState()
                .create(drawingCreateInput(gone));
            }
            restoreStoreError(failure);
            return;
          }
          removed.push(note);
        }
        setUndoStack((stack) => stack.slice(0, -1));
        setRedoStack((stack) => [...stack, entry]);
        return;
      }
      // Undo erase: recreate every removed row from its create-input fields.
      const created: StickyNote[] = [];
      for (const note of entry.notes) {
        const result = await useStickyNotesStore
          .getState()
          .create(drawingCreateInput(note));
        if (!readerDomainUnchanged(startPaperId, startVersion)) {
          return;
        }
        if (result === null) {
          const failure = useStickyNotesStore.getState().error;
          for (const made of created) {
            if (!readerDomainUnchanged(startPaperId, startVersion)) {
              return;
            }
            await useStickyNotesStore.getState().remove(made.id);
          }
          restoreStoreError(failure);
          return;
        }
        created.push(result);
      }
      setUndoStack((stack) => stack.slice(0, -1));
      setRedoStack((stack) => [
        ...stack,
        { action: 'erase', notes: created },
      ]);
    } finally {
      historyBusyRef.current = false;
    }
  }, [undoStack, paper.id, version]);

  const handleRedo = useCallback(async (): Promise<void> => {
    if (historyBusyRef.current) {
      return;
    }
    const entry = redoStack.at(-1);
    if (entry === undefined) {
      return;
    }
    historyBusyRef.current = true;
    const startPaperId = paper.id;
    const startVersion = version;
    try {
      if (entry.action === 'create') {
        const created: StickyNote[] = [];
        for (const note of entry.notes) {
          const result = await useStickyNotesStore
            .getState()
            .create(drawingCreateInput(note));
          if (!readerDomainUnchanged(startPaperId, startVersion)) {
            return;
          }
          if (result === null) {
            const failure = useStickyNotesStore.getState().error;
            for (const made of created) {
              if (!readerDomainUnchanged(startPaperId, startVersion)) {
                return;
              }
              await useStickyNotesStore.getState().remove(made.id);
            }
            restoreStoreError(failure);
            return;
          }
          created.push(result);
        }
        setRedoStack((stack) => stack.slice(0, -1));
        setUndoStack((stack) => [
          ...stack,
          { action: 'create', notes: created },
        ]);
        return;
      }
      // Redo erase: remove every row, compensating a partial failure.
      const removed: StickyNote[] = [];
      for (const note of entry.notes) {
        const ok = await useStickyNotesStore.getState().remove(note.id);
        if (!readerDomainUnchanged(startPaperId, startVersion)) {
          return;
        }
        if (!ok) {
          const failure = useStickyNotesStore.getState().error;
          for (const gone of removed) {
            if (!readerDomainUnchanged(startPaperId, startVersion)) {
              return;
            }
            await useStickyNotesStore
              .getState()
              .create(drawingCreateInput(gone));
          }
          restoreStoreError(failure);
          return;
        }
        removed.push(note);
      }
      setRedoStack((stack) => stack.slice(0, -1));
      setUndoStack((stack) => [...stack, { action: 'erase', notes: removed }]);
    } finally {
      historyBusyRef.current = false;
    }
  }, [redoStack, paper.id, version]);

  /** Clear-page is deliberately not undoable; it only resets both stacks. */
  const handleClearPage = useCallback(async (): Promise<void> => {
    const ok = await confirm({
      title: '清空本页绘制',
      message: '清空本页所有绘制？文字标记和便签不会删除。',
      confirmLabel: '清空',
      tone: 'danger',
    });
    if (!ok) {
      return;
    }
    const startPaperId = paper.id;
    const startVersion = version;
    const cleared = await useStickyNotesStore
      .getState()
      .clearPageDrawings(paper.id, version, currentPage);
    if (!readerDomainUnchanged(startPaperId, startVersion)) {
      return;
    }
    if (cleared === null) {
      return;
    }
    setUndoStack([]);
    setRedoStack([]);
  }, [paper.id, version, currentPage]);

  /** Entering closes transient annotation UI and the DOM selection first. */
  const handleToggleDrawing = useCallback((): void => {
    if (drawingMode) {
      setDrawingMode(false);
      return;
    }
    closeTranslation();
    useStickyNotesStore.getState().openNote(null);
    setStickyNoteDialog(null);
    setNoteMode(false);
    setSelection(null);
    setToolbarPosition(null);
    window.getSelection()?.removeAllRanges();
    setDrawingMode(true);
  }, [drawingMode, closeTranslation, setSelection]);

  const handleToolChange = useCallback((tool: DrawingTool): void => {
    setDrawingTool(tool);
    if (tool === 'highlighter') {
      setDrawingWidth(16);
    } else if (tool === 'pen') {
      setDrawingWidth(3);
    }
  }, []);

  const handleSaveTranslationSticky = async (): Promise<void> => {
    if (translationTarget === null || translationResult === null) {
      return;
    }
    const target = translationTarget.selection;
    const created = await useStickyNotesStore.getState().create({
      paperId: paper.id,
      pdfVersion: target.version,
      pageNo: target.pageNo,
      quote: target.text,
      contentMd: translationResult,
      anchor:
        target.rects.length > 0
          ? { kind: 'text', rects: target.rects }
          : { kind: 'page' },
      source: 'translation',
      // New note cards open draggable and keep the position they are dropped at.
      popup: { mode: 'free', x: 0.5, y: 0.25 },
    });
    if (created === null) {
      return;
    }
    closeTranslation();
    setSelection(null);
    window.getSelection()?.removeAllRanges();
  };

  const handleDeleteActiveNote = async (note: StickyNote): Promise<void> => {
    const ok = await confirm({
      title: '删除标注',
      message: '删除这条标注？',
      confirmLabel: '删除',
      tone: 'danger',
    });
    if (!ok) {
      return;
    }
    openNote(null);
    await useStickyNotesStore.getState().remove(note.id);
  };

  const handleSaveStickyNote = async (
    value: StickyNoteFormValue,
  ): Promise<boolean> => {
    const dialog = stickyNoteDialog;
    if (dialog === null) {
      return false;
    }
    const store = useStickyNotesStore.getState();
    if (dialog.mode === 'edit') {
      const updated = await store.update(dialog.note.id, value);
      if (updated === null) {
        throw new Error(useStickyNotesStore.getState().error ?? '保存标注失败');
      }
      setStickyNoteDialog(null);
      // Reopen the popup so the edited content is visible immediately.
      store.openNote(updated.id);
      return true;
    }
    const created = await store.create({
      paperId: paper.id,
      pdfVersion: dialog.draft.version,
      pageNo: dialog.draft.pageNo,
      quote: dialog.draft.quote,
      anchor: dialog.draft.anchor,
      source: dialog.draft.source,
      ...value,
    });
    if (created === null) {
      throw new Error(useStickyNotesStore.getState().error ?? '保存标注失败');
    }
    setStickyNoteDialog(null);
    return true;
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
    const position = translationCardPosition({
      anchorTop: toolbarPosition.top,
      anchorLeft: toolbarPosition.left,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      cardWidth: TRANSLATION_CARD_WIDTH,
      cardHeight: TRANSLATION_CARD_MAX_HEIGHT,
      gap: TRANSLATION_CARD_GAP,
      margin: TRANSLATION_CARD_MARGIN,
    });
    startTranslation(selection, position.top, position.left);
  };

  const handleStartPaperTranslation = async (): Promise<void> => {
    setTranslationStartError(null);
    try {
      await startPaperTranslation(paper.id);
    } catch (error) {
      const message = stripIpcErrorPrefix(errorMessage(error));
      if (message === TRANSLATION_ENGINE_MISSING && onOpenEngineSettings !== undefined) {
        onOpenEngineSettings();
        return;
      }
      setTranslationStartError(message);
    }
  };

  const handleRelocate = async (): Promise<void> => {
    setRelocating(true);
    try {
      // Repair the file whose load failed; fall back to the displayed version.
      // A broken bilingual sibling is repaired by rebinding the primary
      // translation, so relocation always targets original or translated.
      const state = useReaderStore.getState();
      const failed = state.failedVersion ?? state.version;
      const target: PdfVersion =
        failed === 'original' ? 'original' : 'translated';
      // The pending position belongs to the old file and must land before the
      // repaired binding changes which document owns it.
      await flushPosition();
      invalidatePaper(paper.id);
      const updated = await window.api.papers.relocate(paper.id, target);
      // A stale continuation must not act on a paper that is no longer open.
      if (useReaderStore.getState().paperId !== paper.id) {
        return;
      }
      if (updated !== null) {
        setLoadError(null);
        setError(null);
        // Reload metadata (path, page count, outline) for the relocated file.
        await open(paper.id);
        if (useReaderStore.getState().paperId !== paper.id) {
          return;
        }
        if (useReaderStore.getState().version !== target) {
          await setVersion(target);
          if (useReaderStore.getState().paperId !== paper.id) {
            return;
          }
        }
        // The version effect may already have started a load; the token makes
        // sure a file replaced at the same metadata is read again.
        setReloadToken((token) => token + 1);
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

  return (
    <div className="pdf-viewer">
      <div
        ref={pdfToolbarRef}
        className={
          focusMode && toolbarHidden
            ? 'pdf-toolbar pdf-toolbar-hidden'
            : 'pdf-toolbar'
        }
        onMouseEnter={() => setToolbarHovered(true)}
        onMouseLeave={() => setToolbarHovered(false)}
      >
        <div className="pdf-toolbar-left">
          <button
            type="button"
            className={
              searchOpen
                ? 'pdf-toolbar-button active'
                : 'pdf-toolbar-button'
            }
            aria-label="页内搜索"
            aria-expanded={searchOpen}
            title="页内搜索（Ctrl+F）"
            disabled={pdf === null}
            onClick={() => setSearchOpen((current) => !current)}
          >
            搜索
          </button>
          {!focusMode && (
            <button
              type="button"
              className={
                outlineOpen
                  ? 'pdf-toolbar-button active'
                  : 'pdf-toolbar-button'
              }
              aria-label={outlineOpen ? '收起大纲' : '显示大纲'}
              aria-expanded={outlineOpen}
              title={outlineOpen ? '收起大纲' : '显示大纲'}
              onClick={onToggleOutline}
            >
              大纲
            </button>
          )}
          <button
            type="button"
            className={
              aiPanelOpen
                ? 'pdf-toolbar-button active'
                : 'pdf-toolbar-button'
            }
            aria-label={aiPanelOpen ? '收起智慧阅读' : '打开智慧阅读'}
            aria-expanded={aiPanelOpen}
            title={aiPanelOpen ? '收起智慧阅读' : '打开智慧阅读'}
            onClick={onToggleAiPanel}
          >
            智慧阅读
          </button>
          <AnnotationToolbar
            disabled={pdf === null}
            hasSelection={selection !== null && selection.rects.length > 0}
            noteMode={noteMode}
            onCreateNote={handleCreateStickyNote}
            onApplyMark={(style, color) => {
              void handleApplyMark(style, color);
            }}
            onClearMark={(family) => {
              void handleClearMark(family);
            }}
            drawingMode={drawingMode}
            onToggleDrawing={handleToggleDrawing}
            onMenuOpenChange={setAnnotationMenuOpen}
          />
        </div>
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
          {(paperTranslating || !translationBound) && (
            <button
              type="button"
              className="pdf-toolbar-button"
              title="用 BabelDOC 生成保留排版的整篇中文译本"
              disabled={paperTranslating}
              onClick={() => {
                void handleStartPaperTranslation();
              }}
            >
              {paperTranslating ? '翻译中…' : '生成中文译本'}
            </button>
          )}
          <div className="pdf-version-switch" role="group" aria-label="阅读版本切换">
            <button
              type="button"
              className={version === 'original' ? 'active' : undefined}
              aria-pressed={version === 'original'}
              title="显示原文 PDF（Ctrl+Shift+T 循环切换）"
              disabled={switching}
              onClick={() => {
                void switchVersion('original');
              }}
            >
              原文
            </button>
            <button
              type="button"
              className={version === 'translated' ? 'active' : undefined}
              aria-pressed={version === 'translated'}
              title={
                !translationBound
                  ? '尚未绑定译本'
                  : translatedOnlyAvailable
                    ? '仅显示中文译文（Ctrl+Shift+T 循环切换）'
                    : '当前译本本身是中英对照版，没有单独的仅译文版'
              }
              disabled={switching || !translatedOnlyAvailable}
              onClick={() => {
                void switchVersion('translated');
              }}
            >
              仅译文
            </button>
            <button
              type="button"
              className={version === 'bilingual' ? 'active' : undefined}
              aria-pressed={version === 'bilingual'}
              title={
                !translationBound
                  ? '尚未绑定译本'
                  : bilingualAvailable
                    ? '原文与译文对照显示（Ctrl+Shift+T 循环切换）'
                    : '当前译本没有中英对照版'
              }
              disabled={switching || !bilingualAvailable}
              onClick={() => {
                void switchVersion('bilingual');
              }}
            >
              中英对照
            </button>
          </div>
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

        {searchOpen && (
          <form
            className="pdf-search-popover"
            role="search"
            aria-label="页内搜索"
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
              aria-label="页内搜索输入"
              disabled={pdf === null}
              onChange={(event) => handleQueryChange(event.target.value)}
            />
            <button
              type="submit"
              className="pdf-toolbar-button"
              disabled={pdf === null || searching}
            >
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
            <button
              type="button"
              className="pdf-toolbar-button"
              aria-label="关闭页内搜索"
              onClick={() => setSearchOpen(false)}
            >
              关闭
            </button>
          </form>
        )}
      </div>

      {focusMode && toolbarHidden && (
        <div
          className="pdf-toolbar-reveal"
          aria-hidden="true"
          onPointerEnter={revealToolbar}
          onPointerDown={revealToolbar}
        />
      )}

      {focusMode && toolbarHidden && toolbarHintVisible && (
        <div className="pdf-toolbar-hint" role="status">
          将鼠标移到屏幕顶部可显示功能栏
        </div>
      )}

      {drawingMode && (
        <DrawingToolbar
          tool={drawingTool}
          color={drawingColor}
          width={drawingWidth}
          canUndo={undoStack.length > 0}
          canRedo={redoStack.length > 0}
          onToolChange={handleToolChange}
          onColorChange={setDrawingColor}
          onWidthChange={setDrawingWidth}
          onUndo={() => {
            void handleUndo();
          }}
          onRedo={() => {
            void handleRedo();
          }}
          onClearPage={() => {
            void handleClearPage();
          }}
          onExit={() => setDrawingMode(false)}
        />
      )}

      {noteMode && (
        <div className="note-mode-hint" role="status">
          便签模式：在页面上右键添加便签，Esc 退出
        </div>
      )}

      {captureError !== null && (
        <div className="viewer-capture-error" role="alert">
          <span>{captureError}</span>
          <button type="button" className="menu-button" onClick={() => setCaptureError(null)}>
            关闭
          </button>
        </div>
      )}

      {translationStartError !== null && (
        <div className="viewer-capture-error" role="alert">
          <span>{translationStartError}</span>
          <button
            type="button"
            className="menu-button"
            onClick={() => setTranslationStartError(null)}
          >
            关闭
          </button>
        </div>
      )}

      {versionNotice !== null && (
        <div className="viewer-version-notice" role="status">
          <span>{versionNotice}</span>
          <button type="button" className="menu-button" onClick={dismissVersionNotice}>
            知道了
          </button>
        </div>
      )}

      {stickyError !== null && (
        <div className="viewer-capture-error" role="alert">
          <span>{stickyError}</span>
          <button type="button" className="menu-button" onClick={clearStickyError}>
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
          className={drawingMode ? 'pdf-scroll drawing-mode' : 'pdf-scroll'}
          ref={scrollRef}
          data-reading-area="true"
          onPointerDown={handleReadingPointerDown}
          onContextMenu={handleContextMenu}
          onScroll={() => {
            // Scrolling the reading area invalidates anchored cards. A list
            // jump scrolls programmatically, so its just-opened popup survives.
            closeTranslation();
            if (programmaticScrollRef.current === null) {
              repositionActiveNote();
            }
            updatePositionFromScroll();
          }}
          onMouseUp={handleMouseUp}
          onKeyUp={handleSelectionEvent}
        >
          <div className="pdf-pages">
            {Array.from({ length: pdf.numPages }, (_, index) => {
              const pageNo = index + 1;
              const size = pageSizes[index];
              const pageNotes = stickyNotes.filter(
                (note) => note.pageNo === pageNo,
              );
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
                    <PdfPage
                      pdf={pdf}
                      pageNo={pageNo}
                      zoom={zoom}
                      overlay={
                        <StickyNoteHighlights
                          notes={pageNotes}
                          activeNoteId={activeNoteId}
                        />
                      }
                      pinOverlay={
                        <AnnotationPins
                          notes={pageNotes}
                          pageWidth={size === undefined ? 0 : size.width * zoom}
                          pageHeight={size === undefined ? 0 : size.height * zoom}
                          activeNoteId={activeNoteId}
                          disabled={drawingMode}
                          onOpen={(note) => openNote(note.id)}
                          onMove={(note, pin) =>
                            useStickyNotesStore
                              .getState()
                              .update(note.id, { pin })
                              .then(Boolean)
                          }
                        />
                      }
                      drawing={{
                        enabled: drawingMode,
                        tool: drawingTool,
                        color: drawingColor,
                        width: drawingWidth,
                        notes: pageNotes.filter(
                          (note) =>
                            note.kind === 'ink' || note.kind === 'shape',
                        ),
                        onCommitStroke: (stroke) =>
                          handleCommitStroke(pageNo, stroke),
                        onCommitShape: (shape) =>
                          handleCommitShape(pageNo, shape),
                        onErase: handleErase,
                      }}
                    />
                  ) : (
                    <div className="pdf-page-placeholder" />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {focusMode && pdf !== null && (
        <div
          className="pdf-page-indicator"
          aria-label={`第 ${Math.min(currentPage, pdf.numPages)} 页，共 ${pdf.numPages} 页`}
        >
          {Math.min(currentPage, pdf.numPages)}/{pdf.numPages}
        </div>
      )}

      {selection !== null && toolbarPosition !== null && !annotationMenuOpen && (
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
            text={translationTarget.selection.text}
            targetLabel={
              TRANSLATION_TARGET_LABELS[
                detectTranslationTarget(translationTarget.selection.text)
              ]
            }
            top={translationTarget.top}
            left={translationTarget.left}
            loading={translationLoading}
            translation={translationResult}
            error={translationError}
            unconfigured={translationUnconfigured}
            onRetry={() => {
              startTranslation(
                translationTarget.selection,
                translationTarget.top,
                translationTarget.left,
              );
            }}
            onClose={closeTranslation}
            onSaveSticky={() => {
              void handleSaveTranslationSticky();
            }}
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

      {activeNote !== null && popupPosition !== null && (
        <div ref={popupRef}>
          <StickyNotePopup
            key={activeNote.id}
            note={activeNote}
            top={popupPosition.top}
            left={popupPosition.left}
            onClose={() => openNote(null)}
            onEdit={handleEditActiveNote}
            onDelete={() => {
              void handleDeleteActiveNote(activeNote);
            }}
            onMoveFree={async (x, y) => {
              await useStickyNotesStore.getState().update(activeNote.id, {
                popup: { mode: 'free', x, y },
              });
            }}
          />
        </div>
      )}

      {stickyNoteDialog !== null && (
        <StickyNoteDialog
          key={
            stickyNoteDialog.mode === 'edit'
              ? `edit-${stickyNoteDialog.note.id}`
              : 'create'
          }
          mode={stickyNoteDialog.mode}
          note={stickyNoteDialog.mode === 'edit' ? stickyNoteDialog.note : undefined}
          initialQuote={
            stickyNoteDialog.mode === 'create'
              ? stickyNoteDialog.draft.quote
              : undefined
          }
          pageNo={
            stickyNoteDialog.mode === 'create'
              ? stickyNoteDialog.draft.pageNo
              : undefined
          }
          version={
            stickyNoteDialog.mode === 'create'
              ? stickyNoteDialog.draft.version
              : undefined
          }
          source={
            stickyNoteDialog.mode === 'create'
              ? stickyNoteDialog.draft.source
              : undefined
          }
          anchor={
            stickyNoteDialog.mode === 'create'
              ? stickyNoteDialog.draft.anchor
              : undefined
          }
          initialPin={
            stickyNoteDialog.mode === 'create'
              ? stickyNoteDialog.draft.pin ?? null
              : undefined
          }
          onSave={handleSaveStickyNote}
          onClose={() => setStickyNoteDialog(null)}
        />
      )}

      {capturing && <RegionCapture onSelect={handleCaptureRegion} onCancel={cancelCapture} />}
    </div>
  );
}
