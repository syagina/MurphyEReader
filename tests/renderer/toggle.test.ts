// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Paper } from '@shared/types';
import { resolveToggleTargetPage } from '@renderer/lib/toggle';
import { useReaderStore } from '@renderer/stores/reader';

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
    addedAt: 1000,
    lastReadAt: null,
    ...overrides,
  };
}

function installApi() {
  const get = vi.fn(async (_id: number): Promise<Paper | null> => makePaper());
  const load = vi.fn(
    async (
      _paperId: number,
      _version: 'original' | 'translated',
    ): Promise<{ data: ArrayBuffer; fileName: string }> => ({
      data: new ArrayBuffer(8),
      fileName: 'sample.pdf',
    }),
  );
  (window as unknown as { api: unknown }).api = { papers: { get }, pdf: { load } };
  return { get, load };
}

let api: ReturnType<typeof installApi>;

function resetStore(): void {
  useReaderStore.setState({
    paperId: null,
    version: 'original',
    pageCount: 0,
    currentPage: 1,
    zoom: 1,
    error: null,
    selection: null,
  });
}

beforeEach(() => {
  resetStore();
  api = installApi();
});

describe('resolveToggleTargetPage', () => {
  const base = {
    currentPage: 5,
    lastPageOriginal: 3,
    lastPageTranslated: 8,
    pageCountOriginal: 10,
    pageCountTranslated: 10,
  };

  it('两版页数相同时双向同步当前页码', () => {
    expect(resolveToggleTargetPage({ ...base, from: 'original', to: 'translated' })).toBe(5);
    expect(resolveToggleTargetPage({ ...base, from: 'translated', to: 'original' })).toBe(5);
  });

  it('页数不同时切到译本使用译本自己的上次页码', () => {
    expect(
      resolveToggleTargetPage({
        ...base,
        pageCountTranslated: 12,
        from: 'original',
        to: 'translated',
      }),
    ).toBe(8);
  });

  it('页数不同时切回原文使用原文自己的上次页码', () => {
    expect(
      resolveToggleTargetPage({
        ...base,
        pageCountTranslated: 12,
        from: 'translated',
        to: 'original',
      }),
    ).toBe(3);
  });

  it('当前页超出目标页数时被钳制', () => {
    expect(
      resolveToggleTargetPage({ ...base, currentPage: 15, from: 'original', to: 'translated' }),
    ).toBe(10);
    expect(
      resolveToggleTargetPage({ ...base, currentPage: 0, from: 'translated', to: 'original' }),
    ).toBe(1);
  });

  it('from 与 to 相同时返回钳制后的当前页', () => {
    expect(
      resolveToggleTargetPage({ ...base, currentPage: 12, from: 'original', to: 'original' }),
    ).toBe(10);
  });
});

describe('useReaderStore.setVersion', () => {
  it('切换到已绑定的译本时同步页码、保留缩放并加载译本 PDF', async () => {
    api.get.mockResolvedValue(
      makePaper({
        filePathTranslated: 'C:/papers/fem-zh.pdf',
        pageCountTranslated: 10,
        lastPageOriginal: 5,
        lastPageTranslated: 8,
      }),
    );

    await useReaderStore.getState().open(1);
    useReaderStore.getState().setZoom(1.5);
    useReaderStore.getState().setSelection({ text: '一段话', pageNo: 5 });

    await useReaderStore.getState().setVersion('translated');

    const state = useReaderStore.getState();
    expect(state.version).toBe('translated');
    expect(state.currentPage).toBe(5);
    expect(state.pageCount).toBe(10);
    expect(state.zoom).toBe(1.5);
    expect(state.selection).toBeNull();
    expect(state.error).toBeNull();
    expect(api.load).toHaveBeenCalledWith(1, 'translated');
  });

  it('未绑定译本时写入错误、保持原版本且不加载译本', async () => {
    await useReaderStore.getState().open(1);

    await useReaderStore.getState().setVersion('translated');

    const state = useReaderStore.getState();
    expect(state.error).toBe('未绑定译本');
    expect(state.version).toBe('original');
    expect(state.pageCount).toBe(10);
    expect(api.load).not.toHaveBeenCalledWith(1, 'translated');
  });

  it('译本加载失败时写入错误并保留原版本与页码', async () => {
    api.get.mockResolvedValue(
      makePaper({
        filePathTranslated: 'C:/papers/fem-zh.pdf',
        pageCountTranslated: 10,
        lastPageOriginal: 5,
      }),
    );
    await useReaderStore.getState().open(1);
    api.load.mockRejectedValueOnce(new Error('译本文件损坏'));

    await useReaderStore.getState().setVersion('translated');

    const state = useReaderStore.getState();
    expect(state.error).toBe('译本文件损坏');
    expect(state.version).toBe('original');
    expect(state.pageCount).toBe(10);
    expect(state.currentPage).toBe(5);
  });
});
