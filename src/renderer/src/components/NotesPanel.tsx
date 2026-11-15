import { useEffect, useState } from 'react';
import type { ExportFormat, Paper } from '@shared/types';
import { errorMessage } from '../lib/errors';
import { EXPORT_FORMAT_LABELS, exportNoteDocument } from '../lib/export-note';
import {
  NOTE_TYPE_SECTIONS,
  buildNotesExportFileName,
  buildPaperNotesMarkdown,
} from '../lib/export-markdown';
import { formatTimestamp } from '../lib/format';
import { useNotesStore } from '../stores/notes';
import { NoteEditor } from './NoteEditor';

interface NotesPanelProps {
  paper: Paper;
}

const NEW_NOTE_TITLE = '未命名笔记';

export function NotesPanel({ paper }: NotesPanelProps): React.JSX.Element {
  const notes = useNotesStore((state) => state.notes);
  const selectedNoteId = useNotesStore((state) => state.selectedNoteId);
  const generating = useNotesStore((state) => state.generating);
  const error = useNotesStore((state) => state.error);
  const load = useNotesStore((state) => state.load);
  const create = useNotesStore((state) => state.create);
  const generate = useNotesStore((state) => state.generate);
  const selectNote = useNotesStore((state) => state.selectNote);
  const clearError = useNotesStore((state) => state.clearError);

  const [exporting, setExporting] = useState(false);
  const [exportFormat, setExportFormat] = useState<ExportFormat>('pdf');
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    setLocalError(null);
    void load(paper.id);
  }, [paper.id, load]);

  const selectedNote =
    selectedNoteId === null
      ? null
      : (notes.find((note) => note.id === selectedNoteId) ?? null);

  const handleNewNote = (): void => {
    setLocalError(null);
    void create({
      paperId: paper.id,
      type: 'manual',
      title: NEW_NOTE_TITLE,
      contentMd: '',
      tags: [],
    });
  };

  const handleInnovation = (): void => {
    setLocalError(null);
    void generate('innovation', { paperId: paper.id });
  };

  const handleExport = async (): Promise<void> => {
    setLocalError(null);
    setExporting(true);
    try {
      const markdown = buildPaperNotesMarkdown(paper, notes);
      await exportNoteDocument(
        buildNotesExportFileName(paper, exportFormat),
        `《${paper.title}》笔记`,
        markdown,
        exportFormat,
        { scope: 'all' },
      );
    } catch (exportError) {
      setLocalError(errorMessage(exportError));
    } finally {
      setExporting(false);
    }
  };

  const visibleError = error ?? localError;
  const groups = NOTE_TYPE_SECTIONS.map((section) => ({
    ...section,
    notes: notes.filter((note) => note.type === section.type),
  })).filter((section) => section.notes.length > 0);

  return (
    <div className="notes-panel">
      <div className="notes-toolbar">
        <button
          type="button"
          className="primary-button notes-new"
          onClick={handleNewNote}
        >
          新建笔记
        </button>
        <div className="notes-toolbar-actions">
          <button
            type="button"
            className="menu-button"
            disabled={generating !== null}
            onClick={handleInnovation}
          >
            {generating === 'innovation' ? '生成中…' : '找创新点'}
          </button>
          <select
            className="notes-export-format"
            aria-label="导出格式"
            value={exportFormat}
            disabled={exporting || notes.length === 0}
            onChange={(event) => setExportFormat(event.target.value as ExportFormat)}
          >
            <option value="pdf">PDF</option>
            <option value="docx">Word (.docx)</option>
            <option value="md">Markdown (.md)</option>
          </select>
          <button
            type="button"
            className="menu-button"
            disabled={exporting || notes.length === 0}
            onClick={() => {
              void handleExport();
            }}
          >
            {exporting
              ? '导出中…'
              : `导出 ${EXPORT_FORMAT_LABELS[exportFormat]}`}
          </button>
        </div>
      </div>

      {visibleError !== null && (
        <div className="notes-error" role="alert">
          <span>{visibleError}</span>
          <button
            type="button"
            className="menu-button"
            onClick={() => {
              clearError();
              setLocalError(null);
            }}
          >
            关闭
          </button>
        </div>
      )}

      {selectedNote !== null ? (
        <NoteEditor
          paper={paper}
          note={selectedNote}
          onClose={() => selectNote(null)}
        />
      ) : (
        <div className="notes-list">
          {notes.length === 0 && (
            <p className="empty-state">
              还没有笔记。选中 PDF 中的文字存为笔记，或生成结构化总结。
            </p>
          )}
          {groups.map((section) => (
            <section className="note-group" key={section.type}>
              <h3 className="note-group-heading">{section.heading}</h3>
              <ul className="note-group-list">
                {section.notes.map((note) => (
                  <li key={note.id}>
                    <button
                      type="button"
                      className="note-item"
                      onClick={() => selectNote(note.id)}
                    >
                      <span className="note-item-title">{note.title}</span>
                      <span className="note-item-time">{formatTimestamp(note.updatedAt)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
