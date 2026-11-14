import type { Note, NoteType, Paper } from '@shared/types';
import { formatTimestamp } from './format';

export interface NoteTypeSection {
  type: NoteType;
  heading: string;
}

/** Windows refuses these characters in file names; controls are also unsafe. */
const ILLEGAL_FILENAME_CHARS = /[<>:"/\\|?*\u0000-\u001f\u007f]+/g;

/**
 * Builds the save-dialog default name for a paper's notes export. Illegal
 * Windows filename characters are replaced with `_`; leading/trailing dots,
 * underscores and spaces are stripped. A title with no usable characters
 * falls back to `笔记`, so the name always stays usable.
 */
export function buildNotesExportFileName(paper: Pick<Paper, 'title'>): string {
  const sanitized = paper.title
    .replace(ILLEGAL_FILENAME_CHARS, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[._\s]+|[._\s]+$/g, '');
  return `${sanitized === '' ? '笔记' : sanitized}-笔记.md`;
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
