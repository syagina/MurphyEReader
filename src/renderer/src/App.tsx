import { useEffect, useRef, useState } from 'react';
import {
  AI_PANEL_DEFAULT_WIDTH,
  AI_PANEL_MIN_WIDTH,
  aiPanelMaxWidth,
  clampAiFloatingBounds,
  clampAiPanelWidth,
  defaultAiFloatingBounds,
  moveAiFloatingBounds,
  resizeAiFloatingBounds,
  resizeAiPanelWidth,
  type AiPanelFloatingBounds,
  type AiPanelLayout,
} from '@shared/ai-panel';
import type { Paper, SearchResult, StickyNote } from '@shared/types';
import { ChatPanel } from './components/ChatPanel';
import { LibraryView } from './components/LibraryView';
import { NotesPanel } from './components/NotesPanel';
import { Onboarding } from './components/Onboarding';
import { OutlinePanel } from './components/OutlinePanel';
import { PdfViewer } from './components/PdfViewer';
import { SearchPanel } from './components/SearchPanel';
import { SettingsDialog } from './components/SettingsDialog';
import type { SettingsTab } from './components/SettingsDialog';
import { StickyNotesPanel } from './components/StickyNotesPanel';
import { ThemeSwitcher } from './components/ThemeSwitcher';
import { TranslationStatusButton } from './components/TranslationStatusButton';
import { TranslationStatusCard } from './components/TranslationStatusCard';
import {
  readAiFloatingBounds,
  readAiPanelLayout,
  writeAiFloatingBounds,
  writeAiPanelLayout,
} from './lib/ai-panel-layout';
import { errorMessage } from './lib/errors';
import { resolveOnboardingVisibility } from './lib/onboarding';
import { applyPaperTexture } from './lib/paper-texture';
import { applyTheme } from './lib/theme';
import { useAppSettingsStore } from './stores/app-settings';
import { useChatStore } from './stores/chat';
import { useLibraryStore } from './stores/library';
import { useNotesStore } from './stores/notes';
import { useReaderStore } from './stores/reader';
import type { ReaderSelection } from './stores/reader';
import { useSearchStore } from './stores/search';
import { useSettingsStore } from './stores/settings';
import { useStickyNotesStore } from './stores/sticky-notes';
import { useStorageStore } from './stores/storage';
import { useTranslationStore } from './stores/translation';

type AiTab = 'chat' | 'notes' | 'sticky';
type OnboardingGate = 'checking' | 'open' | 'closed';

/** Collapsed floating chrome stays wide enough for its title and expand button. */
const AI_FLOATING_COLLAPSED_WIDTH = 160;
/** Tall enough for the panel bar's 44px minimum plus the floating border. */
const AI_FLOATING_COLLAPSED_HEIGHT = 48;

interface ConceptPrompt {
  selection: ReaderSelection;
  title: string;
}

/** A chat message or note hit that still has to be revealed after the paper opens. */
type PendingLocate =
  | { kind: 'message'; paperId: number; conversationId: number; seq: number }
  | { kind: 'note'; paperId: number; noteId: number; seq: number };

export default function App(): React.JSX.Element {
  const [openedPaper, setOpenedPaper] = useState<Paper | null>(null);
  const [libraryView, setLibraryView] = useState(true);
  const [outlineHidden, setOutlineHidden] = useState(false);
  const [aiCollapsed, setAiCollapsed] = useState(false);
  // The toolbar 开关 hides the whole panel (unlike 收起, which leaves the rail).
  const [aiHidden, setAiHidden] = useState(false);
  // Docked AI panel width in px. Dragging updates it live; only the pointer-up
  // (or keyboard/double-click) writes it through app settings.
  const [aiWidth, setAiWidth] = useState(AI_PANEL_DEFAULT_WIDTH);
  const [resizing, setResizing] = useState(false);
  // The free-floating layout is a per-window workspace preference. It is
  // mirrored in localStorage so it restores before app settings finish loading.
  const [aiLayout, setAiLayout] = useState<AiPanelLayout>(readAiPanelLayout);
  const [floatBounds, setFloatBounds] = useState<AiPanelFloatingBounds>(() =>
    readAiFloatingBounds(window.innerWidth, window.innerHeight),
  );
  // Pointer origin and id of the active separator drag; null when not dragging.
  const resizeStartRef = useRef<{
    pointerId: number;
    startX: number;
    startWidth: number;
  } | null>(null);
  const floatDragStartRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startBounds: AiPanelFloatingBounds;
  } | null>(null);
  const floatResizeStartRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startBounds: AiPanelFloatingBounds;
  } | null>(null);
  // Focus mode hides the top bar, library chrome and outline, and asks the
  // main process for a real full-screen window.
  const [focusMode, setFocusMode] = useState(false);
  const [aiTab, setAiTab] = useState<AiTab>('chat');
  const [conceptPrompt, setConceptPrompt] = useState<ConceptPrompt | null>(null);
  const [pendingLocate, setPendingLocate] = useState<PendingLocate | null>(null);
  // Region-screenshot attachment waiting in the chat composer.
  const [pendingImage, setPendingImage] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('ai');
  // Startup is gated on a lightweight SQLite check so the library cannot flash
  // before a first-run wizard appears.
  const [onboardingState, setOnboardingState] =
    useState<OnboardingGate>('checking');
  // Click-time navigation failures stay visible in the top bar until dismissed,
  // unlike the dropdown error which disappears with the query.
  const [clickError, setClickError] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  // Monotonic sequence for result clicks; every continuation after an await
  // verifies it so a slower older click can never win over a newer one.
  const locateSeqRef = useRef(0);
  const theme = useAppSettingsStore((state) => state.settings?.theme ?? null);
  const paperTexture = useAppSettingsStore(
    (state) => state.settings?.paperTexture ?? null,
  );
  const papers = useLibraryStore((state) => state.papers);
  const generatingNote = useNotesStore((state) => state.generating);
  const searchQuery = useSearchStore((state) => state.query);
  const setSearchQuery = useSearchStore((state) => state.setQuery);
  const clearSearch = useSearchStore((state) => state.clear);
  const readerPaperId = useReaderStore((state) => state.paperId);
  const readerVersion = useReaderStore((state) => state.version);
  const loadStickyNotes = useStickyNotesStore((state) => state.load);
  const resetStickyNotes = useStickyNotesStore((state) => state.reset);

  // Keep the open reader's snapshot in sync with library changes (a newly
  // bound translation, relocation metadata, edited title, refreshed outline).
  useEffect(() => {
    if (openedPaper === null) {
      return;
    }
    const current = papers.find((paper) => paper.id === openedPaper.id);
    if (current !== undefined) {
      if (current !== openedPaper) {
        setOpenedPaper(current);
      }
      return;
    }
    // The open paper was deleted (or its metadata reload came back without
    // it). Never leave the reader pointing at a row that no longer exists.
    if (!useLibraryStore.getState().loading) {
      setOpenedPaper(null);
      setLibraryView(true);
      setFocusMode(false);
    }
  }, [papers, openedPaper]);

  const openedPaperId = openedPaper === null ? null : openedPaper.id;

  // Sticky notes are scoped to the open paper and its current PDF version.
  // Discard them when leaving the reader so another paper never inherits the
  // previous paper's highlights; reload whenever the version changes.
  useEffect(() => {
    if (libraryView || openedPaperId === null || readerPaperId !== openedPaperId) {
      resetStickyNotes();
      return;
    }
    void loadStickyNotes(openedPaperId, readerVersion);
  }, [
    libraryView,
    openedPaperId,
    readerPaperId,
    readerVersion,
    loadStickyNotes,
    resetStickyNotes,
  ]);

  // Load AI settings once so vision availability is known before the settings
  // dialog is ever opened. The store records its own load errors.
  useEffect(() => {
    void useSettingsStore.getState().load();
  }, []);

  // Keep the document theme in sync with the persisted setting. The starting
  // value already came from localStorage in main.tsx.
  useEffect(() => {
    if (theme !== null) {
      applyTheme(theme);
    }
  }, [theme]);

  // Grain strength is independent of the theme; the 纸感 CSS rules read it.
  useEffect(() => {
    if (paperTexture !== null) {
      applyPaperTexture(paperTexture);
    }
  }, [paperTexture]);

  // First-run check runs alongside the full settings load. The IPC only reads
  // SQLite, so a slow BabelDOC probe cannot delay or flash the library.
  useEffect(() => {
    let cancelled = false;
    void resolveOnboardingVisibility(() =>
      window.api.appSettings.getOnboarding(),
    ).then((state) => {
      if (!cancelled) {
        setOnboardingState(state);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Restore the persisted AI panel width once. Clamp it against the current
  // window because it may have been saved on a wider screen; the store records
  // its own load errors.
  useEffect(() => {
    void useAppSettingsStore
      .getState()
      .load()
      .then(() => {
        const settings = useAppSettingsStore.getState().settings;
        if (settings !== null) {
          setAiWidth(clampAiPanelWidth(settings.aiPanelWidth, window.innerWidth));
        }
      });
  }, []);

  // Shrinking the window can invalidate the current width. Re-clamp locally
  // without persisting, so a temporarily small window never overwrites the
  // width the reader chose on a larger screen.
  useEffect(() => {
    const handleResize = (): void => {
      setAiWidth((width) => clampAiPanelWidth(width, window.innerWidth));
      setFloatBounds((bounds) =>
        clampAiFloatingBounds(bounds, window.innerWidth, window.innerHeight),
      );
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Subscribe to storage busy/migration events for the library banners and
  // read the current storage status once. StrictMode may mount twice; the
  // store keeps a single subscription and the cleanup re-arms it.
  useEffect(() => {
    return useStorageStore.getState().init();
  }, []);

  // Whole-paper translation progress is app-global: one job at a time, shown
  // as the fixed status card on both the library and reader views.
  useEffect(() => {
    return useTranslationStore.getState().init();
  }, []);

  // A pending concept card belongs to the paper it was started from, and so
  // does a pending screenshot.
  useEffect(() => {
    setConceptPrompt(null);
    setPendingImage(null);
  }, [openedPaperId]);

  // Ctrl+K focuses the global search from anywhere in the window.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (onboardingState === 'open') {
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onboardingState]);

  // Search hits for chat messages/notes are located only after the paper is
  // open, so panels mounted by the open can no longer overwrite the target.
  useEffect(() => {
    if (
      pendingLocate === null ||
      openedPaper === null ||
      openedPaper.id !== pendingLocate.paperId
    ) {
      return;
    }
    const locate = pendingLocate;
    setPendingLocate(null);
    if (locate.seq !== locateSeqRef.current) {
      // A newer result click superseded this locate before it could run.
      return;
    }
    if (locate.kind === 'message') {
      // The chat store reports load failures through its own error state,
      // which the (now mounted) chat panel displays.
      void useChatStore.getState().openConversation(locate.paperId, locate.conversationId);
      return;
    }
    // `load` resolves even when it records an error in the notes store.
    void useNotesStore
      .getState()
      .load(locate.paperId)
      .then(() => {
        if (locate.seq !== locateSeqRef.current) {
          return;
        }
        useNotesStore.getState().selectNote(locate.noteId);
      });
  }, [pendingLocate, openedPaper]);

  const handleOutlineJump = (pageNo: number): void => {
    useReaderStore.getState().jumpToPage(pageNo);
  };

  const leaveFocusMode = (): void => {
    setFocusMode(false);
    void window.api.window.setFullscreen(false).catch(() => {
      // The CSS focus layout still exits even if the window manager refuses.
    });
  };

  const enterFocusMode = (): void => {
    // A docked panel collapses to its rail so the page gets the full width.
    // A floating panel already overlays the page, so leave it as the reader
    // arranged it.
    if (aiLayout === 'docked') {
      setAiCollapsed(true);
    }
    setFocusMode(true);
    void window.api.window.setFullscreen(true).catch(() => {
      // Keep the distraction-free CSS layout when native fullscreen is unavailable.
    });
  };

  const toggleFocusMode = (): void => {
    if (focusMode) {
      leaveFocusMode();
    } else {
      enterFocusMode();
    }
  };

  // Persist a settled width; pointer movement itself never writes settings.
  const persistAiWidth = (width: number): void => {
    void useAppSettingsStore.getState().save({ aiPanelWidth: width }).catch(() => {
      // The store exposes the failure; resizing must keep working regardless.
    });
  };

  const resetAiWidth = (): void => {
    const width = clampAiPanelWidth(AI_PANEL_DEFAULT_WIDTH, window.innerWidth);
    setAiWidth(width);
    persistAiWidth(width);
  };

  const handleResizerPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    resizeStartRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: aiWidth,
    };
    setResizing(true);
  };

  const handleResizerPointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    const start = resizeStartRef.current;
    if (
      start === null ||
      start.pointerId !== event.pointerId ||
      !event.currentTarget.hasPointerCapture(event.pointerId) ||
      (event.buttons & 1) === 0
    ) {
      return;
    }
    setAiWidth(
      resizeAiPanelWidth(start.startWidth, event.clientX - start.startX, window.innerWidth),
    );
  };

  const handleResizerPointerUp = (event: React.PointerEvent<HTMLDivElement>): void => {
    const start = resizeStartRef.current;
    if (start === null || start.pointerId !== event.pointerId) {
      return;
    }
    resizeStartRef.current = null;
    setResizing(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    // Derive the saved width from the pointer-up position too, so it can never
    // lag behind a batched final pointermove.
    const width = resizeAiPanelWidth(
      start.startWidth,
      event.clientX - start.startX,
      window.innerWidth,
    );
    setAiWidth(width);
    persistAiWidth(width);
  };

  // A cancelled drag must never keep the separator hot: clearing the ref makes
  // later pointermoves and pointerup no-ops, and only a real pointerup persists.
  const handleResizerPointerCancel = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (resizeStartRef.current === null) {
      return;
    }
    resizeStartRef.current = null;
    setResizing(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handleResizerLostPointerCapture = (): void => {
    // Idempotent after pointerup/pointercancel: only an active drag is cleared.
    if (resizeStartRef.current === null) {
      return;
    }
    resizeStartRef.current = null;
    setResizing(false);
  };

  // A collapsed panel or a layout switch removes the active drag surface; never
  // leave an abandoned gesture behind for the next mount. Focus mode keeps the
  // separator because the panel can be expanded there too.
  useEffect(() => {
    resizeStartRef.current = null;
    floatDragStartRef.current = null;
    floatResizeStartRef.current = null;
    setResizing(false);
  }, [aiCollapsed, aiLayout]);

  // Losing window focus ends the gesture without a pointerup; clear it so a
  // later hover cannot resize or move the panel.
  useEffect(() => {
    const handleWindowBlur = (): void => {
      if (
        resizeStartRef.current === null &&
        floatDragStartRef.current === null &&
        floatResizeStartRef.current === null
      ) {
        return;
      }
      resizeStartRef.current = null;
      floatDragStartRef.current = null;
      floatResizeStartRef.current = null;
      setResizing(false);
    };
    window.addEventListener('blur', handleWindowBlur);
    return () => window.removeEventListener('blur', handleWindowBlur);
  }, []);

  const handleResizerKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Home') {
      event.preventDefault();
      resetAiWidth();
      return;
    }
    let width: number;
    if (event.key === 'ArrowLeft') {
      width = clampAiPanelWidth(aiWidth + 20, window.innerWidth);
    } else if (event.key === 'ArrowRight') {
      width = clampAiPanelWidth(aiWidth - 20, window.innerWidth);
    } else {
      return;
    }
    event.preventDefault();
    setAiWidth(width);
    persistAiWidth(width);
  };

  /** Open the panel from any reveal path (toolbar, 问 AI, notes, locate). */
  const revealAiPanel = (): void => {
    setAiHidden(false);
    setAiCollapsed(false);
  };

  const toggleAiPanel = (): void => {
    if (aiHidden) {
      revealAiPanel();
    } else {
      setAiHidden(true);
    }
  };

  const toggleAiLayout = (): void => {
    const next: AiPanelLayout = aiLayout === 'docked' ? 'floating' : 'docked';
    if (next === 'floating') {
      const bounds = clampAiFloatingBounds(
        floatBounds,
        window.innerWidth,
        window.innerHeight,
      );
      setFloatBounds(bounds);
      writeAiFloatingBounds(bounds);
    } else {
      setAiWidth(clampAiPanelWidth(floatBounds.width, window.innerWidth));
    }
    setAiCollapsed(false);
    setAiLayout(next);
    writeAiPanelLayout(next);
  };

  const persistFloatBounds = (bounds: AiPanelFloatingBounds): void => {
    setFloatBounds(bounds);
    writeAiFloatingBounds(bounds);
  };

  const handleFloatDragPointerDown = (
    event: React.PointerEvent<HTMLDivElement>,
  ): void => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    floatDragStartRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startBounds: floatBounds,
    };
    setResizing(true);
  };

  const handleFloatDragPointerMove = (
    event: React.PointerEvent<HTMLDivElement>,
  ): void => {
    const start = floatDragStartRef.current;
    if (
      start === null ||
      start.pointerId !== event.pointerId ||
      !event.currentTarget.hasPointerCapture(event.pointerId) ||
      (event.buttons & 1) === 0
    ) {
      return;
    }
    setFloatBounds(
      moveAiFloatingBounds(
        start.startBounds,
        event.clientX - start.startX,
        event.clientY - start.startY,
        window.innerWidth,
        window.innerHeight,
      ),
    );
  };

  const handleFloatDragPointerUp = (
    event: React.PointerEvent<HTMLDivElement>,
  ): void => {
    const start = floatDragStartRef.current;
    if (start === null || start.pointerId !== event.pointerId) {
      return;
    }
    floatDragStartRef.current = null;
    setResizing(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    persistFloatBounds(
      moveAiFloatingBounds(
        start.startBounds,
        event.clientX - start.startX,
        event.clientY - start.startY,
        window.innerWidth,
        window.innerHeight,
      ),
    );
  };

  const cancelFloatDrag = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (floatDragStartRef.current === null) {
      return;
    }
    floatDragStartRef.current = null;
    setResizing(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handleFloatResizePointerDown = (
    event: React.PointerEvent<HTMLButtonElement>,
  ): void => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    floatResizeStartRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startBounds: floatBounds,
    };
    setResizing(true);
  };

  const handleFloatResizePointerMove = (
    event: React.PointerEvent<HTMLButtonElement>,
  ): void => {
    const start = floatResizeStartRef.current;
    if (
      start === null ||
      start.pointerId !== event.pointerId ||
      !event.currentTarget.hasPointerCapture(event.pointerId) ||
      (event.buttons & 1) === 0
    ) {
      return;
    }
    setFloatBounds(
      resizeAiFloatingBounds(
        start.startBounds,
        event.clientX - start.startX,
        event.clientY - start.startY,
        window.innerWidth,
        window.innerHeight,
      ),
    );
  };

  const handleFloatResizePointerUp = (
    event: React.PointerEvent<HTMLButtonElement>,
  ): void => {
    const start = floatResizeStartRef.current;
    if (start === null || start.pointerId !== event.pointerId) {
      return;
    }
    floatResizeStartRef.current = null;
    setResizing(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    persistFloatBounds(
      resizeAiFloatingBounds(
        start.startBounds,
        event.clientX - start.startX,
        event.clientY - start.startY,
        window.innerWidth,
        window.innerHeight,
      ),
    );
  };

  const cancelFloatResize = (event: React.PointerEvent<HTMLButtonElement>): void => {
    if (floatResizeStartRef.current === null) {
      return;
    }
    floatResizeStartRef.current = null;
    setResizing(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handleFloatResizeKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
  ): void => {
    if (event.key === 'Home') {
      event.preventDefault();
      persistFloatBounds(defaultAiFloatingBounds(window.innerWidth, window.innerHeight));
      return;
    }
    let next = floatBounds;
    if (event.key === 'ArrowLeft') {
      next = { ...next, width: next.width - 20 };
    } else if (event.key === 'ArrowRight') {
      next = { ...next, width: next.width + 20 };
    } else if (event.key === 'ArrowUp') {
      next = { ...next, height: next.height - 20 };
    } else if (event.key === 'ArrowDown') {
      next = { ...next, height: next.height + 20 };
    } else {
      return;
    }
    event.preventDefault();
    persistFloatBounds(
      clampAiFloatingBounds(next, window.innerWidth, window.innerHeight),
    );
  };

  const handleOpenPaper = (paper: Paper): void => {
    setClickError(null);
    setPendingLocate(null);
    useReaderStore.getState().clearInitialPage();
    setOpenedPaper(paper);
    setLibraryView(false);
  };

  const handleShowLibrary = (): void => {
    setLibraryView(true);
    if (focusMode) {
      leaveFocusMode();
    }
  };

  const handleContinueReading = (): void => {
    if (openedPaper !== null) {
      setLibraryView(false);
    }
  };

  // Native fullscreen can be toggled by the OS (F11/Escape, window buttons).
  // Mirror those changes into focus mode so hidden chrome comes back.
  useEffect(() => {
    return window.api.window.onFullscreenChange((fullscreen) => {
      setFocusMode(fullscreen);
    });
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (onboardingState === 'open') {
        return;
      }
      if (event.key === 'F11' && openedPaper !== null) {
        event.preventDefault();
        toggleFocusMode();
        return;
      }
      if (event.key === 'Escape' && focusMode) {
        event.preventDefault();
        leaveFocusMode();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  const handleSearchSelect = async (result: SearchResult): Promise<void> => {
    const seq = ++locateSeqRef.current;
    const search = useSearchStore.getState();
    search.setError(null);
    setClickError(null);
    // This click supersedes any earlier one whose one-shot page was never
    // consumed; a later normal open of that paper must not jump to it.
    useReaderStore.getState().clearInitialPage();

    let targetPage: number | null = null;
    let locate: PendingLocate | null = null;
    if (result.kind === 'page') {
      if (result.pageNo === undefined) {
        setClickError('搜索结果缺少页码信息');
        return;
      }
      targetPage = result.pageNo;
    } else if (result.kind === 'message') {
      if (result.conversationId === undefined) {
        setClickError('搜索结果缺少会话信息');
        return;
      }
      locate = {
        kind: 'message',
        paperId: result.paperId,
        conversationId: result.conversationId,
        seq,
      };
    } else {
      if (result.noteId === undefined) {
        setClickError('搜索结果缺少笔记信息');
        return;
      }
      locate = { kind: 'note', paperId: result.paperId, noteId: result.noteId, seq };
    }

    try {
      const paper = await window.api.papers.get(result.paperId);
      if (seq !== locateSeqRef.current) {
        return;
      }
      if (paper === null) {
        setClickError(`文献不存在: ${result.paperId}`);
        return;
      }

      const alreadyOpen =
        useReaderStore.getState().paperId === paper.id && openedPaper?.id === paper.id;
      if (alreadyOpen) {
        // Same reader session: jump in place so the translated version, zoom
        // and selection survive; never re-run open() for the current paper.
        if (targetPage !== null) {
          useReaderStore.getState().jumpToPage(targetPage);
        }
      } else {
        // Switch the paper first, then hand the viewer a one-shot start page;
        // PdfViewer's own open() consumes it. No reader-store mutation happens
        // between the commit and that open, so the old viewer cannot re-open
        // the previous paper and invalidate the target page.
        setOpenedPaper(paper);
        if (targetPage !== null) {
          useReaderStore.getState().requestInitialPage(paper.id, targetPage);
        }
      }
      setLibraryView(false);

      if (locate !== null) {
        revealAiPanel();
        setAiTab(locate.kind === 'message' ? 'chat' : 'notes');
        setPendingLocate(locate);
      } else {
        // A newer page hit supersedes any locate queued by an earlier click.
        setPendingLocate(null);
      }
      search.clear();
    } catch (error) {
      if (seq !== locateSeqRef.current) {
        return;
      }
      setClickError(errorMessage(error));
    }
  };

  const submitConcept = async (): Promise<void> => {
    if (conceptPrompt === null || openedPaper === null) {
      return;
    }
    const title = conceptPrompt.title.trim();
    if (title === '') {
      return;
    }
    const note = await useNotesStore.getState().generate('concept', {
      paperId: openedPaper.id,
      selectionText: conceptPrompt.selection.text,
      conceptTitle: title,
      currentPageNo: conceptPrompt.selection.pageNo,
    });
    // The store selects a generated concept card; keep the form on failure so
    // the user can retry or cancel while the error shows in the notes panel.
    if (note !== null) {
      setConceptPrompt(null);
    }
  };

  // 判断深度: ask for a concept name inline, then generate a concept card and
  // open it in the notes tab.
  const handleJudgeDepth = (selection: ReaderSelection): void => {
    revealAiPanel();
    setAiTab('notes');
    setConceptPrompt({
      selection,
      title: selection.text.trim().slice(0, 40),
    });
  };

  // 存笔记: persist the selection as a manual note and open its editor.
  const handleSaveNote = (selection: ReaderSelection): void => {
    if (openedPaper === null) {
      return;
    }
    revealAiPanel();
    setAiTab('notes');
    const title = selection.text.trim().slice(0, 20) || '手动笔记';
    void useNotesStore.getState().create({
      paperId: openedPaper.id,
      type: 'manual',
      title,
      contentMd: selection.text,
      tags: [],
    });
  };

  // A saved AI note may target the current paper only; load that paper's notes
  // before selecting the new row so the editor opens on the right note.
  const handleOpenNote = (noteId: number): void => {
    if (openedPaper === null) {
      return;
    }
    revealAiPanel();
    setAiTab('notes');
    void useNotesStore
      .getState()
      .load(openedPaper.id)
      .then(() => {
        useNotesStore.getState().selectNote(noteId);
      });
  };

  // Reveal an AI answer's sticky note: switch to its tab, make sure the reader
  // is on the note's PDF version, then jump to its page and open the popup.
  const handleOpenSticky = (note: StickyNote): void => {
    revealAiPanel();
    setAiTab('sticky');
    void (async () => {
      const reader = useReaderStore.getState();
      if (reader.paperId !== note.paperId) {
        return;
      }
      if (reader.version !== note.pdfVersion) {
        await reader.setVersion(note.pdfVersion);
        if (useReaderStore.getState().version !== note.pdfVersion) {
          return;
        }
      }
      await useStickyNotesStore.getState().load(note.paperId, note.pdfVersion);
      if (useStickyNotesStore.getState().version !== note.pdfVersion) {
        return;
      }
      if (useReaderStore.getState().paperId !== note.paperId) {
        return;
      }
      useReaderStore.getState().jumpToPage(note.pageNo);
      useStickyNotesStore.getState().openNote(note.id);
    })();
  };

  // 选框提问: keep the cropped image in the composer, then focus the chat tab.
  const handleCaptureAsk = (imageDataUrl: string): void => {
    setPendingImage(imageDataUrl);
    revealAiPanel();
    setAiTab('chat');
    useChatStore.getState().requestFocus();
  };

  const showLibrary = libraryView || openedPaper === null;

  const aiPanelClass = [
    'ai-panel',
    aiLayout === 'floating' ? 'floating' : '',
    aiCollapsed ? 'collapsed' : '',
    resizing ? 'resizing' : '',
  ]
    .filter((value) => value !== '')
    .join(' ');

  const aiPanelStyle: React.CSSProperties | undefined =
    aiLayout === 'floating'
      ? {
          left: floatBounds.x,
          top: floatBounds.y,
          width: aiCollapsed ? AI_FLOATING_COLLAPSED_WIDTH : floatBounds.width,
          height: aiCollapsed ? AI_FLOATING_COLLAPSED_HEIGHT : floatBounds.height,
        }
      : aiCollapsed
        ? undefined
        : { width: aiWidth, flexBasis: aiWidth };

  const openEngineSettings = (): void => {
    setSettingsTab('engine');
    setSettingsOpen(true);
  };

  const finishOnboarding = (): void => {
    setOnboardingState('closed');
    void useAppSettingsStore
      .getState()
      .save({ onboarded: true })
      .catch(() => {
        // A settings write failure must not block first use; the store keeps
        // the error and the wizard can simply appear again next launch.
      });
  };

  const openOnboardingSettings = (tab: 'ai' | 'engine'): void => {
    finishOnboarding();
    setSettingsTab(tab);
    setSettingsOpen(true);
  };

  const replayOnboarding = (): void => {
    setSettingsOpen(false);
    setOnboardingState('open');
  };

  if (onboardingState === 'checking') {
    return (
      <div className="app-boot" aria-hidden="true">
        <span className="app-boot-brand">MurphyEReader</span>
      </div>
    );
  }

  return (
    <div className={focusMode && !showLibrary ? 'app-frame reader-focus' : 'app-frame'}>
      <header className="app-topbar">
        {/* Static product mark. Navigation back to the library is the
            explicitly labelled button in the reader context. */}
        <span className="app-brand">MurphyEReader</span>
        {!showLibrary && openedPaper !== null && (
          <div className="topbar-reader-context">
            <button type="button" className="topbar-back" onClick={handleShowLibrary}>
              ← 文献库
            </button>
            <span className="topbar-paper-title" title={openedPaper.title}>
              {openedPaper.title}
            </span>
          </div>
        )}
        <div className="global-search">
          <input
            ref={searchInputRef}
            type="text"
            className="global-search-input"
            aria-label="全局搜索"
            placeholder="搜索页码、对话与笔记（Ctrl+K）"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                clearSearch();
                event.currentTarget.blur();
              }
            }}
          />
          <SearchPanel
            onSelect={(result) => {
              void handleSearchSelect(result);
            }}
          />
        </div>
        {clickError !== null && (
          <div className="topbar-error" role="alert">
            <span className="topbar-error-text">{clickError}</span>
            <button
              type="button"
              className="topbar-error-dismiss"
              aria-label="关闭搜索导航错误"
              onClick={() => setClickError(null)}
            >
              关闭
            </button>
          </div>
        )}
        <div className="topbar-actions">
          <TranslationStatusButton />
          <ThemeSwitcher />
          <button
            type="button"
            className="topbar-settings"
            onClick={() => {
              setSettingsTab('ai');
              setSettingsOpen(true);
            }}
          >
            设置
          </button>
        </div>
      </header>

      {showLibrary ? (
        <LibraryView
          onOpen={handleOpenPaper}
          onContinueReading={openedPaper === null ? undefined : handleContinueReading}
          activePaperId={openedPaper === null ? null : openedPaper.id}
          onOpenSettings={() => {
            setSettingsTab('library');
            setSettingsOpen(true);
          }}
          onOpenEngineSettings={openEngineSettings}
        />
      ) : openedPaper === null ? null : (
        <div className="app-shell">
          <main className="reading-area reader-open" aria-label="阅读区">
            <div className="reader-layout">
              {!outlineHidden && (
                <OutlinePanel
                  outline={openedPaper.outline}
                  onJump={handleOutlineJump}
                  onClose={() => setOutlineHidden(true)}
                />
              )}
              <PdfViewer
                paper={openedPaper}
                focusMode={focusMode}
                onToggleFocusMode={toggleFocusMode}
                outlineOpen={!outlineHidden}
                onToggleOutline={() => setOutlineHidden((hidden) => !hidden)}
                aiPanelOpen={!aiHidden}
                onToggleAiPanel={toggleAiPanel}
                onAskAI={() => {
                  revealAiPanel();
                  setAiTab('chat');
                  useChatStore.getState().requestFocus();
                }}
                onJudgeDepth={handleJudgeDepth}
                onSaveNote={handleSaveNote}
                onCaptureAsk={handleCaptureAsk}
                onOpenSettings={() => {
                  setSettingsTab('ai');
                  setSettingsOpen(true);
                }}
                onOpenEngineSettings={openEngineSettings}
              />
            </div>
          </main>

          {/* Only a docked, expanded panel gets the separator. A floating
              panel resizes from its bottom-right corner instead. */}
          {!aiHidden && !aiCollapsed && aiLayout === 'docked' && (
            <div
              className="ai-resizer"
              role="separator"
              aria-orientation="vertical"
              aria-label="调整智慧阅读面板宽度"
              aria-valuenow={aiWidth}
              aria-valuemin={AI_PANEL_MIN_WIDTH}
              aria-valuemax={aiPanelMaxWidth(window.innerWidth)}
              tabIndex={0}
              onPointerDown={handleResizerPointerDown}
              onPointerMove={handleResizerPointerMove}
              onPointerUp={handleResizerPointerUp}
              onPointerCancel={handleResizerPointerCancel}
              onLostPointerCapture={handleResizerLostPointerCapture}
              onKeyDown={handleResizerKeyDown}
              onDoubleClick={resetAiWidth}
            />
          )}

          {!aiHidden && (
          <aside className={aiPanelClass} style={aiPanelStyle} aria-label="智慧阅读面板">
            <div className="panel-bar">
              {(!aiCollapsed || aiLayout === 'floating') && (
                <div
                  className={aiLayout === 'floating' ? 'ai-panel-drag' : 'ai-panel-title'}
                  title={aiLayout === 'floating' ? '拖动移动智慧阅读面板' : undefined}
                  onPointerDown={
                    aiLayout === 'floating' ? handleFloatDragPointerDown : undefined
                  }
                  onPointerMove={
                    aiLayout === 'floating' ? handleFloatDragPointerMove : undefined
                  }
                  onPointerUp={
                    aiLayout === 'floating' ? handleFloatDragPointerUp : undefined
                  }
                  onPointerCancel={
                    aiLayout === 'floating' ? cancelFloatDrag : undefined
                  }
                  onLostPointerCapture={
                    aiLayout === 'floating'
                      ? () => {
                          floatDragStartRef.current = null;
                          setResizing(false);
                        }
                      : undefined
                  }
                >
                  <span className="panel-heading">智慧阅读</span>
                  {aiLayout === 'floating' && !aiCollapsed && (
                    <span className="ai-panel-drag-hint">拖动</span>
                  )}
                </div>
              )}
              <div className="panel-bar-actions">
                {!aiCollapsed && (
                  <button
                    type="button"
                    className="rail-toggle"
                    aria-label={
                      aiLayout === 'floating'
                        ? '固定智慧阅读面板到右侧'
                        : '释放为可拖动的悬浮智慧阅读面板'
                    }
                    title={
                      aiLayout === 'floating'
                        ? '固定到右侧'
                        : '悬浮：拖动标题栏移动，拖右下角缩放'
                    }
                    onClick={toggleAiLayout}
                  >
                    {aiLayout === 'floating' ? '靠边' : '悬浮'}
                  </button>
                )}
                <button
                  type="button"
                  className="rail-toggle"
                  aria-label={aiCollapsed ? '展开智慧阅读' : '收起智慧阅读'}
                  title={aiCollapsed ? '展开智慧阅读' : '收起智慧阅读'}
                  onClick={() => setAiCollapsed((value) => !value)}
                >
                  {aiCollapsed ? '展开' : '收起'}
                </button>
                <button
                  type="button"
                  className="rail-toggle"
                  aria-label="关闭智慧阅读"
                  title="关闭智慧阅读；从工具栏「智慧阅读」重新打开"
                  onClick={() => setAiHidden(true)}
                >
                  关闭
                </button>
              </div>
            </div>
            {!aiCollapsed && (
              <>
                <div className="ai-tabs" role="tablist" aria-label="智慧阅读视图">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={aiTab === 'chat'}
                    className={aiTab === 'chat' ? 'ai-tab active' : 'ai-tab'}
                    onClick={() => setAiTab('chat')}
                  >
                    对话
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={aiTab === 'notes'}
                    className={aiTab === 'notes' ? 'ai-tab active' : 'ai-tab'}
                    onClick={() => setAiTab('notes')}
                  >
                    笔记
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={aiTab === 'sticky'}
                    className={aiTab === 'sticky' ? 'ai-tab active' : 'ai-tab'}
                    onClick={() => setAiTab('sticky')}
                  >
                    标注
                  </button>
                </div>

                {aiTab === 'chat' ? (
                  <ChatPanel
                    paper={openedPaper}
                    pendingImage={pendingImage}
                    onPendingImageConsumed={() => setPendingImage(null)}
                    onOpenNote={handleOpenNote}
                    onOpenSticky={handleOpenSticky}
                  />
                ) : aiTab === 'sticky' ? (
                  <StickyNotesPanel paper={openedPaper} />
                ) : (
                  <>
                    {conceptPrompt !== null && (
                      <form
                        className="concept-form"
                        onSubmit={(event) => {
                          event.preventDefault();
                          void submitConcept();
                        }}
                      >
                        <label className="concept-form-label">
                          概念名称（根据第 {conceptPrompt.selection.pageNo} 页的选文生成概念卡）
                          <input
                            autoFocus
                            className="concept-form-input"
                            aria-label="概念名称"
                            value={conceptPrompt.title}
                            disabled={generatingNote !== null}
                            onChange={(event) =>
                              setConceptPrompt({ ...conceptPrompt, title: event.target.value })
                            }
                          />
                        </label>
                        <div className="concept-form-actions">
                          <button
                            type="submit"
                            className="menu-button"
                            disabled={
                              generatingNote !== null || conceptPrompt.title.trim() === ''
                            }
                          >
                            {generatingNote === 'concept' ? '生成中…' : '生成概念卡'}
                          </button>
                          <button
                            type="button"
                            className="menu-button"
                            onClick={() => setConceptPrompt(null)}
                          >
                            取消
                          </button>
                        </div>
                      </form>
                    )}
                    <NotesPanel paper={openedPaper} />
                  </>
                )}
              </>
            )}
            {aiLayout === 'floating' && !aiCollapsed && (
              <button
                type="button"
                className="ai-float-resizer"
                aria-label="调整智慧阅读面板大小"
                title="拖动调整大小；方向键微调，Home 复位"
                onPointerDown={handleFloatResizePointerDown}
                onPointerMove={handleFloatResizePointerMove}
                onPointerUp={handleFloatResizePointerUp}
                onPointerCancel={cancelFloatResize}
                onLostPointerCapture={() => {
                  floatResizeStartRef.current = null;
                  setResizing(false);
                }}
                onKeyDown={handleFloatResizeKeyDown}
              />
            )}
          </aside>
          )}
        </div>
      )}

      <TranslationStatusCard onOpenPaper={handleOpenPaper} />

      {settingsOpen && (
        <SettingsDialog
          initialTab={settingsTab}
          onClose={() => setSettingsOpen(false)}
          onReplayOnboarding={replayOnboarding}
        />
      )}

      {onboardingState === 'open' && (
        <Onboarding
          onFinish={finishOnboarding}
          onOpenSettings={openOnboardingSettings}
        />
      )}
    </div>
  );
}
