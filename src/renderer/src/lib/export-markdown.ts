import { sanitizeFileNamePart } from '@shared/file-name';
import type { ExportFormat, Note, NoteType, Paper } from '@shared/types';
import { formatTimestamp } from './format';

export { sanitizeFileNamePart };

export interface NoteTypeSection {
  type: NoteType;
  heading: string;
}

const EXPORT_EXTENSIONS: Record<ExportFormat, string> = {
  md: 'md',
  pdf: 'pdf',
  docx: 'docx',
};

/**
 * Builds the save-dialog default name for a paper's notes export. The
 * default remains Markdown for callers that predate the format selector.
 */
export function buildNotesExportFileName(
  paper: Pick<Paper, 'title'>,
  format: ExportFormat = 'md',
): string {
  return `${sanitizeFileNamePart(paper.title, '笔记')}-笔记.${EXPORT_EXTENSIONS[format]}`;
}

/** Builds the save-dialog default name for one note and its paper. */
export function buildNoteExportFileName(
  paper: Pick<Paper, 'title'>,
  note: Pick<Note, 'title'>,
  format: ExportFormat = 'md',
): string {
  return `${sanitizeFileNamePart(paper.title, '文献')}-${sanitizeFileNamePart(
    note.title,
    '笔记',
  )}.${EXPORT_EXTENSIONS[format]}`;
}

/**
 * Display order and headings shared by the notes panel and the Markdown
 * export: 概念卡, 总结, 笔记, 创新点.
 */
export const NOTE_TYPE_SECTIONS: readonly NoteTypeSection[] = [
  { type: 'concept', heading: '概念卡' },
  { type: 'summary', heading: '总结' },
  { type: 'manual', heading: '笔记' },
  { type: 'idea', heading: '创新点' },
];

/**
 * Builds a shareable Markdown document for one paper: a title containing the
 * paper name, one section per note type (in fixed order) and every note with
 * its timestamps, tags and body. Sections without notes are omitted.
 */
export function buildPaperNotesMarkdown(paper: Paper, notes: Note[]): string {
  const lines: string[] = [`# 《${paper.title}》笔记`, ''];
  let wroteSection = false;

  for (const section of NOTE_TYPE_SECTIONS) {
    const sectionNotes = notes.filter((note) => note.type === section.type);
    if (sectionNotes.length === 0) {
      continue;
    }
    wroteSection = true;
    lines.push(`## ${section.heading}`, '');
    for (const note of sectionNotes) {
      lines.push(`### ${note.title}`, '');
      lines.push(`创建时间：${formatTimestamp(note.createdAt)}`);
      lines.push(`更新时间：${formatTimestamp(note.updatedAt)}`);
      if (note.tags.length > 0) {
        lines.push(`标签：${note.tags.join('、')}`);
      }
      lines.push('', note.contentMd.trimEnd(), '');
    }
  }

  if (!wroteSection) {
    lines.push('暂无笔记。');
  }

  return `${lines.join('\n').trimEnd()}\n`;
}

/**
 * Builds a single-note Markdown document. The paper title, timestamps and
 * tags give the exported PDF/Word file enough context when it is read on its
 * own, away from the notes panel.
 */
export function buildNoteMarkdown(paper: Pick<Paper, 'title'>, note: Note): string {
  const lines = [
    `# ${note.title}`,
    '',
    `**文献：**《${paper.title}》`,
    `创建时间：${formatTimestamp(note.createdAt)}`,
    `更新时间：${formatTimestamp(note.updatedAt)}`,
  ];
  if (note.tags.length > 0) {
    lines.push(`标签：${note.tags.join('、')}`);
  }
  lines.push('', note.contentMd.trimEnd());
  return `${lines.join('\n').trimEnd()}\n`;
}

