import { useEffect, useState } from 'react';
import type { Paper } from '@shared/types';
import { ChatPanel } from './components/ChatPanel';
import { LibraryPanel } from './components/LibraryPanel';
import { NotesPanel } from './components/NotesPanel';
import { OutlinePanel } from './components/OutlinePanel';
import { PdfViewer } from './components/PdfViewer';
import { useChatStore } from './stores/chat';
import { useLibraryStore } from './stores/library';
import { useNotesStore } from './stores/notes';
import { useReaderStore } from './stores/reader';
import type { ReaderSelection } from './stores/reader';

type AiTab = 'chat' | 'notes';

interface ConceptPrompt {
  selection: ReaderSelection;
  title: string;
}

export default function App(): React.JSX.Element {
  const [openedPaper, setOpenedPaper] = useState<Paper | null>(null);
  const [libraryCollapsed, setLibraryCollapsed] = useState(false);
  const [aiCollapsed, setAiCollapsed] = useState(false);
  const [aiTab, setAiTab] = useState<AiTab>('chat');
  const [conceptPrompt, setConceptPrompt] = useState<ConceptPrompt | null>(null);
  const papers = useLibraryStore((state) => state.papers);
  const generatingNote = useNotesStore((state) => state.generating);

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

  const handleOutlineJump = (pageNo: number): void => {
    useReaderStore.getState().jumpToPage(pageNo);
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

      <aside className={aiCollapsed ? 'ai-panel collapsed' : 'ai-panel'} aria-label="AI 面板">
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
  );
}
