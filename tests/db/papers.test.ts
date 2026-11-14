import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '@main/db';
import {
  createPaper,
  deletePaper,
  getPaper,
  listPapers,
  markRead,
  updatePaper,
} from '@main/db/papers';
import type { NewPaperInput } from '@main/db/papers';
import type { OutlineNode } from '@shared/types';

const sampleOutline: OutlineNode[] = [
  {
    title: '第一章 绪论',
    pageNo: 1,
    children: [{ title: '1.1 研究背景', pageNo: 2, children: [] }],
  },
  { title: '第二章 方法', pageNo: 10, children: [] },
];

function makeInput(overrides: Partial<NewPaperInput> = {}): NewPaperInput {
  return {
    title: '有限元方法导论',
    authors: '张三, 李四',
    year: 2020,
    filePathOriginal: 'C:/papers/fem-intro.pdf',
    filePathTranslated: null,
    pageCountOriginal: 120,
    pageCountTranslated: null,
    hasTextLayer: true,
    outline: sampleOutline,
    ...overrides,
  };
}

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
  db.close();
  rmSync(tempDir, { recursive: true, force: true });
});

describe('createPaper', () => {
  it('创建后返回映射完整的 Paper 并写入默认值', () => {
    const before = Date.now();
    const paper = createPaper(db, makeInput());
    const after = Date.now();

    expect(paper).toMatchObject({
      title: '有限元方法导论',
      authors: '张三, 李四',
      year: 2020,
      filePathOriginal: 'C:/papers/fem-intro.pdf',
      filePathTranslated: null,
      pageCountOriginal: 120,
      pageCountTranslated: null,
      hasTextLayer: true,
      outline: sampleOutline,
      tags: [],
      lastPageOriginal: 1,
      lastPageTranslated: 1,
      lastReadAt: null,
    });
    expect(paper.id).toBeGreaterThan(0);
    expect(paper.addedAt).toBeGreaterThanOrEqual(before);
    expect(paper.addedAt).toBeLessThanOrEqual(after);
  });

  it('可空字段与 false 布尔值原样映射', () => {
    const paper = createPaper(
      db,
      makeInput({
        year: null,
        filePathTranslated: 'C:/papers/fem-intro-zh.pdf',
        pageCountTranslated: 130,
        hasTextLayer: false,
        outline: [],
      }),
    );

    expect(paper.year).toBeNull();
    expect(paper.filePathTranslated).toBe('C:/papers/fem-intro-zh.pdf');
    expect(paper.pageCountTranslated).toBe(130);
    expect(paper.hasTextLayer).toBe(false);
    expect(paper.outline).toEqual([]);
  });

  it('outline 经 JSON 入库后读回深等于输入', () => {
    const { id } = createPaper(db, makeInput());

    expect(getPaper(db, id)?.outline).toEqual(sampleOutline);
  });
});

describe('getPaper', () => {
  it('不存在的 id 返回 null', () => {
    expect(getPaper(db, 999)).toBeNull();
  });
});

describe('listPapers', () => {
  it('按添加时间倒序返回全部文献且字段映射完整', () => {
    const first = createPaper(db, makeInput({ title: '第一篇' }));
    const second = createPaper(db, makeInput({ title: '第二篇', outline: [] }));

    expect(listPapers(db)).toEqual([getPaper(db, second.id), getPaper(db, first.id)]);
  });
});

describe('updatePaper', () => {
  it('支持部分字段更新并保留其余字段', () => {
    const { id } = createPaper(db, makeInput());

    const updated = updatePaper(db, id, { title: '有限元方法：理论与实践', year: 2021, hasTextLayer: false });

    expect(updated).toMatchObject({
      id,
      title: '有限元方法：理论与实践',
      year: 2021,
      hasTextLayer: false,
      authors: '张三, 李四',
      filePathOriginal: 'C:/papers/fem-intro.pdf',
    });
    expect(getPaper(db, id)).toEqual(updated);
  });

  it('更新 tags 后读回一致', () => {
    const { id } = createPaper(db, makeInput());

    updatePaper(db, id, { tags: ['综述'] });

    expect(getPaper(db, id)?.tags).toEqual(['综述']);
  });

  it('更新 outline 经 JSON 往返保持深相等', () => {
    const { id } = createPaper(db, makeInput());
    const nextOutline: OutlineNode[] = [
      { title: '唯一章节', pageNo: null, children: [] },
    ];

    const updated = updatePaper(db, id, { outline: nextOutline });

    expect(updated.outline).toEqual(nextOutline);
    expect(getPaper(db, id)?.outline).toEqual(nextOutline);
  });

  it('空 patch 原样返回当前值', () => {
    const { id } = createPaper(db, makeInput());
    const current = getPaper(db, id);

    expect(current).not.toBeNull();
    expect(updatePaper(db, id, {})).toEqual(current);
    expect(getPaper(db, id)).toEqual(current);
  });

  it('不存在的 id 抛出 Paper not found', () => {
    expect(() => updatePaper(db, 999, { title: '不存在' })).toThrow('Paper not found: 999');
  });
});

describe('deletePaper', () => {
  it('删除后 getPaper 返回 null 且列表为空', () => {
    const { id } = createPaper(db, makeInput());

    deletePaper(db, id);

    expect(getPaper(db, id)).toBeNull();
    expect(listPapers(db)).toEqual([]);
  });

  it('删除不存在的 id 不抛错', () => {
    expect(() => deletePaper(db, 999)).not.toThrow();
  });
});

describe('markRead', () => {
  it('markRead translated 更新译本页码与 lastReadAt', () => {
    const before = Date.now();
    const { id } = createPaper(db, makeInput());

    markRead(db, id, 'translated', 7);

    const paper = getPaper(db, id);
    expect(paper?.lastPageTranslated).toBe(7);
    expect(paper?.lastPageOriginal).toBe(1);
    expect(paper?.lastReadAt).not.toBeNull();
    expect(paper?.lastReadAt).toBeGreaterThanOrEqual(before);
  });

  it('markRead original 只更新原文页码', () => {
    const { id } = createPaper(db, makeInput());

    markRead(db, id, 'original', 3);

    const paper = getPaper(db, id);
    expect(paper?.lastPageOriginal).toBe(3);
    expect(paper?.lastPageTranslated).toBe(1);
    expect(paper?.lastReadAt).not.toBeNull();
  });

  it('markRead 不存在的 id 不抛错', () => {
    expect(() => markRead(db, 999, 'original', 2)).not.toThrow();
  });
});
