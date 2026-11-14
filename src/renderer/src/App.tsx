import { useEffect, useRef, useState } from 'react';
import type { Paper, SearchResult } from '@shared/types';
import { ChatPanel } from './components/ChatPanel';
import { LibraryPanel } from './components/LibraryPanel';
import { NotesPanel } from './components/NotesPanel';
import { OutlinePanel } from './components/OutlinePanel';
import { PdfViewer } from './components/PdfViewer';
import { SearchPanel } from './components/SearchPanel';
import { errorMessage } from './lib/errors';
import { useChatStore } from './stores/chat';
import { useLibraryStore } from './stores/library';
import { useNotesStore } from './stores/notes';
import { useReaderStore } from './stores/reader';
import type { ReaderSelection } from './stores/reader';
import { useSearchStore } from './stores/search';

type AiTab = 'chat' | 'notes';

interface ConceptPrompt {
  selection: ReaderSelection;
  title: string;
}

/** A chat message or note hit that still has to be revealed after the paper opens. */
type PendingLocate =
  | { kind: 'message'; paperId: number; conversationId: number }
  | { kind: 'note'; paperId: number; noteId: number };

export default function App(): React.JSX.Element {
  const [openedPaper, setOpenedPaper] = useState<Paper | null>(null);
  const [libraryCollapsed, setLibraryCollapsed] = useState(false);
  const [aiCollapsed, setAiCollapsed] = useState(false);
  const [aiTab, setAiTab] = useState<AiTab>('chat');
  const [conceptPrompt, setConceptPrompt] = useState<ConceptPrompt | null>(null);
  const [pendingLocate, setPendingLocate] = useState<PendingLocate | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
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
    if (current !== undefined && current !== openedPaper) {
      setOpenedPaper(current);
    }
  }, [papers, openedPaper]);

  const openedPaperId = openedPaper === null ? null : openedPaper.id;

  // A pending concept card belongs to the paper it was started from.
  useEffect(() => {
    setConceptPrompt(null);
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
        useNotesStore.getState().selectNote(locate.noteId);
      });
  }, [pendingLocate, openedPaper]);

  const handleOutlineJump = (pageNo: number): void => {
    useReaderStore.getState().jumpToPage(pageNo);
  };

  const handleSearchSelect = async (result: SearchResult): Promise<void> => {
    const search = useSearchStore.getState();
    search.setError(null);

    let locate: PendingLocate | null = null;
    if (result.kind === 'message') {
      if (result.conversationId === undefined) {
        search.setError('搜索结果缺少会话信息');
        return;
      }
      locate = {
        kind: 'message',
        paperId: result.paperId,
        conversationId: result.conversationId,
      };
    } else if (result.kind === 'note') {
      if (result.noteId === undefined) {
        search.setError('搜索结果缺少笔记信息');
        return;
      }
      locate = { kind: 'note', paperId: result.paperId, noteId: result.noteId };
    }

    try {
      const paper = await window.api.papers.get(result.paperId);
      if (paper === null) {
        search.setError(`文献不存在: ${result.paperId}`);
        return;
      }
      await useReaderStore.getState().open(paper.id, result.pageNo);
      setOpenedPaper(paper);
      if (locate !== null) {
        setAiCollapsed(false);
        setAiTab(locate.kind === 'message' ? 'chat' : 'notes');
        setPendingLocate(locate);
      }
      search.clear();
    } catch (error) {
      search.setError(errorMessage(error));
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

  return (
    <div className="app-frame">
      <header className="app-topbar">
        <span className="app-brand">PaperLens</span>
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
      </header>

      <div className="app-shell">
        <aside
          className={libraryCollapsed ? 'sidebar collapsed' : 'sidebar'}
          aria-label="文献库栏"
        >
          <div className="panel-bar">
            {!libraryCollapsed && <span className="panel-heading">文献库</span>}
            <button
              type="button"
              className="rail-toggle"
              aria-label={libraryCollapsed ? '展开文献栏' : '收起文献栏'}
              title={libraryCollapsed ? '展开文献栏' : '收起文献栏'}
              onClick={() => setLibraryCollapsed((value) => !value)}
            >
              {libraryCollapsed ? '»' : '«'}
            </button>
          </div>
          {!libraryCollapsed && <LibraryPanel onOpen={setOpenedPaper} />}
        </aside>

        <main
          className={openedPaper === null ? 'reading-area' : 'reading-area reader-open'}
          aria-label="阅读区"
        >
          {openedPaper === null ? (
            <>
              <h1 className="reading-title">PaperLens</h1>
              <p className="placeholder-text">从左侧文献库打开一篇 PDF 开始阅读。</p>
            </>
          ) : (
            <div className="reader-layout">
              <OutlinePanel outline={openedPaper.outline} onJump={handleOutlineJump} />
              <PdfViewer
                paper={openedPaper}
                onAskAI={() => {
                  setAiCollapsed(false);
                  setAiTab('chat');
                  useChatStore.getState().requestFocus();
                }}
                onJudgeDepth={handleJudgeDepth}
                onSaveNote={handleSaveNote}
              />
            </div>
          )}
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
          {!aiCollapsed &&
            (openedPaper === null ? (
              <p className="ai-placeholder">打开一篇文献后，即可就内容向 AI 提问。</p>
            ) : (
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
                  <ChatPanel paper={openedPaper} />
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
            ))}
        </aside>
      </div>
    </div>
  );
}
