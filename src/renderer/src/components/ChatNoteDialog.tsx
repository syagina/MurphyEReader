import { useEffect, useMemo, useState } from 'react';
import type { Note, Paper } from '@shared/types';
import {
  AI_NOTE_TAG,
  appendAiNoteContent,
  buildNewAiNoteContent,
  mergeAiNoteTags,
} from '../lib/chat-note';
import type { AiNoteKind } from '../lib/chat-note';
import { errorMessage } from '../lib/errors';
import { formatTimestamp } from '../lib/format';
import { useNotesStore } from '../stores/notes';
import { MarkdownView } from './MarkdownView';

export interface ChatNoteDraft {
  markdown: string;
  pageNo: number | null;
  kind: AiNoteKind;
  title: string;
}

interface ChatNoteDialogProps {
  paper: Paper;
  draft: ChatNoteDraft;
  onClose(): void;
  onSaved(note: Note): void;
}

type NoteTarget = 'new' | 'append';

/**
 * Save dialog for AI answers and selected fragments. Whole answers keep their
 * original Markdown (including formulas); fragments arrive already converted
 * to Markdown by the selection serializer.
 */
export function ChatNoteDialog({
  paper,
  draft,
  onClose,
  onSaved,
}: ChatNoteDialogProps): React.JSX.Element {
  const [title, setTitle] = useState(draft.title);
  const [target, setTarget] = useState<NoteTarget>('new');
  const [appendId, setAppendId] = useState('');
  const [notes, setNotes] = useState<Note[]>([]);
  const [loadingNotes, setLoadingNotes] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setTitle(draft.title);
    setTarget('new');
    setAppendId('');
    setError(null);
  }, [draft]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const loaded = await window.api.notes.list(paper.id);
        if (cancelled) {
          return;
        }
        setNotes(loaded);
        if (loaded.length > 0) {
          setAppendId(String(loaded[0]?.id ?? ''));
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(errorMessage(loadError));
        }
      } finally {
        if (!cancelled) {
          setLoadingNotes(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [paper.id]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const appendNote = useMemo(
    () => notes.find((note) => note.id === Number(appendId)) ?? null,
    [notes, appendId],
  );

  const handleSubmit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (saving) {
      return;
    }
    setError(null);
    const trimmedTitle = title.trim();
    if (target === 'new' && trimmedTitle === '') {
      setError('标题不能为空');
      return;
    }
    if (target === 'append' && appendNote === null) {
      setError('请选择要追加的笔记');
      return;
    }

    setSaving(true);
    try {
      let saved: Note | null;
      if (target === 'new') {
        saved = await useNotesStore.getState().create({
          paperId: paper.id,
          type: 'manual',
          title: trimmedTitle,
          contentMd: buildNewAiNoteContent(draft.markdown, draft.pageNo, draft.kind),
          tags: [AI_NOTE_TAG],
        });
      } else if (appendNote !== null) {
        saved = await useNotesStore.getState().update(appendNote.id, {
          contentMd: appendAiNoteContent(
            appendNote.contentMd,
            draft.markdown,
            draft.pageNo,
            draft.kind,
          ),
          tags: mergeAiNoteTags(appendNote.tags),
        });
      } else {
        saved = null;
      }

      if (saved === null) {
        setError(useNotesStore.getState().error ?? '保存笔记失败');
        return;
      }
      onSaved(saved);
    } catch (saveError) {
      setError(errorMessage(saveError));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="settings-backdrop chat-note-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <form
        className="settings-dialog chat-note-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="存为笔记"
        onSubmit={(event) => {
          void handleSubmit(event);
        }}
      >
        <h2 className="settings-title">存为笔记</h2>
        <p className="chat-note-source">
          {draft.kind === 'selection' ? '选中片段' : '整条回答'}
          {draft.pageNo === null ? '' : ` · 第 ${draft.pageNo} 页`} · 《{paper.title}》
        </p>

        <div className="chat-note-targets" role="radiogroup" aria-label="保存方式">
          <label className="chat-note-radio">
            <input
              type="radio"
              name="note-target"
              checked={target === 'new'}
              onChange={() => setTarget('new')}
            />
            新建笔记
          </label>
          <label className={notes.length === 0 ? 'chat-note-radio disabled' : 'chat-note-radio'}>
            <input
              type="radio"
              name="note-target"
              checked={target === 'append'}
              disabled={loadingNotes || notes.length === 0}
              onChange={() => setTarget('append')}
            />
            追加到已有笔记
          </label>
        </div>

        {target === 'new' ? (
          <label className="settings-field">
            标题
            <input
              autoFocus
              className="settings-input"
              value={title}
              disabled={saving}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
        ) : (
          <>
            <label className="settings-field">
              追加到
              <select
                className="settings-input"
                value={appendId}
                disabled={saving || loadingNotes}
                onChange={(event) => setAppendId(event.target.value)}
              >
                {loadingNotes ? (
                  <option value="">正在加载笔记…</option>
                ) : (
                  notes.map((note) => (
                    <option value={note.id} key={note.id}>
                      {note.title}（{formatTimestamp(note.updatedAt)}）
                    </option>
                  ))
                )}
              </select>
            </label>
            {appendNote !== null && (
              <p className="chat-note-append-hint">
                将追加到「{appendNote.title}」末尾，并添加「{AI_NOTE_TAG}」标签。
              </p>
            )}
          </>
        )}

        <div className="chat-note-preview-wrap">
          <span className="chat-note-preview-label">将写入的内容</span>
          <div className="chat-note-preview">
            <MarkdownView text={draft.markdown} />
          </div>
        </div>

        {error !== null && (
          <div className="settings-error" role="alert">
            {error}
          </div>
        )}

        <div className="settings-actions">
          <button type="button" className="menu-button" disabled={saving} onClick={onClose}>
            取消
          </button>
          <button type="submit" className="primary-button settings-save" disabled={saving}>
            {saving ? '保存中…' : '保存到笔记'}
          </button>
        </div>
      </form>
    </div>
  );
}
