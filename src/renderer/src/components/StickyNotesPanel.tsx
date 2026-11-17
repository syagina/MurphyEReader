import { useState } from 'react';
import type { Paper, StickyNote } from '@shared/types';
import {
  PDF_VERSION_LABELS,
  STICKY_NOTE_SOURCE_LABELS,
} from '@shared/sticky-notes';
import {
  annotationTypeLabel,
  filterAnnotations,
  type AnnotationFilter,
} from '../lib/annotation-marks';
import { useReaderStore } from '../stores/reader';
import { useStickyNotesStore } from '../stores/sticky-notes';

export interface StickyNotesPanelProps {
  paper: Paper;
}

const FILTERS: ReadonlyArray<{ value: AnnotationFilter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'note', label: '便签' },
  { value: 'mark', label: '标记' },
  { value: 'drawing', label: '绘制' },
];

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** First meaningful Markdown line, used as the list item's content preview. */
function contentPreview(markdown: string): string {
  const line = markdown
    .split('\n')
    .map((value) => value.trim())
    .find((value) => value !== '' && !/^`{3,}/.test(value));
  return line ?? '';
}

function isDrawing(note: StickyNote): boolean {
  return note.kind === 'ink' || note.kind === 'shape';
}

/**
 * Current paper + PDF version annotation list. Every action here stays inside
 * that version: the panel never mixes anchors from another layout.
 */
export function StickyNotesPanel({
  paper,
}: StickyNotesPanelProps): React.JSX.Element {
  const notes = useStickyNotesStore((state) => state.notes);
  const storeVersion = useStickyNotesStore((state) => state.version);
  const loading = useStickyNotesStore((state) => state.loading);
  const exporting = useStickyNotesStore((state) => state.exporting);
  const error = useStickyNotesStore((state) => state.error);
  const notice = useStickyNotesStore((state) => state.notice);
  const exportPdf = useStickyNotesStore((state) => state.exportPdf);
  const openNote = useStickyNotesStore((state) => state.openNote);
  const remove = useStickyNotesStore((state) => state.remove);
  const clearError = useStickyNotesStore((state) => state.clearError);
  const dismissNotice = useStickyNotesStore((state) => state.dismissNotice);
  const readerVersion = useReaderStore((state) => state.version);
  const pageCount = useReaderStore((state) => state.pageCount);
  const jumpToPage = useReaderStore((state) => state.jumpToPage);
  const [filter, setFilter] = useState<AnnotationFilter>('all');

  const version = storeVersion ?? readerVersion;
  const filtered = filterAnnotations(notes, filter);
  const outOfRange = (note: StickyNote): boolean =>
    pageCount > 0 && note.pageNo > pageCount;

  const handleOpen = (note: StickyNote): void => {
    if (outOfRange(note)) {
      return;
    }
    jumpToPage(note.pageNo);
    // Drawings have no popup; a click only reveals their page.
    if (!isDrawing(note)) {
      openNote(note.id);
    }
  };

  const handleDeleteDrawing = (note: StickyNote): void => {
    if (window.confirm('删除这条绘制标注？')) {
      void remove(note.id);
    }
  };

  return (
    <div className="sticky-notes-panel">
      <div className="sticky-notes-toolbar">
        <div className="sticky-notes-heading">
          <span className="sticky-notes-version">{PDF_VERSION_LABELS[version]}</span>
          <span className="sticky-notes-count">{filtered.length} 条标注</span>
        </div>
        <button
          type="button"
          className="menu-button sticky-notes-export"
          disabled={notes.length === 0 || exporting}
          title="导出带标准 PDF 批注的副本，不改动文献库中的原文件"
          onClick={() => {
            void exportPdf(paper.id, version);
          }}
        >
          {exporting ? '导出中…' : '导出带标注 PDF'}
        </button>
      </div>

      <div className="sticky-notes-filters" role="group" aria-label="标注筛选">
        {FILTERS.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            className={
              filter === value
                ? 'sticky-notes-filter active'
                : 'sticky-notes-filter'
            }
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
          >
            {label}
          </button>
        ))}
      </div>

      {notice !== null && (
        <div className="sticky-notes-notice" role="status">
          <div className="sticky-notes-notice-text">
            <span>
              已导出 {notice.exported} 条标注
              {notice.skipped > 0 ? `，${notice.skipped} 条无法导出，已跳过` : ''}
            </span>
            <span className="sticky-notes-notice-path">{notice.filePath}</span>
          </div>
          <button
            type="button"
            className="chat-note-notice-close"
            aria-label="关闭导出提示"
            onClick={dismissNotice}
          >
            ×
          </button>
        </div>
      )}

      {error !== null && (
        <div className="sticky-notes-error" role="alert">
          <span>{error}</span>
          <button
            type="button"
            className="chat-note-notice-close"
            aria-label="关闭错误提示"
            onClick={clearError}
          >
            ×
          </button>
        </div>
      )}

      <div className="sticky-notes-body">
        {loading && notes.length === 0 ? (
          <p className="sticky-notes-empty">正在加载标注…</p>
        ) : filtered.length === 0 ? (
          <p className="sticky-notes-empty">
            当前筛选没有标注。选中文字后用顶部标注工具，或进入绘制模式。
          </p>
        ) : (
          <ul className="sticky-notes-list">
            {filtered.map((note) => {
              const out = outOfRange(note);
              const quote = note.quote.trim();
              const preview = contentPreview(note.contentMd);
              return (
                <li key={note.id}>
                  <button
                    type="button"
                    className="sticky-note-list-item"
                    aria-disabled={out}
                    onClick={() => handleOpen(note)}
                  >
                    <span className="sticky-note-list-meta">
                      <span className="sticky-note-list-type">
                        {annotationTypeLabel(note)}
                      </span>
                      <span>第 {note.pageNo} 页</span>
                      <span>{STICKY_NOTE_SOURCE_LABELS[note.source]}</span>
                      {out && (
                        <span className="sticky-note-list-warning">
                          页码超出当前文档
                        </span>
                      )}
                    </span>
                    <span className="sticky-note-list-quote">
                      {quote === '' ? '（无引用）' : truncate(quote, 80)}
                    </span>
                    <span className="sticky-note-list-content">
                      {preview === '' ? '（无内容）' : truncate(preview, 80)}
                    </span>
                  </button>
                  {isDrawing(note) && (
                    <button
                      type="button"
                      className="sticky-note-list-delete"
                      onClick={() => handleDeleteDrawing(note)}
                    >
                      删除
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
