import { useState } from 'react';
import type { Paper } from '@shared/types';
import { LibraryPanel } from './components/LibraryPanel';
import { OutlinePanel } from './components/OutlinePanel';
import { PdfViewer } from './components/PdfViewer';
import { useReaderStore } from './stores/reader';

export default function App(): React.JSX.Element {
  const [openedPaper, setOpenedPaper] = useState<Paper | null>(null);
  const [libraryCollapsed, setLibraryCollapsed] = useState(false);
  const [aiCollapsed, setAiCollapsed] = useState(false);

  const handleOutlineJump = (pageNo: number): void => {
    useReaderStore.getState().jumpToPage(pageNo);
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
            <PdfViewer paper={openedPaper} />
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
        {!aiCollapsed && <p className="ai-placeholder">AI 对话面板将在后续任务中接入。</p>}
      </aside>
    </div>
  );
}
