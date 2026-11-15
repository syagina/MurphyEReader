import { describe, expect, it } from 'vitest';
import type { Note, Paper } from '@shared/types';
import {
  buildNoteExportFileName,
  buildNoteMarkdown,
  buildNotesExportFileName,
  buildPaperNotesMarkdown,
} from '@renderer/lib/export-markdown';

function makePaper(overrides: Partial<Paper> = {}): Paper {
  return {
    id: 1,
    title: '有限元方法导论',
    authors: '张三',
    year: 2020,
    filePathOriginal: 'C:/papers/fem.pdf',
    filePathTranslated: null,
    pageCountOriginal: 10,
    pageCountTranslated: null,
    hasTextLayer: true,
    outline: [],
    tags: [],
    lastPageOriginal: 1,
    lastPageTranslated: 1,
    addedAt: 1_000,
    lastReadAt: null,
    folderId: null,
    storageDir: null,
    fileHash: null,
    ...overrides,
  };
}

function makeNote(id: number, overrides: Partial<Note> = {}): Note {
  return {
    id,
    paperId: 1,
    type: 'manual',
    title: `笔记 ${id}`,
    contentMd: `内容 ${id}`,
    tags: [],
    createdAt: 1_700_000_000_000 + id * 1_000,
    updatedAt: 1_700_000_000_000 + id * 2_000,
    ...overrides,
  };
}

describe('buildPaperNotesMarkdown', () => {
  it('输出文献标题、按类型分节并包含每条笔记的标题与正文', () => {
    const notes = [
      makeNote(1, { type: 'concept', title: '应变能密度', contentMd: '概念正文' }),
      makeNote(2, { type: 'summary', title: '核心思想', contentMd: '总结正文' }),
      makeNote(3, { type: 'manual', title: '手动记录', contentMd: '笔记正文' }),
      makeNote(4, { type: 'idea', title: '创新点分析', contentMd: '创新正文' }),
    ];

    const markdown = buildPaperNotesMarkdown(makePaper(), notes);

    expect(markdown).toContain('# 《有限元方法导论》笔记');
    expect(markdown).toContain('## 概念卡');
    expect(markdown).toContain('## 总结');
    expect(markdown).toContain('## 笔记');
    expect(markdown).toContain('## 创新点');
    expect(markdown).toContain('### 应变能密度');
    expect(markdown).toContain('概念正文');
    expect(markdown).toContain('### 核心思想');
    expect(markdown).toContain('总结正文');
    expect(markdown).toContain('### 手动记录');
    expect(markdown).toContain('笔记正文');
    expect(markdown).toContain('### 创新点分析');
    expect(markdown).toContain('创新正文');
  });

  it('按概念卡、总结、笔记、创新点的固定顺序分节', () => {
    const notes = [
      makeNote(1, { type: 'idea', title: '创新' }),
      makeNote(2, { type: 'manual', title: '笔记' }),
      makeNote(3, { type: 'summary', title: '总结' }),
      makeNote(4, { type: 'concept', title: '概念' }),
    ];

    const markdown = buildPaperNotesMarkdown(makePaper(), notes);
    const conceptAt = markdown.indexOf('## 概念卡');
    const summaryAt = markdown.indexOf('## 总结');
    const manualAt = markdown.indexOf('## 笔记');
    const ideaAt = markdown.indexOf('## 创新点');

    expect(conceptAt).toBeGreaterThan(-1);
    expect(summaryAt).toBeGreaterThan(conceptAt);
    expect(manualAt).toBeGreaterThan(summaryAt);
    expect(ideaAt).toBeGreaterThan(manualAt);
  });

  it('每条笔记包含创建时间、更新时间与标签', () => {
    const notes = [
      makeNote(1, {
        type: 'concept',
        tags: ['弹性', '数值'],
        createdAt: 1_700_000_000_000,
        updatedAt: 1_700_000_100_000,
      }),
    ];

    const markdown = buildPaperNotesMarkdown(makePaper(), notes);

    expect(markdown).toMatch(/创建时间：\d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
    expect(markdown).toMatch(/更新时间：\d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
    expect(markdown).toContain('标签：弹性、数值');
  });

  it('没有笔记时只输出文献标题与占位提示', () => {
    const markdown = buildPaperNotesMarkdown(makePaper({ title: '空文献' }), []);

    expect(markdown).toContain('# 《空文献》笔记');
    expect(markdown).toContain('暂无笔记。');
    expect(markdown).not.toContain('## 概念卡');
  });

  it('不同笔记类型分入各自小节且不混入其他小节', () => {
    const notes = [
      makeNote(1, { type: 'concept', title: '概念甲', contentMd: '仅概念' }),
      makeNote(2, { type: 'summary', title: '总结乙', contentMd: '仅总结' }),
    ];

    const markdown = buildPaperNotesMarkdown(makePaper(), notes);
    const conceptSection = markdown.slice(
      markdown.indexOf('## 概念卡'),
      markdown.indexOf('## 总结'),
    );
    const summarySection = markdown.slice(markdown.indexOf('## 总结'));

    expect(conceptSection).toContain('概念甲');
    expect(conceptSection).not.toContain('总结乙');
    expect(summarySection).toContain('总结乙');
    expect(summarySection).not.toContain('概念甲');
  });
});

describe('buildNotesExportFileName', () => {
  it('普通标题保留原名并追加笔记后缀', () => {
    expect(buildNotesExportFileName({ title: '有限元方法导论' })).toBe(
      '有限元方法导论-笔记.md',
    );
  });

  it('替换 Windows 非法字符与控制字符且保留后缀', () => {
    const name = buildNotesExportFileName({
      title: 'A/B: C? <D>|E*F"G\\H\u0001',
    });

    expect(name).not.toMatch(/[<>:"/\\|?*\u0000-\u001f]/);
    expect(name.endsWith('-笔记.md')).toBe(true);
    expect(name.startsWith('A_B_ C_ _D_E_F_G_H')).toBe(true);
  });

  it('标题只有非法字符时仍返回可用文件名', () => {
    expect(buildNotesExportFileName({ title: ':?*"<>|/\\' })).toBe('笔记-笔记.md');
  });

  it('按导出格式选择扩展名', () => {
    expect(buildNotesExportFileName({ title: '论文' }, 'pdf')).toBe('论文-笔记.pdf');
    expect(buildNotesExportFileName({ title: '论文' }, 'docx')).toBe('论文-笔记.docx');
    expect(buildNotesExportFileName({ title: '论文' }, 'md')).toBe('论文-笔记.md');
  });
});

describe('buildNoteExportFileName', () => {
  it('includes both the paper and note titles', () => {
    expect(
      buildNoteExportFileName({ title: '有限元方法导论' }, { title: '核心思想' }, 'docx'),
    ).toBe('有限元方法导论-核心思想.docx');
  });

  it('sanitizes both title parts', () => {
    const name = buildNoteExportFileName(
      { title: 'A/B' },
      { title: 'C:D' },
      'pdf',
    );

    expect(name).toBe('A_B-C_D.pdf');
  });
});

describe('buildNoteMarkdown', () => {
  it('wraps one note with paper context, timestamps, tags, and body', () => {
    const markdown = buildNoteMarkdown(
      makePaper({ title: '有限元方法导论' }),
      makeNote(1, {
        title: '应变能密度',
        contentMd: '正文 $E = \\frac{1}{2}\\sigma\\varepsilon$',
        tags: ['弹性', '方法'],
      }),
    );

    expect(markdown).toContain('# 应变能密度');
    expect(markdown).toContain('**文献：**《有限元方法导论》');
    expect(markdown).toMatch(/创建时间：\d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
    expect(markdown).toContain('标签：弹性、方法');
    expect(markdown).toContain('正文 $E = \\frac{1}{2}\\sigma\\varepsilon$');
  });

  it('omits the tag line when the note has no tags', () => {
    const markdown = buildNoteMarkdown(
      { title: '论文' },
      makeNote(1, { tags: [] }),
    );

    expect(markdown).not.toContain('标签：');
  });
});
