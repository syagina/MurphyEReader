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
    folderId: null,
    storageDir: null,
    fileHash: null,
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

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Lets pending promise continuations (and their awaited IPC calls) run. */
async function flushAsync(): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

function resetStore(): void {
  useReaderStore.setState({
    paperId: null,
    version: 'original',
    pageCount: 0,
    currentPage: 1,
    zoom: 1,
    error: null,
    selection: null,
    failedVersion: null,
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
        lastPageOriginal: 3,
        lastPageTranslated: 8,
      }),
    );

    await useReaderStore.getState().open(1);
    // Distinct from both lastPageOriginal (3) and lastPageTranslated (8), so
    // only the same-count sync rule can produce the expected page.
    useReaderStore.getState().setCurrentPage(5);
    useReaderStore.getState().setZoom(1.5);
    useReaderStore.getState().setSelection({
      text: '一段话',
      pageNo: 5,
      version: 'original',
      rects: [{ x: 0.1, y: 0.2, width: 0.3, height: 0.04 }],
    });

    await useReaderStore.getState().setVersion('translated');

    const state = useReaderStore.getState();
    expect(state.version).toBe('translated');
    expect(state.currentPage).toBe(5);
    expect(state.pageCount).toBe(10);
    expect(state.zoom).toBe(1.5);
    expect(state.selection).toBeNull();
    expect(state.error).toBeNull();
    expect(state.failedVersion).toBeNull();
    expect(api.load).toHaveBeenCalledWith(1, 'translated');
  });

  it('未绑定译本时写入错误、保持原版本且不加载译本', async () => {
    await useReaderStore.getState().open(1);

    await useReaderStore.getState().setVersion('translated');

    const state = useReaderStore.getState();
    expect(state.error).toBe('未绑定译本');
    expect(state.failedVersion).toBe('translated');
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
    expect(state.failedVersion).toBe('translated');
    expect(state.version).toBe('original');
    expect(state.pageCount).toBe(10);
    expect(state.currentPage).toBe(5);
  });

  it('被 open 取代的 setVersion 不会写入旧会话', async () => {
    api.get.mockResolvedValue(makePaper({ lastPageOriginal: 4 }));
    await useReaderStore.getState().open(1);

    const pending = deferred<Paper | null>();
    api.get.mockImplementationOnce(() => pending.promise);
    const switching = useReaderStore.getState().setVersion('translated');
    await flushAsync();

    // A new open supersedes the switch while its metadata lookup is pending.
    await useReaderStore.getState().open(1);
    pending.resolve(
      makePaper({ filePathTranslated: 'C:/papers/fem-zh.pdf', pageCountTranslated: 10 }),
    );
    await switching;

    const state = useReaderStore.getState();
    expect(state.version).toBe('original');
    expect(state.currentPage).toBe(4);
    expect(state.pageCount).toBe(10);
    expect(state.error).toBeNull();
    expect(state.failedVersion).toBeNull();
    expect(api.load).not.toHaveBeenCalledWith(1, 'translated');
  });

  it('校验读取期间滚动到的新页码不会被切换覆盖', async () => {
    api.get.mockResolvedValue(
      makePaper({
        filePathTranslated: 'C:/papers/fem-zh.pdf',
        pageCountTranslated: 10,
        lastPageOriginal: 3,
        lastPageTranslated: 8,
      }),
    );
    await useReaderStore.getState().open(1);

    const validating = deferred<{ data: ArrayBuffer; fileName: string }>();
    api.load.mockImplementationOnce(() => validating.promise);
    const switching = useReaderStore.getState().setVersion('translated');
    await flushAsync();
    useReaderStore.getState().setCurrentPage(7);
    validating.resolve({ data: new ArrayBuffer(8), fileName: 'fem-zh.pdf' });
    await switching;

    const state = useReaderStore.getState();
    expect(state.version).toBe('translated');
    expect(state.currentPage).toBe(7);
  });

  it('setError 按当前版本记录失败版本并在清除时重置', () => {
    useReaderStore.setState({ paperId: 1, version: 'translated', pageCount: 10, currentPage: 3 });

    useReaderStore.getState().setError('无法渲染');

    expect(useReaderStore.getState().failedVersion).toBe('translated');
    useReaderStore.getState().setError(null);
    expect(useReaderStore.getState().failedVersion).toBeNull();
    expect(useReaderStore.getState().error).toBeNull();
  });
});
