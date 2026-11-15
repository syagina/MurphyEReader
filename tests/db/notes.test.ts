import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb } from '@main/db';
import {
  createNote,
  deleteNote,
  getNote,
  listNotes,
  listNotesByType,
  updateNote,
} from '@main/db/notes';
import type { NewNoteInput } from '@main/db/notes';
import { createPaper } from '@main/db/papers';
import type { Paper } from '@shared/types';

let tempDir: string;
let db: Database.Database;

function createTestDb(): Database.Database {
  tempDir = mkdtempSync(join(tmpdir(), 'paperlens-'));
  return openDb(join(tempDir, 'paperlens.db'));
}

beforeEach(() => {
  db = createTestDb();
});

afterEach(() => {
  vi.restoreAllMocks();
  db.close();
  rmSync(tempDir, { recursive: true, force: true });
});

function makePaper(title = '测试论文'): Paper {
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

function makeNoteInput(
  paperId: number,
  overrides: Partial<NewNoteInput> = {},
): NewNoteInput {
  return {
    paperId,
    type: 'manual',
    title: '有限元法笔记',
    contentMd: '# 有限元\n\n有限元法是一种数值求解方法。',
    tags: [],
    ...overrides,
  };
}

describe('createNote', () => {
  it('创建后返回映射完整的笔记且 createdAt 与 updatedAt 相同', () => {
    const paper = makePaper();
    vi.spyOn(Date, 'now').mockReturnValue(1000);

    const note = createNote(
      db,
      makeNoteInput(paper.id, {
        type: 'concept',
        title: '有限元空间',
        contentMd: '有限元空间是一种逼近空间。',
        tags: ['有限元', '逼近'],
      }),
    );

    expect(note).toMatchObject({
      paperId: paper.id,
      type: 'concept',
      title: '有限元空间',
      contentMd: '有限元空间是一种逼近空间。',
      tags: ['有限元', '逼近'],
    });
    expect(note.id).toBeGreaterThan(0);
    expect(note.createdAt).toBe(1000);
    expect(note.updatedAt).toBe(1000);
    expect(getNote(db, note.id)).toEqual(note);
  });

  it('空 tags 与中文标签经 JSON 往返均保持不变', () => {
    const paper = makePaper();
    vi.spyOn(Date, 'now').mockReturnValue(1000);

    const empty = createNote(db, makeNoteInput(paper.id, { title: '无标签' }));
    const cjk = createNote(
      db,
      makeNoteInput(paper.id, {
        title: '中文标签',
        tags: ['有限元', '数值方法'],
      }),
    );

    expect(getNote(db, empty.id)?.tags).toEqual([]);
    expect(getNote(db, cjk.id)?.tags).toEqual(['有限元', '数值方法']);
  });
});

describe('listNotes', () => {
  it('不传 paperId 时按 updatedAt 倒序返回全部笔记并用 id 打破平局', () => {
    const paperA = makePaper('论文A');
    const paperB = makePaper('论文B');
    const now = vi.spyOn(Date, 'now').mockReturnValue(1000);

    const older = createNote(db, makeNoteInput(paperA.id, { title: '较早' }));
    now.mockReturnValue(2000);
    const middle = createNote(db, makeNoteInput(paperB.id, { title: '居中' }));
    now.mockReturnValue(3000);
    const newer = createNote(db, makeNoteInput(paperA.id, { title: '较新' }));
    const tieBreak = createNote(db, makeNoteInput(paperB.id, { title: '同时间戳' }));

    expect(listNotes(db)).toEqual([tieBreak, newer, middle, older]);
  });

  it('传入 paperId 时只返回该论文的笔记', () => {
    const paperA = makePaper('论文A');
    const paperB = makePaper('论文B');
    const now = vi.spyOn(Date, 'now').mockReturnValue(1000);

    const olderA = createNote(db, makeNoteInput(paperA.id, { title: 'A 较早' }));
    now.mockReturnValue(2000);
    const onlyB = createNote(db, makeNoteInput(paperB.id, { title: 'B 唯一' }));
    now.mockReturnValue(3000);
    const newerA = createNote(db, makeNoteInput(paperA.id, { title: 'A 较新' }));

    expect(listNotes(db, paperA.id)).toEqual([newerA, olderA]);
    expect(listNotes(db, paperB.id)).toEqual([onlyB]);
  });

  it('没有任何笔记时返回空数组', () => {
    const paper = makePaper();

    expect(listNotes(db)).toEqual([]);
    expect(listNotes(db, paper.id)).toEqual([]);
  });
});

describe('listNotesByType', () => {
  it('只返回指定类型的笔记并按 updatedAt 倒序', () => {
    const paperA = makePaper('论文A');
    const paperB = makePaper('论文B');
    const now = vi.spyOn(Date, 'now').mockReturnValue(1000);

    const olderConcept = createNote(
      db,
      makeNoteInput(paperA.id, { type: 'concept', title: '概念一' }),
    );
    now.mockReturnValue(2000);
    createNote(db, makeNoteInput(paperB.id, { type: 'summary', title: '总结' }));
    now.mockReturnValue(3000);
    const newerConcept = createNote(
      db,
      makeNoteInput(paperB.id, { type: 'concept', title: '概念二' }),
    );

    expect(listNotesByType(db, 'concept')).toEqual([newerConcept, olderConcept]);
    expect(listNotesByType(db, 'idea')).toEqual([]);
  });
});

describe('getNote', () => {
  it('不存在的 id 返回 null', () => {
    expect(getNote(db, 999)).toBeNull();
  });
});

describe('updateNote', () => {
  it('部分更新并保留其余字段，updatedAt 增大而 createdAt 不变', () => {
    const paper = makePaper();
    const now = vi.spyOn(Date, 'now').mockReturnValue(1000);
    const note = createNote(db, makeNoteInput(paper.id, { tags: ['旧标签'] }));

    now.mockReturnValue(2000);
    const updated = updateNote(db, note.id, {
      title: '更新后的标题',
      contentMd: '更新后的内容。',
      tags: ['新标签', '中文'],
    });

    expect(updated).toMatchObject({
      id: note.id,
      paperId: paper.id,
      type: 'manual',
      title: '更新后的标题',
      contentMd: '更新后的内容。',
      tags: ['新标签', '中文'],
      createdAt: 1000,
    });
    expect(updated.updatedAt).toBe(2000);
    expect(getNote(db, note.id)).toEqual(updated);
  });

  it('空 patch 仍刷新 updatedAt 且其余字段不变', () => {
    const paper = makePaper();
    const now = vi.spyOn(Date, 'now').mockReturnValue(1000);
    const note = createNote(db, makeNoteInput(paper.id));

    now.mockReturnValue(2000);

    expect(updateNote(db, note.id, {})).toEqual({ ...note, updatedAt: 2000 });
  });

  it('不存在的 id 抛出 Note not found', () => {
    expect(() => updateNote(db, 999, { title: '不存在' })).toThrow(
      'Note not found: 999',
    );
  });
});

describe('deleteNote', () => {
  it('删除后 getNote 返回 null 且列表不再包含该笔记', () => {
    const paper = makePaper();
    const now = vi.spyOn(Date, 'now').mockReturnValue(1000);
    const keep = createNote(db, makeNoteInput(paper.id, { title: '保留' }));
    now.mockReturnValue(2000);
    const target = createNote(db, makeNoteInput(paper.id, { title: '待删除' }));

    deleteNote(db, target.id);

    expect(getNote(db, target.id)).toBeNull();
    expect(listNotes(db, paper.id)).toEqual([keep]);
    expect(listNotes(db)).toEqual([keep]);
  });

  it('不存在的 id 不抛错', () => {
    expect(() => deleteNote(db, 999)).not.toThrow();
  });
});
