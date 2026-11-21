import { describe, expect, it } from 'vitest';
import type { Paper } from '@shared/types';
import {
  MAX_READING_OFFSET,
  clampOffset,
  mapReadingPosition,
  pageCountFor,
  positionAt,
  positionFromGeometry,
} from '@renderer/lib/reading-position';

describe('mapReadingPosition', () => {
  it('页数相同时原样返回页码与偏移', () => {
    expect(
      mapReadingPosition({ page: 8, offset: 0.5 }, 20, 20),
    ).toEqual({ page: 8, offset: 0.5 });
    expect(
      mapReadingPosition({ page: 1, offset: 0 }, 13, 13),
    ).toEqual({ page: 1, offset: 0 });
  });

  it('页数不同时按整篇进度映射', () => {
    // (8 - 1 + 0.5) / 20 = 0.375 → 3.75 in 10 pages.
    expect(
      mapReadingPosition({ page: 8, offset: 0.5 }, 20, 10),
    ).toEqual({ page: 4, offset: 0.75 });

    // (5 - 1 + 0.5) / 10 = 0.45 → 9 in 20 pages.
    expect(
      mapReadingPosition({ page: 5, offset: 0.5 }, 10, 20),
    ).toEqual({ page: 10, offset: 0 });
  });

  it('正好落在页边界时给出下一页顶部', () => {
    expect(
      mapReadingPosition({ page: 2, offset: 0 }, 4, 8),
    ).toEqual({ page: 3, offset: 0 });
  });

  it('末页末尾映射到目标末页的最大偏移附近', () => {
    const mapped = mapReadingPosition(
      { page: 10, offset: MAX_READING_OFFSET },
      10,
      20,
    );
    expect(mapped.page).toBe(20);
    expect(mapped.offset).toBeCloseTo(0.999998, 6);
  });

  it('页数非正时返回第 1 页顶部', () => {
    expect(mapReadingPosition({ page: 5, offset: 0.5 }, 0, 10)).toEqual({
      page: 1,
      offset: 0,
    });
    expect(mapReadingPosition({ page: 5, offset: 0.5 }, -3, 10)).toEqual({
      page: 1,
      offset: 0,
    });
    expect(mapReadingPosition({ page: 5, offset: 0.5 }, 10, 0)).toEqual({
      page: 1,
      offset: 0,
    });
  });

  it('映射前先钳制源位置', () => {
    expect(mapReadingPosition({ page: 99, offset: 1 }, 10, 10)).toEqual({
      page: 10,
      offset: MAX_READING_OFFSET,
    });
  });
});

describe('positionAt', () => {
  it('同时钳制页码与偏移', () => {
    expect(positionAt(0, -1, 10)).toEqual({ page: 1, offset: 0 });
    expect(positionAt(99, 2, 10)).toEqual({
      page: 10,
      offset: MAX_READING_OFFSET,
    });
    expect(positionAt(5.4, 0.25, 10)).toEqual({ page: 5, offset: 0.25 });
  });

  it('空文档返回第 1 页顶部', () => {
    expect(positionAt(5, 0.5, 0)).toEqual({ page: 1, offset: 0 });
  });

  it('非有限输入得到安全值', () => {
    expect(positionAt(Number.NaN, Number.NaN, 10)).toEqual({
      page: 1,
      offset: 0,
    });
  });
});

describe('clampOffset', () => {
  it('把偏移限制在合法区间', () => {
    expect(clampOffset(-0.5)).toBe(0);
    expect(clampOffset(0.25)).toBe(0.25);
    expect(clampOffset(1)).toBe(MAX_READING_OFFSET);
    // Non-finite values carry no position information and fall back to 0.
    expect(clampOffset(Number.POSITIVE_INFINITY)).toBe(0);
    expect(clampOffset(Number.NaN)).toBe(0);
  });
});

describe('pageCountFor', () => {
  const paper = {
    pageCountOriginal: 10,
    pageCountTranslated: 12,
    pageCountBilingual: 24,
  };

  it('按版本选择页数', () => {
    expect(pageCountFor(paper, 'original')).toBe(10);
    expect(pageCountFor(paper, 'translated')).toBe(12);
    expect(pageCountFor(paper, 'bilingual')).toBe(24);
  });

  it('中英对照页数未知时退回译本页数', () => {
    expect(
      pageCountFor(
        {
          pageCountOriginal: 10,
          pageCountTranslated: 12,
          pageCountBilingual: null,
        },
        'bilingual',
      ),
    ).toBe(12);
  });

  it('译本未绑定时返回 0', () => {
    const unbound: Pick<
      Paper,
      'pageCountOriginal' | 'pageCountTranslated' | 'pageCountBilingual'
    > = {
      pageCountOriginal: 10,
      pageCountTranslated: null,
      pageCountBilingual: null,
    };
    expect(pageCountFor(unbound, 'translated')).toBe(0);
    expect(pageCountFor(unbound, 'bilingual')).toBe(0);
  });
});

describe('positionFromGeometry', () => {
  const geometry = [
    { page: 1, top: 0, height: 100 },
    { page: 2, top: 120, height: 100 },
    { page: 3, top: 240, height: 100 },
  ];

  it('没有页面时返回第 1 页顶部', () => {
    expect(positionFromGeometry([], 50)).toEqual({ page: 1, offset: 0 });
  });

  it('第一页顶部之前属于第 1 页顶部', () => {
    expect(
      positionFromGeometry([{ page: 1, top: 50, height: 100 }], 10),
    ).toEqual({ page: 1, offset: 0 });
  });

  it('页面内部按高度计算偏移', () => {
    expect(positionFromGeometry(geometry, 0)).toEqual({ page: 1, offset: 0 });
    expect(positionFromGeometry(geometry, 50)).toEqual({
      page: 1,
      offset: 0.5,
    });
    expect(positionFromGeometry(geometry, 150)).toEqual({
      page: 2,
      offset: 0.3,
    });
  });

  it('页面之间的空隙属于下一页顶部', () => {
    expect(positionFromGeometry(geometry, 100)).toEqual({
      page: 2,
      offset: 0,
    });
    expect(positionFromGeometry(geometry, 115)).toEqual({
      page: 2,
      offset: 0,
    });
  });

  it('最后一页底部之后保留在末页最大偏移', () => {
    expect(positionFromGeometry(geometry, 340)).toEqual({
      page: 3,
      offset: MAX_READING_OFFSET,
    });
    expect(positionFromGeometry(geometry, 9999)).toEqual({
      page: 3,
      offset: MAX_READING_OFFSET,
    });
  });

  it('非法滚动值按顶部处理', () => {
    expect(positionFromGeometry(geometry, Number.NaN)).toEqual({
      page: 1,
      offset: 0,
    });
    expect(positionFromGeometry(geometry, -20)).toEqual({
      page: 1,
      offset: 0,
    });
  });
});
