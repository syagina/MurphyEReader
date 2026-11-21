import { describe, expect, it } from 'vitest';
import { resolveTogglePosition } from '@renderer/lib/toggle';

describe('resolveTogglePosition', () => {
  it('页数相同时原样保留页码和页内偏移', () => {
    expect(
      resolveTogglePosition({
        from: 'original',
        to: 'translated',
        position: { page: 5, offset: 0.5 },
        fromPageCount: 10,
        toPageCount: 10,
      }),
    ).toEqual({ page: 5, offset: 0.5 });

    expect(
      resolveTogglePosition({
        from: 'translated',
        to: 'original',
        position: { page: 5, offset: 0.5 },
        fromPageCount: 10,
        toPageCount: 10,
      }),
    ).toEqual({ page: 5, offset: 0.5 });
  });

  it('页数不同时按源文档的阅读进度映射到目标文档', () => {
    // (8 - 1 + 0.5) / 20 = 0.375 → 3.75 in 10 pages.
    expect(
      resolveTogglePosition({
        from: 'original',
        to: 'translated',
        position: { page: 8, offset: 0.5 },
        fromPageCount: 20,
        toPageCount: 10,
      }),
    ).toEqual({ page: 4, offset: 0.75 });

    // (5 - 1 + 0.5) / 10 = 0.45 → 9 in 20 pages.
    expect(
      resolveTogglePosition({
        from: 'original',
        to: 'translated',
        position: { page: 5, offset: 0.5 },
        fromPageCount: 10,
        toPageCount: 20,
      }),
    ).toEqual({ page: 10, offset: 0 });
  });

  it('不使用目标版本自己的历史页码', () => {
    // `resolveTogglePosition` has no historical-page inputs at all: the only
    // possible output is a function of the live source position.
    expect(
      resolveTogglePosition({
        from: 'original',
        to: 'bilingual',
        position: { page: 2, offset: 0.25 },
        fromPageCount: 10,
        toPageCount: 10,
      }),
    ).toEqual({ page: 2, offset: 0.25 });
  });

  it('页数无效时回到第 1 页顶部', () => {
    expect(
      resolveTogglePosition({
        from: 'original',
        to: 'translated',
        position: { page: 5, offset: 0.5 },
        fromPageCount: 0,
        toPageCount: 10,
      }),
    ).toEqual({ page: 1, offset: 0 });

    expect(
      resolveTogglePosition({
        from: 'original',
        to: 'translated',
        position: { page: 5, offset: 0.5 },
        fromPageCount: -3,
        toPageCount: 10,
      }),
    ).toEqual({ page: 1, offset: 0 });

    expect(
      resolveTogglePosition({
        from: 'original',
        to: 'translated',
        position: { page: 5, offset: 0.5 },
        fromPageCount: 10,
        toPageCount: 0,
      }),
    ).toEqual({ page: 1, offset: 0 });
  });

  it('from 与 to 相同时把位置钳制到目标页数与合法偏移', () => {
    expect(
      resolveTogglePosition({
        from: 'original',
        to: 'original',
        position: { page: 12, offset: 1.5 },
        fromPageCount: 10,
        toPageCount: 10,
      }),
    ).toEqual({ page: 10, offset: 0.999999 });
  });
});
