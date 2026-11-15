import { useEffect, useRef, useState } from 'react';
import type { Paper, SearchResult } from '@shared/types';
import { ChatPanel } from './components/ChatPanel';
import { LibraryView } from './components/LibraryView';
import { NotesPanel } from './components/NotesPanel';
import { OutlinePanel } from './components/OutlinePanel';
import { PdfViewer } from './components/PdfViewer';
import { SearchPanel } from './components/SearchPanel';
import { SettingsDialog } from './components/SettingsDialog';
import { errorMessage } from './lib/errors';
import { useChatStore } from './stores/chat';
import { useLibraryStore } from './stores/library';
import { useNotesStore } from './stores/notes';
import { useReaderStore } from './stores/reader';
import type { ReaderSelection } from './stores/reader';
import { useSearchStore } from './stores/search';
import { useSettingsStore } from './stores/settings';

type AiTab = 'chat' | 'notes';

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
  // Focus mode hides the top bar, library chrome and outline, and asks the
  // main process for a real full-screen window.
  const [focusMode, setFocusMode] = useState(false);
  const [aiTab, setAiTab] = useState<AiTab>('chat');
  const [conceptPrompt, setConceptPrompt] = useState<ConceptPrompt | null>(null);
  const [pendingLocate, setPendingLocate] = useState<PendingLocate | null>(null);
  // Region-screenshot attachment waiting in the chat composer.
  const [pendingImage, setPendingImage] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Click-time navigation failures stay visible in the top bar until dismissed,
  // unlike the dropdown error which disappears with the query.
  const [clickError, setClickError] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  // Monotonic sequence for result clicks; every continuation after an await
  // verifies it so a slower older click can never win over a newer one.
  const locateSeqRef = useRef(0);
  const papers = useLibraryStore((state) => state.papers);
  const generatingNote = useNotesStore((state) => state.generating);
  const searchQuery = useSearchStore((state) => state.query);
  const setSearchQuery = useSearchStore((state) => state.setQuery);
  const clearSearch = useSearchStore((state) => state.clear);

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

  // Load AI settings once so vision availability is known before the settings
  // dialog is ever opened. The store records its own load errors.
  useEffect(() => {
    void useSettingsStore.getState().load();
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
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

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
    // Collapse the AI panel to its rail so the page gets the full width; the
    // rail stays available when the reader wants to ask a question.
    setAiCollapsed(true);
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
        setAiCollapsed(false);
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
    setAiCollapsed(false);
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
    setAiCollapsed(false);
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

  // 选框提问: keep the cropped image in the composer, then focus the chat tab.
  const handleCaptureAsk = (imageDataUrl: string): void => {
    setPendingImage(imageDataUrl);
    setAiCollapsed(false);
    setAiTab('chat');
    useChatStore.getState().requestFocus();
  };

  const showLibrary = libraryView || openedPaper === null;

  return (
    <div className={focusMode && !showLibrary ? 'app-frame reader-focus' : 'app-frame'}>
      <header className="app-topbar">
        <button
          type="button"
          className="app-brand"
          title="返回文献库"
          onClick={handleShowLibrary}
        >
          PaperLens
        </button>
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
        <button
          type="button"
          className="topbar-settings"
          onClick={() => setSettingsOpen(true)}
        >
          设置
        </button>
      </header>

      {showLibrary ? (
        <LibraryView
          onOpen={handleOpenPaper}
          onContinueReading={openedPaper === null ? undefined : handleContinueReading}
          activePaperId={openedPaper === null ? null : openedPaper.id}
        />
      ) : openedPaper === null ? null : (
        <div className="app-shell">
          <main className="reading-area reader-open" aria-label="阅读区">
            <div className="reader-layout">
              {outlineHidden ? (
                <button
                  type="button"
                  className="outline-rail"
                  aria-label="显示大纲"
                  title="显示大纲"
                  onClick={() => setOutlineHidden(false)}
                >
                  大纲
                </button>
              ) : (
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
                onAskAI={() => {
                  setAiCollapsed(false);
                  setAiTab('chat');
                  useChatStore.getState().requestFocus();
                }}
                onJudgeDepth={handleJudgeDepth}
                onSaveNote={handleSaveNote}
                onCaptureAsk={handleCaptureAsk}
              />
            </div>
          </main>

          <aside
            className={aiCollapsed ? 'ai-panel collapsed' : 'ai-panel'}
            aria-label="AI 面板"
          >
            <div className="panel-bar">
              {!aiCollapsed && <span className="panel-heading">AI 助手</span>}
              <button
                type="button"
                className="rail-toggle"
                aria-label={aiCollapsed ? '展开 AI 面板' : '收起 AI 面板'}
                title={aiCollapsed ? '展开 AI 面板' : '收起 AI 面板'}
                onClick={() => setAiCollapsed((value) => !value)}
              >
                {aiCollapsed ? '«' : '»'}
              </button>
            </div>
            {!aiCollapsed && (
              <>
                <div className="ai-tabs" role="tablist" aria-label="AI 面板视图">
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
                </div>

                {aiTab === 'chat' ? (
                  <ChatPanel
                    paper={openedPaper}
                    pendingImage={pendingImage}
                    onPendingImageConsumed={() => setPendingImage(null)}
                  />
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
          </aside>
        </div>
      )}

      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
