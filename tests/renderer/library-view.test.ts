import { describe, expect, it } from 'vitest';
import type { Paper } from '@shared/types';
import type { FileStatus } from '@renderer/stores/library';
import {
  collectTags,
  countByFolder,
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
    folderId: null,
    storageDir: null,
    fileHash: null,
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

const baseQuery = {
  text: '',
  tag: null,
  filter: 'all' as const,
  sort: 'added' as const,
  folderId: 'all' as const,
};

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

describe('folder filtering and counts', () => {
  const withFolders = [
    makePaper({ id: 1, folderId: 1 }),
    makePaper({ id: 2, folderId: null }),
    makePaper({ id: 3, folderId: 2 }),
  ];

  it('按文件夹 id、未分类与全部过滤', () => {
    expect(
      filterAndSortPapers(withFolders, {}, { ...baseQuery, folderId: 1 }).map((p) => p.id),
    ).toEqual([1]);
    expect(
      filterAndSortPapers(withFolders, {}, { ...baseQuery, folderId: 'none' }).map((p) => p.id),
    ).toEqual([2]);
    expect(filterAndSortPapers(withFolders, {}, { ...baseQuery, folderId: 'all' })).toHaveLength(3);
  });

  it('文件夹过滤在标签与状态过滤之后应用', () => {
    const mixed = [
      makePaper({ id: 1, folderId: 1, tags: ['fem'], lastReadAt: null }),
      makePaper({ id: 2, folderId: 1, tags: ['fem'], lastReadAt: 10 }),
      makePaper({ id: 3, folderId: 2, tags: ['fem'], lastReadAt: null }),
      makePaper({ id: 4, folderId: 1, tags: ['优化'], lastReadAt: null }),
    ];

    expect(
      filterAndSortPapers(mixed, {}, {
        ...baseQuery,
        folderId: 1,
        tag: 'fem',
        filter: 'unread',
      }).map((paper) => paper.id),
    ).toEqual([1]);
  });

  it('统计全部、未分类与各文件夹数量', () => {
    expect(countByFolder(withFolders)).toEqual({ all: 3, none: 1, byId: { 1: 1, 2: 1 } });
  });

  it('旧数据缺少 folderId 时视为未分类', () => {
    const legacy = [
      makePaper({ id: 4, folderId: undefined, addedAt: 2000 }),
      makePaper({ id: 5, folderId: null, addedAt: 1000 }),
    ];

    expect(
      filterAndSortPapers(legacy, {}, { ...baseQuery, folderId: 'none' }).map((p) => p.id),
    ).toEqual([4, 5]);
    expect(countByFolder(legacy)).toEqual({ all: 2, none: 2, byId: {} });
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
