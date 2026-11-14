import { useEffect, useState } from 'react';
import type { Paper } from '@shared/types';
import { formatPaperMeta } from '../lib/format';
import { useLibraryStore } from '../stores/library';
import { useNotesStore } from '../stores/notes';

interface LibraryPanelProps {
  onOpen(paper: Paper): void;
}

interface EditDraft {
  id: number;
  title: string;
  authors: string;
  year: string;
  tags: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '操作失败';
}

function parseTags(input: string): string[] {
  return input
    .split(/[,，]/)
    .map((tag) => tag.trim())
    .filter((tag) => tag !== '');
}

export function LibraryPanel({ onOpen }: LibraryPanelProps): React.JSX.Element {
  const papers = useLibraryStore((state) => state.papers);
  const loading = useLibraryStore((state) => state.loading);
  const fileStatus = useLibraryStore((state) => state.fileStatus);
  const load = useLibraryStore((state) => state.load);
  const importPaper = useLibraryStore((state) => state.importPaper);
  const attachTranslated = useLibraryStore((state) => state.attachTranslated);
  const relocate = useLibraryStore((state) => state.relocate);
  const removePaper = useLibraryStore((state) => state.removePaper);
  const updateMeta = useLibraryStore((state) => state.updateMeta);
  const generateNote = useNotesStore((state) => state.generate);
  const notesGenerating = useNotesStore((state) => state.generating);

  const [openMenuId, setOpenMenuId] = useState<number | null>(null);
  const [draft, setDraft] = useState<EditDraft | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void load().catch((loadError: unknown) => {
      setError(errorMessage(loadError));
    });
  }, [load]);

  const runAction = async (action: () => Promise<void>): Promise<void> => {
    setError(null);
    try {
      await action();
    } catch (actionError) {
      setError(errorMessage(actionError));
    }
  };

  const handleImport = (): void => {
    void runAction(importPaper);
  };

  const handleOpen = (paper: Paper): void => {
    setOpenMenuId(null);
    onOpen(paper);
  };

  const handleGenerateSummary = (paper: Paper): void => {
    setOpenMenuId(null);
    // Generation is not tied to the open reader: any paper can be summarized.
    // The notes store keeps the error for the notes panel to show.
    void generateNote('summary', { paperId: paper.id });
  };

  const handleAttach = (paper: Paper): void => {
    setOpenMenuId(null);
    void runAction(() => attachTranslated(paper.id));
  };

  const handleRelocate = (paper: Paper, version: 'original' | 'translated'): void => {
    setOpenMenuId(null);
    void runAction(() => relocate(paper.id, version));
  };

  const handleDelete = (paper: Paper): void => {
    setOpenMenuId(null);
    if (!window.confirm(`确定删除文献「${paper.title}」？此操作不可恢复。`)) {
      return;
    }
    void runAction(() => removePaper(paper.id));
  };

  const startEdit = (paper: Paper): void => {
    setOpenMenuId(null);
    setError(null);
    setDraft({
      id: paper.id,
      title: paper.title,
      authors: paper.authors,
      year: paper.year === null ? '' : String(paper.year),
      tags: paper.tags.join(', '),
    });
  };

  const saveEdit = (): void => {
    if (draft === null) {
      return;
    }
    const title = draft.title.trim();
    if (title === '') {
      setError('标题不能为空');
      return;
    }
    const yearText = draft.year.trim();
    let year: number | null = null;
    if (yearText !== '') {
      const parsed = Number(yearText);
      if (!Number.isInteger(parsed) || parsed < 0) {
        setError('年份必须是整数');
        return;
      }
      year = parsed;
    }
    void runAction(async () => {
      await updateMeta(draft.id, {
        title,
        authors: draft.authors.trim(),
        year,
        tags: parseTags(draft.tags),
      });
      setDraft(null);
    });
  };

  return (
    <div className="library-panel">
      <div className="library-toolbar">
        <button
          type="button"
          className="primary-button"
          onClick={handleImport}
          disabled={loading}
          aria-label="导入 PDF"
        >
          导入 PDF
        </button>
      </div>

      {error !== null && (
        <div className="library-error" role="alert">
          {error}
        </div>
      )}

      {loading && papers.length === 0 ? (
        <p className="empty-state">正在加载文献库…</p>
      ) : papers.length === 0 ? (
        <p className="empty-state">文献库为空。点击「导入 PDF」添加第一篇文献。</p>
      ) : (
        <ul className="library-list">
          {papers.map((paper) => {
            const status = fileStatus[paper.id];
            const translatedBound =
              paper.filePathTranslated !== null && paper.filePathTranslated !== '';
            const missing =
              status !== undefined &&
              (!status.originalExists || (translatedBound && !status.translatedExists));
            return (
              <li className="paper-card" key={paper.id}>
                {draft !== null && draft.id === paper.id ? (
                  <form
                    className="edit-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      saveEdit();
                    }}
                  >
                    <label>
                      标题
                      <input
                        value={draft.title}
                        onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                      />
                    </label>
                    <label>
                      作者
                      <input
                        value={draft.authors}
                        onChange={(event) => setDraft({ ...draft, authors: event.target.value })}
                      />
                    </label>
                    <label>
                      年份
                      <input
                        value={draft.year}
                        inputMode="numeric"
                        onChange={(event) => setDraft({ ...draft, year: event.target.value })}
                      />
                    </label>
                    <label>
                      标签（用逗号分隔）
                      <input
                        value={draft.tags}
                        onChange={(event) => setDraft({ ...draft, tags: event.target.value })}
                      />
                    </label>
                    <div className="edit-actions">
                      <button type="submit" className="menu-button">
                        保存
                      </button>
                      <button
                        type="button"
                        className="menu-button"
                        onClick={() => setDraft(null)}
                      >
                        取消
                      </button>
                    </div>
                  </form>
                ) : (
                  <>
                    <div className="paper-head">
                      <h3 className="paper-title">{paper.title}</h3>
                      <button
                        type="button"
                        className="menu-toggle"
                        aria-label={`操作菜单：${paper.title}`}
                        aria-expanded={openMenuId === paper.id}
                        onClick={() =>
                          setOpenMenuId(openMenuId === paper.id ? null : paper.id)
                        }
                      >
                        操作
                      </button>
                    </div>
                    <p className="paper-meta">{formatPaperMeta(paper)}</p>
                    {paper.tags.length > 0 && (
                      <div className="tag-row">
                        {paper.tags.map((tag) => (
                          <span className="tag-chip" key={tag}>
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                    {missing && <span className="missing-badge">⚠ 文件缺失</span>}
                    {openMenuId === paper.id && (
                      <div className="paper-menu">
                        <button
                          type="button"
                          className="menu-button"
                          onClick={() => handleOpen(paper)}
                        >
                          打开
                        </button>
                        <button
                          type="button"
                          className="menu-button"
                          disabled={notesGenerating !== null}
                          onClick={() => handleGenerateSummary(paper)}
                        >
                          {notesGenerating === 'summary' ? '生成中…' : '生成结构化总结'}
                        </button>
                        <button
                          type="button"
                          className="menu-button"
                          onClick={() => handleAttach(paper)}
                        >
                          绑定译本
                        </button>
                        <button
                          type="button"
                          className="menu-button"
                          onClick={() => handleRelocate(paper, 'original')}
                        >
                          重新定位原文
                        </button>
                        {translatedBound && (
                          <button
                            type="button"
                            className="menu-button"
                            onClick={() => handleRelocate(paper, 'translated')}
                          >
                            重新定位译本
                          </button>
                        )}
                        <button
                          type="button"
                          className="menu-button"
                          onClick={() => startEdit(paper)}
                        >
                          编辑信息
                        </button>
                        <button
                          type="button"
                          className="menu-button danger"
                          onClick={() => handleDelete(paper)}
                        >
                          删除
                        </button>
                      </div>
                    )}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
