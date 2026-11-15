import { describe, expect, it } from 'vitest';
import type { Paper } from '@shared/types';
import type { FileStatus } from '@renderer/stores/library';
import {
  collectTags,
  filterAndSortPapers,
  isPaperMissing,
  libraryStats,
  readingProgress,
} from '@renderer/lib/library-view';

function makePaper(overrides: Partial<Paper> = {}): Paper {
  return {
    id: 1,
    title: '有限元方法导论',
    authors: '张三, 李四',
    year: 2020,
    filePathOriginal: 'C:/papers/fem.pdf',
    filePathTranslated: null,
    pageCountOriginal: 100,
    pageCountTranslated: null,
    hasTextLayer: true,
    outline: [],
    tags: [],
    lastPageOriginal: 1,
    lastPageTranslated: 1,
    addedAt: 1000,
    lastReadAt: null,
    ...overrides,
  };
}

const statuses: Record<number, FileStatus> = {
  1: { originalExists: true, translatedExists: false },
  2: { originalExists: false, translatedExists: false },
  3: { originalExists: true, translatedExists: true },
};

const papers = [
  makePaper({
    id: 1,
    title: 'Alpha',
    authors: '张三',
    year: 2020,
    tags: ['fem', '结构'],
    lastPageOriginal: 50,
    addedAt: 300,
    lastReadAt: 100,
  }),
  makePaper({
    id: 2,
    title: 'Beta',
    authors: '李四',
    year: 2022,
    tags: ['fem'],
    filePathOriginal: 'C:/papers/missing.pdf',
    addedAt: 200,
    lastReadAt: null,
  }),
  makePaper({
    id: 3,
    title: 'Gamma',
    authors: '王五',
    year: null,
    tags: ['优化'],
    filePathTranslated: 'C:/papers/gamma-zh.pdf',
    pageCountTranslated: 120,
    addedAt: 100,
    lastReadAt: 300,
  }),
];

const baseQuery = { text: '', tag: null, filter: 'all' as const, sort: 'added' as const };

describe('filterAndSortPapers', () => {
  it('按最近添加排序', () => {
    expect(filterAndSortPapers(papers, statuses, baseQuery).map((paper) => paper.id)).toEqual([
      1, 2, 3,
    ]);
  });

  it('按最近阅读排序，未读排最后', () => {
    expect(
      filterAndSortPapers(papers, statuses, { ...baseQuery, sort: 'lastRead' }).map(
        (paper) => paper.id,
      ),
    ).toEqual([3, 1, 2]);
  });

  it('按标题和年份排序', () => {
    expect(
      filterAndSortPapers(papers, statuses, { ...baseQuery, sort: 'title' }).map(
        (paper) => paper.id,
      ),
    ).toEqual([1, 2, 3]);
    expect(
      filterAndSortPapers(papers, statuses, { ...baseQuery, sort: 'year' }).map(
        (paper) => paper.id,
      ),
    ).toEqual([2, 1, 3]);
  });

  it('搜索标题、作者和标签，不区分大小写', () => {
    expect(
      filterAndSortPapers(papers, statuses, { ...baseQuery, text: 'alpha' }).map(
        (paper) => paper.id,
      ),
    ).toEqual([1]);
    expect(
      filterAndSortPapers(papers, statuses, { ...baseQuery, text: '李四' }).map(
        (paper) => paper.id,
      ),
    ).toEqual([2]);
    expect(
      filterAndSortPapers(papers, statuses, { ...baseQuery, text: '优化' }).map(
        (paper) => paper.id,
      ),
    ).toEqual([3]);
  });

  it('按标签、状态过滤', () => {
    expect(
      filterAndSortPapers(papers, statuses, { ...baseQuery, tag: 'fem' }).map(
        (paper) => paper.id,
      ),
    ).toEqual([1, 2]);
    expect(
      filterAndSortPapers(papers, statuses, { ...baseQuery, filter: 'translated' }).map(
        (paper) => paper.id,
      ),
    ).toEqual([3]);
    expect(
      filterAndSortPapers(papers, statuses, { ...baseQuery, filter: 'missing' }).map(
        (paper) => paper.id,
      ),
    ).toEqual([2]);
    expect(
      filterAndSortPapers(papers, statuses, { ...baseQuery, filter: 'unread' }).map(
        (paper) => paper.id,
      ),
    ).toEqual([2]);
  });
});

describe('library helpers', () => {
  it('识别文件缺失与阅读进度', () => {
    expect(isPaperMissing(papers[0], statuses[1])).toBe(false);
    expect(isPaperMissing(papers[1], statuses[2])).toBe(true);
    expect(isPaperMissing(papers[2], undefined)).toBe(false);
    expect(readingProgress(papers[0])).toBe(50);
    expect(readingProgress(makePaper({ lastPageOriginal: 200 }))).toBe(100);
    expect(readingProgress(makePaper({ pageCountOriginal: 0 }))).toBe(0);
  });

  it('汇总标签并统计文献状态', () => {
    expect(collectTags(papers)).toEqual([
      { tag: 'fem', count: 2 },
      { tag: '结构', count: 1 },
      { tag: '优化', count: 1 },
    ]);
    expect(libraryStats(papers, statuses)).toEqual({
      total: 3,
      unread: 1,
      translated: 1,
      missing: 1,
    });
  });
});
