import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb } from '@main/db';
import { createPaper, deletePaper } from '@main/db/papers';
import {
  clearPageDrawings,
  countPageDrawings,
  createStickyNote,
  deleteStickyNote,
  getStickyNote,
  listStickyNotes,
  updateStickyNote,
} from '@main/db/sticky-notes';
import type { Paper, PdfVersion, StickyNoteCreateData } from '@shared/types';

let tempDir: string;
let db: Database.Database;
let paperId: number;

function makePaper(title = '便签测试论文'): Paper {
  return createPaper(db, {
    title,
    authors: '张三',
    year: 2024,
    filePathOriginal: 'C:/papers/test.pdf',
    filePathTranslated: null,
    pageCountOriginal: 10,
    pageCountTranslated: null,
    hasTextLayer: true,
    outline: [],
    folderId: null,
    storageDir: null,
    fileHash: null,
  });
}

function makeInput(
  overrides: Partial<StickyNoteCreateData> = {},
): StickyNoteCreateData {
  return {
    paperId,
    pdfVersion: 'original',
    pageNo: 2,
    quote: '选中原文',
    contentMd: '便签内容',
    anchor: {
      kind: 'text',
      rects: [{ x: 0.1, y: 0.2, width: 0.3, height: 0.04 }],
    },
    source: 'manual',
    kind: 'note',
    markStyle: 'highlight',
    color: null,
    pin: null,
    popup: null,
    drawing: null,
    ...overrides,
  };
}

function makeInkInput(
  overrides: Partial<StickyNoteCreateData> = {},
): StickyNoteCreateData {
  return makeInput({
    kind: 'ink',
    quote: '',
    contentMd: '',
    anchor: { kind: 'page' },
    markStyle: 'none',
    color: null,
    drawing: {
      tool: 'pen',
      color: '#111827',
      width: 2,
      opacity: 1,
      points: [
        [0.1, 0.1],
        [0.2, 0.2],
      ],
    },
    ...overrides,
  });
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'paperlens-sticky-'));
  db = openDb(join(tempDir, 'paperlens.db'));
  paperId = makePaper().id;
});

afterEach(() => {
  vi.restoreAllMocks();
  db.close();
  rmSync(tempDir, { recursive: true, force: true });
});

describe('createStickyNote', () => {
  it('创建后返回完整映射，createdAt 与 updatedAt 相同', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000);

    const note = createStickyNote(
      db,
      makeInput({
        pdfVersion: 'translated',
        pageNo: 3,
        quote: '原文引用',
        contentMd: '# 便签',
        anchor: {
          kind: 'text',
          rects: [
            { x: 0.1, y: 0.2, width: 0.3, height: 0.04 },
            { x: 0.1, y: 0.25, width: 0.2, height: 0.04 },
          ],
        },
        source: 'translation',
      }),
    );

    expect(note).toMatchObject({
      paperId,
      pdfVersion: 'translated',
      pageNo: 3,
      quote: '原文引用',
      contentMd: '# 便签',
      source: 'translation',
      createdAt: 1000,
      updatedAt: 1000,
    });
    expect(note.anchor).toEqual({
      kind: 'text',
      rects: [
        { x: 0.1, y: 0.2, width: 0.3, height: 0.04 },
        { x: 0.1, y: 0.25, width: 0.2, height: 0.04 },
      ],
    });
    expect(note.id).toBeGreaterThan(0);
    expect(getStickyNote(db, note.id)).toEqual(note);
  });

  it('整页锚点往返不变', () => {
    const note = createStickyNote(
      db,
      makeInput({
        anchor: { kind: 'page' },
        quote: '',
        contentMd: '页边便签',
        markStyle: 'none',
        source: 'ai',
      }),
    );
    expect(getStickyNote(db, note.id)?.anchor).toEqual({ kind: 'page' });
  });

  it('新字段完整往返', () => {
    const note = createStickyNote(
      db,
      makeInput({
        kind: 'note',
        markStyle: 'wavy-underline',
        color: '#3b82f6',
        pin: { x: 0.25, y: 0.4, visible: true },
        popup: { mode: 'free', x: 0.5, y: 0.25 },
      }),
    );
    expect(getStickyNote(db, note.id)).toMatchObject({
      markStyle: 'wavy-underline',
      color: '#3b82f6',
      pin: { x: 0.25, y: 0.4, visible: true },
      popup: { mode: 'free', x: 0.5, y: 0.25 },
    });
  });

  it('单页最多 500 条绘制标注', () => {
    for (let index = 0; index < 500; index += 1) {
      createStickyNote(db, makeInkInput());
    }
    expect(countPageDrawings(db, paperId, 'original', 2)).toBe(500);

    expect(() => createStickyNote(db, makeInkInput())).toThrow(/500/);
    expect(countPageDrawings(db, paperId, 'original', 2)).toBe(500);
  });
});

describe('listStickyNotes', () => {
  const versions: PdfVersion[] = ['original', 'translated', 'bilingual'];

  it('按页码升序、同页按创建时间升序、再按 id 升序', () => {
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValue(3000);
    const pageTwo = createStickyNote(db, makeInput({ pageNo: 2, quote: '第二页后' }));
    now.mockReturnValue(1000);
    const pageOne = createStickyNote(db, makeInput({ pageNo: 1, quote: '第一页' }));
    now.mockReturnValue(2000);
    const pageTwoEarlier = createStickyNote(db, makeInput({ pageNo: 2, quote: '第二页先' }));

    expect(listStickyNotes(db, paperId, 'original').map((note) => note.id)).toEqual([
      pageOne.id,
      pageTwoEarlier.id,
      pageTwo.id,
    ]);
  });

  it('三种 PDF 版本相互隔离', () => {
    const created = versions.map((pdfVersion) =>
      createStickyNote(db, makeInput({ pdfVersion, quote: pdfVersion })),
    );

    for (const [index, version] of versions.entries()) {
      const notes = listStickyNotes(db, paperId, version);
      expect(notes).toHaveLength(1);
      expect(notes[0].id).toBe(created[index].id);
    }
  });

  it('只返回指定论文的便签', () => {
    const otherPaper = makePaper('另一篇');
    createStickyNote(db, makeInput());
    createStickyNote(db, makeInput({ paperId: otherPaper.id }));

    expect(listStickyNotes(db, paperId, 'original')).toHaveLength(1);
    expect(listStickyNotes(db, otherPaper.id, 'original')).toHaveLength(1);
  });
});

describe('updateStickyNote', () => {
  it('只更新内容与 updatedAt，引用、锚点、页码、版本、来源不变', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000);
    const note = createStickyNote(db, makeInput());

    vi.spyOn(Date, 'now').mockReturnValue(5000);
    const updated = updateStickyNote(db, note.id, { contentMd: '新的内容' });

    expect(updated.contentMd).toBe('新的内容');
    expect(updated.updatedAt).toBe(5000);
    expect(updated.createdAt).toBe(1000);
    expect(updated.quote).toBe(note.quote);
    expect(updated.anchor).toEqual(note.anchor);
    expect(updated.pageNo).toBe(note.pageNo);
    expect(updated.pdfVersion).toBe(note.pdfVersion);
    expect(updated.source).toBe(note.source);
  });

  it('更新不存在的便签报错', () => {
    expect(() => updateStickyNote(db, 9999, { contentMd: 'x' })).toThrow(/不存在/);
  });

  it('内容清空且保留标记时 note 变 mark，并清除图标/弹窗', () => {
    const note = createStickyNote(
      db,
      makeInput({
        pin: { x: 0.2, y: 0.2, visible: true },
        popup: { mode: 'right' },
      }),
    );
    const updated = updateStickyNote(db, note.id, { contentMd: '' });
    expect(updated).toMatchObject({ kind: 'mark', pin: null, popup: null });
  });

  it('纯标记加内容后变回 note', () => {
    const mark = createStickyNote(db, makeInput({ contentMd: '', kind: 'mark' }));
    expect(updateStickyNote(db, mark.id, { contentMd: '补充' }).kind).toBe('note');
  });

  it('清空内容且没有正文标记时拒绝', () => {
    const note = createStickyNote(db, makeInput({ markStyle: 'none' }));
    expect(() => updateStickyNote(db, note.id, { contentMd: '' })).toThrow(
      /保留一种正文标记/,
    );
  });

  it('整页便签更新后强制无正文标记', () => {
    const note = createStickyNote(
      db,
      makeInput({
        anchor: { kind: 'page' },
        contentMd: '页边便签',
        markStyle: 'none',
      }),
    );
    const updated = updateStickyNote(db, note.id, {
      markStyle: 'underline',
      color: '#ef4444',
    });
    expect(updated).toMatchObject({ kind: 'note', markStyle: 'none', color: null });
  });

  it('绘制记录不受 update 编辑', () => {
    const ink = createStickyNote(db, makeInkInput());
    expect(() => updateStickyNote(db, ink.id, { contentMd: 'x' })).toThrow(/绘制/);
  });
});

describe('countPageDrawings / clearPageDrawings', () => {
  it('清空本页只删绘制并返回条数', () => {
    createStickyNote(db, makeInput({ kind: 'note' }));
    createStickyNote(db, makeInput({ kind: 'mark', contentMd: '' }));
    createStickyNote(db, makeInkInput());

    expect(countPageDrawings(db, paperId, 'original', 2)).toBe(1);
    expect(clearPageDrawings(db, paperId, 'original', 2)).toBe(1);
    expect(countPageDrawings(db, paperId, 'original', 2)).toBe(0);
    expect(listStickyNotes(db, paperId, 'original')).toHaveLength(2);
  });

  it('清空本页不跨版本、不跨论文', () => {
    const otherPaper = makePaper('另一篇');
    const target = createStickyNote(db, makeInkInput());
    const translated = createStickyNote(
      db,
      makeInkInput({ pdfVersion: 'translated' }),
    );
    const otherPage = createStickyNote(db, makeInkInput({ pageNo: 3 }));
    const otherPaperInk = createStickyNote(
      db,
      makeInkInput({ paperId: otherPaper.id }),
    );

    expect(clearPageDrawings(db, paperId, 'original', 2)).toBe(1);

    expect(getStickyNote(db, target.id)).toBeNull();
    expect(getStickyNote(db, translated.id)).not.toBeNull();
    expect(getStickyNote(db, otherPage.id)).not.toBeNull();
    expect(getStickyNote(db, otherPaperInk.id)).not.toBeNull();
    expect(countPageDrawings(db, paperId, 'original', 2)).toBe(0);
    expect(countPageDrawings(db, paperId, 'translated', 2)).toBe(1);
    expect(countPageDrawings(db, paperId, 'original', 3)).toBe(1);
    expect(countPageDrawings(db, otherPaper.id, 'original', 2)).toBe(1);
  });
});

describe('deleteStickyNote', () => {
  it('删除后查询为空且不报错', () => {
    const note = createStickyNote(db, makeInput());

    deleteStickyNote(db, note.id);

    expect(getStickyNote(db, note.id)).toBeNull();
    expect(() => deleteStickyNote(db, note.id)).not.toThrow();
  });
});

describe('论文删除级联', () => {
  it('删除论文时其便签一并删除', () => {
    const note = createStickyNote(db, makeInput());

    deletePaper(db, paperId);

    expect(getStickyNote(db, note.id)).toBeNull();
  });
});

describe('损坏的锚点数据', () => {
  it('anchor_json 无法解析时降级为整页锚点', () => {
    const note = createStickyNote(db, makeInput());
    db.prepare('UPDATE sticky_notes SET anchor_json = ? WHERE id = ?').run(
      '{not json',
      note.id,
    );

    expect(getStickyNote(db, note.id)?.anchor).toEqual({ kind: 'page' });
    expect(listStickyNotes(db, paperId, 'original')[0].anchor).toEqual({ kind: 'page' });
  });

  it('anchor_json 结构非法时降级为整页锚点', () => {
    const note = createStickyNote(db, makeInput());
    db.prepare('UPDATE sticky_notes SET anchor_json = ? WHERE id = ?').run(
      JSON.stringify({ kind: 'text', rects: [{ x: 'bad' }] }),
      note.id,
    );

    expect(getStickyNote(db, note.id)?.anchor).toEqual({ kind: 'page' });
  });
});
