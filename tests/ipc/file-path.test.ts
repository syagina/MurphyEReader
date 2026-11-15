import { describe, expect, it } from 'vitest';
import { ensureFileExtension } from '@main/export/file-path';

describe('ensureFileExtension', () => {
  it('adds the requested extension when the path has none', () => {
    expect(ensureFileExtension('C:/notes/论文笔记', '.pdf')).toBe('C:/notes/论文笔记.pdf');
    expect(ensureFileExtension('C:/notes/论文笔记', 'docx')).toBe('C:/notes/论文笔记.docx');
  });

  it('keeps an extension the user typed, even if different', () => {
    expect(ensureFileExtension('C:/notes/a.md', '.pdf')).toBe('C:/notes/a.md');
    expect(ensureFileExtension('C:/notes/a.docx', '.docx')).toBe('C:/notes/a.docx');
  });
});
