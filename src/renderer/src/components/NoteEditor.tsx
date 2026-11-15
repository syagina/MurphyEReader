import { useEffect, useState } from 'react';
import type { ExportFormat, Note, Paper } from '@shared/types';
import { errorMessage } from '../lib/errors';
import { EXPORT_FORMAT_LABELS, exportNoteDocument } from '../lib/export-note';
import {
  buildNoteExportFileName,
  buildNoteMarkdown,
} from '../lib/export-markdown';
import { formatTimestamp, parseTags } from '../lib/format';
import { isNoteDraftDirty, noteDraftFromNote } from '../lib/note-draft';
import type { NoteDraft } from '../lib/note-draft';
import { useNotesStore } from '../stores/notes';
import { MarkdownView } from './MarkdownView';

interface NoteEditorProps {
  paper: Paper;
  note: Note;
  onClose(): void;
}

type EditorMode = 'edit' | 'preview';

export function NoteEditor({ paper, note, onClose }: NoteEditorProps): React.JSX.Element {
  const update = useNotesStore((state) => state.update);
  const remove = useNotesStore((state) => state.remove);

  const [storedNote, setStoredNote] = useState<Note>(note);
  const [draft, setDraft] = useState<NoteDraft>(() => noteDraftFromNote(note));
  const [mode, setMode] = useState<EditorMode>('preview');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportFormat, setExportFormat] = useState<ExportFormat>('pdf');
  const [localError, setLocalError] = useState<string | null>(null);

  // Switching notes or saving (updatedAt changes) resets the stored snapshot,
  // the draft, and the mode; ordinary typing does not touch `note`.
  useEffect(() => {
    setStoredNote(note);
    setDraft(noteDraftFromNote(note));
    setMode('preview');
    setLocalError(null);
  }, [note.id, note.updatedAt]);

  const busy = saving || deleting || exporting;
  const dirty = isNoteDraftDirty(storedNote, draft);
  const previewTags = parseTags(draft.tags);

  const handleExport = async (): Promise<void> => {
    // Preview exports the saved note exactly; edit mode exports the current
    // draft with the title fallback and tag parsing the old editor used.
    const exportTarget: Note =
      mode === 'preview'
        ? note
        : {
            ...note,
            title: draft.title.trim() === '' ? note.title : draft.title.trim(),
            tags: parseTags(draft.tags),
            contentMd: draft.contentMd,
          };
    setExporting(true);
    setLocalError(null);
    try {
      await exportNoteDocument(
        buildNoteExportFileName(paper, exportTarget, exportFormat),
        exportTarget.title,
        buildNoteMarkdown(paper, exportTarget),
        exportFormat,
        { paperId: paper.id, scope: 'note' },
      );
    } catch (exportError) {
      setLocalError(errorMessage(exportError));
    } finally {
      setExporting(false);
    }
  };

  const handleSave = async (): Promise<void> => {
    const trimmedTitle = draft.title.trim();
    if (trimmedTitle === '') {
      setLocalError('标题不能为空');
      return;
    }
    setSaving(true);
    setLocalError(null);
    await update(note.id, {
      title: trimmedTitle,
      tags: parseTags(draft.tags),
      contentMd: draft.contentMd,
    });
    setSaving(false);
    if (useNotesStore.getState().error === null) {
      setMode('preview');
    }
  };

  const handleCancel = (): void => {
    setDraft(noteDraftFromNote(storedNote));
    setMode('preview');
    setLocalError(null);
  };

  const handleClose = (): void => {
    if (mode === 'edit' && dirty && !window.confirm('有未保存的修改，确定关闭？')) {
      return;
    }
    onClose();
  };

  const handleDelete = async (): Promise<void> => {
    if (!window.confirm(`确定删除笔记「${note.title}」？此操作不可恢复。`)) {
      return;
    }
    setDeleting(true);
    await remove(note.id);
    setDeleting(false);
    if (useNotesStore.getState().error === null) {
      onClose();
    }
  };

  return (
    <div className="note-editor">
      <div className="note-editor-header">
        <span className="note-editor-kicker">编辑笔记</span>
        <div className="note-editor-tabs" role="tablist" aria-label="笔记编辑模式">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'edit'}
            className={mode === 'edit' ? 'note-tab active' : 'note-tab'}
            onClick={() => setMode('edit')}
          >
            编辑
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'preview'}
            className={mode === 'preview' ? 'note-tab active' : 'note-tab'}
            onClick={() => setMode('preview')}
          >
            预览
          </button>
        </div>
      </div>

      {localError !== null && (
        <div className="notes-error" role="alert">
          <span>{localError}</span>
          <button type="button" className="menu-button" onClick={() => setLocalError(null)}>
            关闭
          </button>
        </div>
      )}

      <div className="note-editor-body">
        {mode === 'edit' ? (
          <>
            <label className="note-editor-field">
              标题
              <input
                className="note-editor-input"
                value={draft.title}
                disabled={busy}
                onChange={(event) => setDraft({ ...draft, title: event.target.value })}
              />
            </label>
            <label className="note-editor-field">
              标签（用逗号分隔）
              <input
                className="note-editor-input"
                value={draft.tags}
                disabled={busy}
                onChange={(event) => setDraft({ ...draft, tags: event.target.value })}
              />
            </label>
            <label className="note-editor-field note-editor-content">
              内容（Markdown）
              <textarea
                className="note-editor-textarea"
                value={draft.contentMd}
                rows={14}
                disabled={busy}
                onChange={(event) => setDraft({ ...draft, contentMd: event.target.value })}
              />
            </label>
          </>
        ) : (
          <div className="note-editor-preview">
            <h3 className="note-preview-title">{draft.title}</h3>
            {previewTags.length > 0 && (
              <div className="tag-row note-preview-tags">
                {previewTags.map((tag) => (
                  <span className="tag-chip" key={tag}>
                    {tag}
                  </span>
                ))}
              </div>
            )}
            <p className="note-preview-source">
              {`来源：文献《${paper.title}》 · 创建于 ${formatTimestamp(
                note.createdAt,
              )} · 更新于 ${formatTimestamp(note.updatedAt)}`}
            </p>
            {draft.contentMd.trim() === '' ? (
              <p className="empty-state note-preview-empty">（空白笔记，点编辑开始写）</p>
            ) : (
              <MarkdownView text={draft.contentMd} className="note-preview" />
            )}
          </div>
        )}
      </div>

      <div className="note-editor-actions">
        <div className="note-editor-left-actions">
          <button
            type="button"
            className="menu-button danger"
            disabled={busy}
            onClick={() => {
              void handleDelete();
            }}
          >
            删除
          </button>
          <select
            className="note-export-format"
            aria-label="导出格式"
            value={exportFormat}
            disabled={busy}
            onChange={(event) => setExportFormat(event.target.value as ExportFormat)}
          >
            <option value="pdf">PDF</option>
            <option value="docx">Word</option>
            <option value="md">Markdown</option>
          </select>
          <button
            type="button"
            className="menu-button"
            disabled={busy}
            onClick={() => {
              void handleExport();
            }}
          >
            {exporting ? '导出中…' : `导出 ${EXPORT_FORMAT_LABELS[exportFormat]}`}
          </button>
        </div>
        <div className="note-editor-save-actions">
          <button type="button" className="menu-button" disabled={busy} onClick={handleClose}>
            关闭
          </button>
          {mode === 'edit' ? (
            <>
              <button type="button" className="menu-button" disabled={busy} onClick={handleCancel}>
                取消
              </button>
              <button
                type="button"
                className="primary-button note-save"
                disabled={busy}
                onClick={() => {
                  void handleSave();
                }}
              >
                {saving ? '保存中…' : '保存'}
              </button>
            </>
          ) : (
            <button
              type="button"
              className="primary-button note-save"
              disabled={busy}
              onClick={() => setMode('edit')}
            >
              编辑
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
