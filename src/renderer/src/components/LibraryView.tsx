import { useEffect, useMemo, useState } from 'react';
import type { Paper } from '@shared/types';
import { formatPaperMeta, formatTimestamp, parseTags } from '../lib/format';
import {
  collectTags,
  filterAndSortPapers,
  isPaperMissing,
  isTranslatedBound,
  libraryStats,
  readingProgress,
} from '../lib/library-view';
import type { LibraryFilter, LibrarySort } from '../lib/library-view';
import { useLibraryStore } from '../stores/library';
import { useNotesStore } from '../stores/notes';

interface LibraryViewProps {
  onOpen(paper: Paper): void;
  onContinueReading?(): void;
  activePaperId: number | null;
}

type LayoutMode = 'grid' | 'list';

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

function openTargetIsInteractive(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest('button, input, form, textarea, select, .paper-menu') !== null
  );
}

/**
 * Full-page library: search, tag and status filters, sorting, card/list layout,
 * reading progress and all per-paper management actions. Double-clicking a
 * card (or pressing Enter on it) opens the paper in the reader.
 */
export function LibraryView({
  onOpen,
  onContinueReading,
  activePaperId,
}: LibraryViewProps): React.JSX.Element {
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

  const [queryText, setQueryText] = useState('');
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [filter, setFilter] = useState<LibraryFilter>('all');
  const [sort, setSort] = useState<LibrarySort>('added');
  const [layout, setLayout] = useState<LayoutMode>('grid');
  const [openMenuId, setOpenMenuId] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [draft, setDraft] = useState<EditDraft | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void load().catch((loadError: unknown) => {
      setError(errorMessage(loadError));
    });
  }, [load]);

  useEffect(() => {
    setOpenMenuId(null);
  }, [papers.length]);

  const tags = useMemo(() => collectTags(papers), [papers]);
  const stats = useMemo(() => libraryStats(papers, fileStatus), [papers, fileStatus]);
  const visiblePapers = useMemo(
    () => filterAndSortPapers(papers, fileStatus, { text: queryText, tag: activeTag, filter, sort }),
    [papers, fileStatus, queryText, activeTag, filter, sort],
  );
  const hasFilters = queryText.trim() !== '' || activeTag !== null || filter !== 'all';

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
    setSelectedId(null);
    onOpen(paper);
  };

  const handleDoubleClick = (event: React.MouseEvent<HTMLLIElement>, paper: Paper): void => {
    if (openTargetIsInteractive(event.target)) {
      return;
    }
    handleOpen(paper);
  };

  const handleGenerateSummary = (paper: Paper): void => {
    setOpenMenuId(null);
    // Any paper can be summarized; the notes panel owns generation errors.
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

  const resetFilters = (): void => {
    setQueryText('');
    setActiveTag(null);
    setFilter('all');
  };

  return (
    <section className="library-page" aria-labelledby="library-heading">
      <header className="library-page-header">
        <div>
          <p className="library-kicker">PaperLens</p>
          <h1 className="library-heading" id="library-heading">
            文献库
          </h1>
          <p className="library-subtitle">
            共 {stats.total} 篇 · 未读 {stats.unread} · 已绑定译本 {stats.translated}
            {stats.missing > 0 ? ` · 文件缺失 ${stats.missing}` : ''}
          </p>
        </div>
        <div className="library-page-actions">
          {onContinueReading !== undefined && (
            <button type="button" className="secondary-button" onClick={onContinueReading}>
              继续阅读
            </button>
          )}
          <button
            type="button"
            className="primary-button library-import-button"
            onClick={handleImport}
            disabled={loading}
            aria-label="导入 PDF"
          >
            {loading && papers.length === 0 ? '正在加载…' : '＋ 导入 PDF'}
          </button>
        </div>
      </header>

      {error !== null && (
        <div className="library-error library-page-error" role="alert">
          <span>{error}</span>
          <button type="button" className="menu-button" onClick={() => setError(null)}>
            关闭
          </button>
        </div>
      )}

      <div className="library-controls">
        <input
          type="search"
          className="library-search"
          placeholder="搜索标题、作者或标签"
          aria-label="搜索文献"
          value={queryText}
          onChange={(event) => setQueryText(event.target.value)}
        />
        <label className="library-filter-label">
          状态
          <select
            className="library-select"
            value={filter}
            onChange={(event) => setFilter(event.target.value as LibraryFilter)}
          >
            <option value="all">全部</option>
            <option value="unread">未读</option>
            <option value="translated">已有译本</option>
            <option value="missing">文件缺失</option>
          </select>
        </label>
        <label className="library-filter-label">
          排序
          <select
            className="library-select"
            value={sort}
            onChange={(event) => setSort(event.target.value as LibrarySort)}
          >
            <option value="lastRead">最近阅读</option>
            <option value="added">最近添加</option>
            <option value="title">标题</option>
            <option value="year">年份</option>
          </select>
        </label>
        <div className="library-layout-toggle" role="group" aria-label="文献库布局">
          <button
            type="button"
            className={layout === 'grid' ? 'active' : ''}
            aria-pressed={layout === 'grid'}
            onClick={() => setLayout('grid')}
          >
            卡片
          </button>
          <button
            type="button"
            className={layout === 'list' ? 'active' : ''}
            aria-pressed={layout === 'list'}
            onClick={() => setLayout('list')}
          >
            列表
          </button>
        </div>
      </div>

      <div className="library-body">
        <aside className="library-facets" aria-label="标签筛选">
          <h2 className="library-facet-heading">标签</h2>
          <button
            type="button"
            className={activeTag === null ? 'library-tag-filter active' : 'library-tag-filter'}
            onClick={() => setActiveTag(null)}
          >
            <span>全部文献</span>
            <span className="library-tag-count">{papers.length}</span>
          </button>
          {tags.map(({ tag, count }) => (
            <button
              type="button"
              key={tag}
              className={activeTag === tag ? 'library-tag-filter active' : 'library-tag-filter'}
              onClick={() => setActiveTag(activeTag === tag ? null : tag)}
            >
              <span>{tag}</span>
              <span className="library-tag-count">{count}</span>
            </button>
          ))}
          {tags.length === 0 && <p className="library-facet-empty">导入文献并编辑信息后，可在这里按标签筛选。</p>}
        </aside>

        <div className="library-results">
          <div className="library-results-bar">
            <span>
              {visiblePapers.length} 篇文献
              {hasFilters ? '（已筛选）' : ''}
            </span>
            <span className="library-gesture-hint">双击卡片打开</span>
          </div>

          {papers.length === 0 ? (
            <div className="library-empty">
              <p className="library-empty-title">
                {loading ? '正在读取文献库…' : '文献库还是空的'}
              </p>
              {loading ? (
                <p className="library-empty-text">正在检查文件状态。</p>
              ) : (
                <>
                  <p className="library-empty-text">
                    导入第一篇 PDF 后，就可以在阅读时随时向 AI 提问、保存笔记和查看阅读进度。
                  </p>
                  <button
                    type="button"
                    className="primary-button library-empty-import"
                    onClick={handleImport}
                  >
                    导入 PDF
                  </button>
                </>
              )}
            </div>
          ) : visiblePapers.length === 0 ? (
            <div className="library-empty">
              <p className="library-empty-title">没有符合条件的文献</p>
              <p className="library-empty-text">换个关键词，或清除当前筛选。</p>
              <button type="button" className="secondary-button" onClick={resetFilters}>
                清除筛选
              </button>
            </div>
          ) : (
            <ul className={`library-cards layout-${layout}`}>
              {visiblePapers.map((paper) => {
                const status = fileStatus[paper.id];
                const translated = isTranslatedBound(paper);
                const missing = isPaperMissing(paper, status);
                const progress = readingProgress(paper);
                const isActive = activePaperId === paper.id;
                return (
                  <li
                    key={paper.id}
                    className={[
                      'library-card',
                      layout === 'list' ? 'library-card-list' : '',
                      selectedId === paper.id ? 'selected' : '',
                      isActive ? 'active-paper' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    tabIndex={0}
                    aria-label={`${paper.title}，双击打开`}
                    onDoubleClick={(event) => handleDoubleClick(event, paper)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && event.target === event.currentTarget) {
                        event.preventDefault();
                        handleOpen(paper);
                      }
                    }}
                    onClick={(event) => {
                      if (!openTargetIsInteractive(event.target)) {
                        setSelectedId(paper.id);
                      }
                    }}
                  >
                    <div className="library-card-head">
                      <div className="library-card-badges">
                        {isActive && <span className="library-badge active">正在阅读</span>}
                        {missing && <span className="library-badge warning">文件缺失</span>}
                        {translated && <span className="library-badge accent">中英对照</span>}
                        {paper.lastReadAt === null && (
                          <span className="library-badge">未读</span>
                        )}
                      </div>
                      <button
                        type="button"
                        className="card-menu-toggle"
                        aria-label={`操作菜单：${paper.title}`}
                        aria-expanded={openMenuId === paper.id}
                        onClick={(event) => {
                          event.stopPropagation();
                          setOpenMenuId(openMenuId === paper.id ? null : paper.id);
                        }}
                      >
                        ⋯
                      </button>
                    </div>

                    <h3 className="library-card-title" title={paper.title}>
                      {paper.title}
                    </h3>
                    <p className="library-card-meta">{formatPaperMeta(paper)}</p>

                    {paper.tags.length > 0 && (
                      <div className="tag-row library-card-tags">
                        {paper.tags.map((tag) => (
                          <button
                            type="button"
                            className="tag-chip tag-chip-button"
                            key={tag}
                            onClick={(event) => {
                              event.stopPropagation();
                              setActiveTag(tag);
                            }}
                          >
                            {tag}
                          </button>
                        ))}
                      </div>
                    )}

                    <div className="library-progress-row">
                      <div
                        className="library-progress"
                        role="progressbar"
                        aria-valuenow={progress}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-label="阅读进度"
                      >
                        <span style={{ width: `${progress}%` }} />
                      </div>
                      <span className="library-progress-text">{progress}%</span>
                    </div>

                    <div className="library-card-footer">
                      <span>{paper.pageCountOriginal} 页</span>
                      <span>
                        {paper.lastReadAt === null
                          ? '尚未阅读'
                          : `最近阅读 ${formatTimestamp(paper.lastReadAt)}`}
                      </span>
                    </div>

                    {openMenuId === paper.id && (
                      <div className="paper-menu library-card-menu">
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
                        {translated && (
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
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {draft !== null && (
        <div
          className="library-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setDraft(null);
            }
          }}
        >
          <form
            className="library-edit-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="library-edit-title"
            onSubmit={(event) => {
              event.preventDefault();
              saveEdit();
            }}
          >
            <h2 className="library-edit-title" id="library-edit-title">
              编辑文献信息
            </h2>
            <label className="library-edit-field">
              标题
              <input
                autoFocus
                value={draft.title}
                onChange={(event) => setDraft({ ...draft, title: event.target.value })}
              />
            </label>
            <label className="library-edit-field">
              作者
              <input
                value={draft.authors}
                onChange={(event) => setDraft({ ...draft, authors: event.target.value })}
              />
            </label>
            <label className="library-edit-field">
              年份
              <input
                value={draft.year}
                inputMode="numeric"
                onChange={(event) => setDraft({ ...draft, year: event.target.value })}
              />
            </label>
            <label className="library-edit-field">
              标签（用逗号分隔）
              <input
                value={draft.tags}
                onChange={(event) => setDraft({ ...draft, tags: event.target.value })}
              />
            </label>
            <div className="library-edit-actions">
              <button type="button" className="secondary-button" onClick={() => setDraft(null)}>
                取消
              </button>
              <button type="submit" className="primary-button">
                保存
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}
