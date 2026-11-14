import { useState } from 'react';
import type { Paper } from '@shared/types';
import { LibraryPanel } from './components/LibraryPanel';

export default function App(): React.JSX.Element {
  const [openedPaper, setOpenedPaper] = useState<Paper | null>(null);
  const [libraryCollapsed, setLibraryCollapsed] = useState(false);
  const [aiCollapsed, setAiCollapsed] = useState(false);

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

      <main className="reading-area" aria-label="阅读区">
        <h1 className="reading-title">{openedPaper === null ? 'PaperLens' : openedPaper.title}</h1>
        <p className="placeholder-text">
          {openedPaper === null
            ? '从左侧文献库打开一篇 PDF 开始阅读。'
            : '阅读器将在后续版本中在此显示 PDF 内容。'}
        </p>
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
