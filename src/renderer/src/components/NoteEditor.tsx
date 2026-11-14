import { useEffect, useState } from 'react';
import type { Note } from '@shared/types';
import { parseTags } from '../lib/format';
import { useNotesStore } from '../stores/notes';
import { MarkdownView } from './MarkdownView';

interface NoteEditorProps {
  note: Note;
  onClose(): void;
}

type EditorMode = 'edit' | 'preview';

export function NoteEditor({ note, onClose }: NoteEditorProps): React.JSX.Element {
  const update = useNotesStore((state) => state.update);
  const remove = useNotesStore((state) => state.remove);

  const [title, setTitle] = useState(note.title);
  const [tags, setTags] = useState(note.tags.join(', '));
  const [contentMd, setContentMd] = useState(note.contentMd);
  const [mode, setMode] = useState<EditorMode>('edit');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  // Switching notes or saving (updatedAt changes) resets the draft to the
  // stored values; ordinary typing does not touch `note`.
  useEffect(() => {
    setTitle(note.title);
    setTags(note.tags.join(', '));
    setContentMd(note.contentMd);
    setMode('edit');
    setLocalError(null);
  }, [note.id, note.updatedAt]);

  const busy = saving || deleting;

  const handleSave = async (): Promise<void> => {
    const trimmedTitle = title.trim();
    if (trimmedTitle === '') {
      setLocalError('标题不能为空');
      return;
    }
    setSaving(true);
    setLocalError(null);
    await update(note.id, {
      title: trimmedTitle,
      tags: parseTags(tags),
      contentMd,
    });
    setSaving(false);
    if (useNotesStore.getState().error === null) {
      onClose();
    }
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
        <label className="note-editor-field">
          标题
          <input
            className="note-editor-input"
            value={title}
            disabled={busy}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label className="note-editor-field">
          标签（用逗号分隔）
          <input
            className="note-editor-input"
            value={tags}
            disabled={busy}
            onChange={(event) => setTags(event.target.value)}
          />
        </label>
        {mode === 'edit' ? (
          <label className="note-editor-field note-editor-content">
            内容（Markdown）
            <textarea
              className="note-editor-textarea"
              value={contentMd}
              rows={14}
              disabled={busy}
              onChange={(event) => setContentMd(event.target.value)}
            />
          </label>
        ) : (
          <div className="note-editor-preview">
            {contentMd.trim() === '' ? (
              <p className="empty-state">还没有内容。</p>
            ) : (
              <MarkdownView text={contentMd} className="note-preview" />
            )}
          </div>
        )}
      </div>

      <div className="note-editor-actions">
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
        <div className="note-editor-save-actions">
          <button
            type="button"
            className="menu-button"
            disabled={busy}
            onClick={onClose}
          >
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
        </div>
      </div>
    </div>
  );
}
