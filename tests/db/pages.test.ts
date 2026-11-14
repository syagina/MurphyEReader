import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '@main/db';
import { createPaper } from '@main/db/papers';
import { getFullText, getPageText, getPages, replacePages } from '@main/db/pages';
import type { PageText } from '@shared/types';

const samplePages: PageText[] = [
  { pageNo: 1, text: '第一页：有限元方法的弱形式与逼近空间。' },
  { pageNo: 2, text: '第二页：数值积分与误差估计。' },
];

let tempDir: string;
let db: Database.Database;
let paperId: number;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'paperlens-'));
  db = openDb(join(tempDir, 'paperlens.db'));
  paperId = createPaper(db, {
    title: '有限元方法导论',
    authors: '张三',
    year: 2020,
    filePathOriginal: 'C:/papers/fem-intro.pdf',
    filePathTranslated: null,
    pageCountOriginal: 2,
    pageCountTranslated: null,
    hasTextLayer: true,
    outline: [],
  }).id;
});

afterEach(() => {
  db.close();
  rmSync(tempDir, { recursive: true, force: true });
});

describe('replacePages', () => {
  it('写入页文本后按页码升序返回 PaperPage', () => {
    replacePages(db, paperId, [samplePages[1], samplePages[0]]);

    expect(getPages(db, paperId)).toEqual([
      { paperId, pageNo: 1, text: samplePages[0].text },
      { paperId, pageNo: 2, text: samplePages[1].text },
    ]);
  });

  it('二次调用替换旧页，页数正确且旧文本不残留', () => {
    replacePages(db, paperId, samplePages);

    replacePages(db, paperId, [
      { pageNo: 1, text: '新版第一页' },
      { pageNo: 2, text: '新版第二页' },
      { pageNo: 3, text: '新版第三页' },
    ]);

    const pages = getPages(db, paperId);
    expect(pages).toHaveLength(3);
    expect(pages.map((page) => page.text)).toEqual(['新版第一页', '新版第二页', '新版第三页']);
    expect(pages.some((page) => page.text.includes('有限元'))).toBe(false);
  });

  it('传入空数组时清空该论文的全部页', () => {
    replacePages(db, paperId, samplePages);

    replacePages(db, paperId, []);

    expect(getPages(db, paperId)).toEqual([]);
  });

  it('不同论文的页互不影响', () => {
    const otherId = createPaper(db, {
      title: '另一篇',
      authors: '',
      year: null,
      filePathOriginal: 'C:/papers/other.pdf',
      filePathTranslated: null,
      pageCountOriginal: 1,
      pageCountTranslated: null,
      hasTextLayer: true,
      outline: [],
    }).id;

    replacePages(db, paperId, samplePages);
    replacePages(db, otherId, [{ pageNo: 1, text: '另一篇的正文' }]);
    replacePages(db, otherId, []);

    expect(getPages(db, paperId)).toHaveLength(2);
    expect(getPageText(db, paperId, 1)).toBe(samplePages[0].text);
  });
});

describe('getPages', () => {
  it('不存在的论文返回空数组', () => {
    expect(getPages(db, 999)).toEqual([]);
  });
});

describe('getPageText', () => {
  it('命中时返回该页文本', () => {
    replacePages(db, paperId, samplePages);

    expect(getPageText(db, paperId, 2)).toBe(samplePages[1].text);
  });

  it('页码未命中时返回 null', () => {
    replacePages(db, paperId, samplePages);

    expect(getPageText(db, paperId, 3)).toBeNull();
  });

  it('论文不存在时返回 null', () => {
    expect(getPageText(db, 999, 1)).toBeNull();
  });
});

describe('getFullText', () => {
  it('按 [第 n 页] 标记顺序拼接全部页文本', () => {
    replacePages(db, paperId, samplePages);

    const fullText = getFullText(db, paperId);

    expect(fullText).toBe(`[第 1 页]\n${samplePages[0].text}\n\n[第 2 页]\n${samplePages[1].text}`);
    expect(fullText).toContain('[第 1 页]');
    expect(fullText).toContain('[第 2 页]');
  });

  it('没有页时返回空字符串', () => {
    expect(getFullText(db, paperId)).toBe('');
  });
});
