// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Paper } from '@shared/types';
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
    failedVersion: null,
  });
}

beforeEach(() => {
  resetStore();
  api = installApi();
});

describe('useReaderStore.open', () => {
  it('文件加载失败时保留 paperId 并写入错误', async () => {
    api.load.mockRejectedValue(new Error('文件不存在: x'));

    await useReaderStore.getState().open(1);

    const state = useReaderStore.getState();
    expect(state.paperId).toBe(1);
    expect(state.error).toBe('文件不存在: x');
    expect(state.failedVersion).toBe('original');
    expect(state.pageCount).toBe(10);
  });

  it('成功时恢复上次页码与原文页数', async () => {
    api.get.mockResolvedValue(makePaper({ pageCountOriginal: 10, lastPageOriginal: 3 }));

    await useReaderStore.getState().open(1);

    const state = useReaderStore.getState();
    expect(api.get).toHaveBeenCalledWith(1);
    expect(api.load).toHaveBeenCalledWith(1, 'original');
    expect(state.currentPage).toBe(3);
    expect(state.error).toBeNull();
    expect(state.version).toBe('original');
    expect(state.pageCount).toBe(10);
  });

  it('恢复的页码超过总页数时被钳制', async () => {
    api.get.mockResolvedValue(makePaper({ pageCountOriginal: 10, lastPageOriginal: 99 }));

    await useReaderStore.getState().open(1);

    expect(useReaderStore.getState().currentPage).toBe(10);
  });

  it('传入初始页码时优先于上次阅读页码', async () => {
    api.get.mockResolvedValue(makePaper({ pageCountOriginal: 10, lastPageOriginal: 3 }));

    await useReaderStore.getState().open(1, 6);

    expect(useReaderStore.getState().currentPage).toBe(6);
  });

  it('初始页码按总页数钳制', async () => {
    api.get.mockResolvedValue(makePaper({ pageCountOriginal: 10, lastPageOriginal: 3 }));

    await useReaderStore.getState().open(1, 99);
    expect(useReaderStore.getState().currentPage).toBe(10);

    await useReaderStore.getState().open(1, 0);
    expect(useReaderStore.getState().currentPage).toBe(1);

    await useReaderStore.getState().open(1, Number.NaN);
    expect(useReaderStore.getState().currentPage).toBe(1);
  });

  it('文献不存在时写入错误并保留 paperId', async () => {
    api.get.mockResolvedValue(null);

    await useReaderStore.getState().open(7);

    const state = useReaderStore.getState();
    expect(state.paperId).toBe(7);
    expect(state.error).toBe('文献不存在: 7');
    expect(state.failedVersion).toBeNull();
  });

  it('close 使在途 open 失效', async () => {
    const pending = deferred<Paper | null>();
    api.get.mockImplementation(() => pending.promise);

    const opening = useReaderStore.getState().open(1);
    useReaderStore.getState().close();
    pending.resolve(makePaper({ lastPageOriginal: 5 }));
    await opening;

    const state = useReaderStore.getState();
    expect(state.paperId).toBeNull();
    expect(state.pageCount).toBe(0);
    expect(state.currentPage).toBe(1);
    expect(state.error).toBeNull();
    expect(api.load).not.toHaveBeenCalled();
  });

  it('晚到的旧 open 元数据不会覆盖新的阅读会话', async () => {
    const paperA = makePaper({ id: 1, pageCountOriginal: 10, lastPageOriginal: 4 });
    const paperB = makePaper({ id: 2, pageCountOriginal: 20, lastPageOriginal: 7 });
    const getA = deferred<Paper | null>();
    const getB = deferred<Paper | null>();
    const loadB = deferred<{ data: ArrayBuffer; fileName: string }>();
    api.get.mockImplementation((id) => (id === 1 ? getA.promise : getB.promise));
    api.load.mockImplementation((id) =>
      id === 1 ? Promise.reject(new Error('文件不存在: 1')) : loadB.promise,
    );

    const openA = useReaderStore.getState().open(1);
    const openB = useReaderStore.getState().open(2);
    getB.resolve(paperB);
    await flushAsync();
    loadB.resolve({ data: new ArrayBuffer(8), fileName: 'b.pdf' });
    await openB;

    expect(useReaderStore.getState().paperId).toBe(2);
    expect(useReaderStore.getState().error).toBeNull();

    // A's metadata only arrives after B has fully opened and must be ignored.
    getA.resolve(paperA);
    await openA;

    const state = useReaderStore.getState();
    expect(state.paperId).toBe(2);
    expect(state.pageCount).toBe(20);
    expect(state.currentPage).toBe(7);
    expect(state.error).toBeNull();
    // The superseded session stops before doing its validation read.
    expect(api.load).not.toHaveBeenCalledWith(1, 'original');
  });

  it('晚到的旧 pdf.load 失败不会污染新会话', async () => {
    const paperA = makePaper({ id: 1, pageCountOriginal: 10, lastPageOriginal: 4 });
    const paperB = makePaper({ id: 2, pageCountOriginal: 20, lastPageOriginal: 7 });
    const getA = deferred<Paper | null>();
    const loadA = deferred<{ data: ArrayBuffer; fileName: string }>();
    const getB = deferred<Paper | null>();
    const loadB = deferred<{ data: ArrayBuffer; fileName: string }>();
    api.get.mockImplementation((id) => (id === 1 ? getA.promise : getB.promise));
    api.load.mockImplementation((id) => (id === 1 ? loadA.promise : loadB.promise));

    const openA = useReaderStore.getState().open(1);
    getA.resolve(paperA);
    await flushAsync(); // A restores its metadata and starts its validation read.

    const openB = useReaderStore.getState().open(2);
    getB.resolve(paperB);
    await flushAsync();
    loadB.resolve({ data: new ArrayBuffer(8), fileName: 'b.pdf' });
    await openB;

    loadA.reject(new Error('文件不存在: 1'));
    await openA;

    const state = useReaderStore.getState();
    expect(api.load).toHaveBeenCalledWith(1, 'original');
    expect(state.paperId).toBe(2);
    expect(state.pageCount).toBe(20);
    expect(state.currentPage).toBe(7);
    expect(state.error).toBeNull();
  });
});

describe('useReaderStore 边界控制', () => {
  beforeEach(() => {
    useReaderStore.setState({ pageCount: 10, paperId: 1 });
  });

  it('jumpToPage 与 setCurrentPage 按总页数钳制', () => {
    useReaderStore.getState().jumpToPage(99);
    expect(useReaderStore.getState().currentPage).toBe(10);

    useReaderStore.getState().setCurrentPage(0);
    expect(useReaderStore.getState().currentPage).toBe(1);
  });

  it('setZoom 钳制在 0.5 到 3 之间', () => {
    useReaderStore.getState().setZoom(9);
    expect(useReaderStore.getState().zoom).toBe(3);

    useReaderStore.getState().setZoom(0.1);
    expect(useReaderStore.getState().zoom).toBe(0.5);

    useReaderStore.getState().setZoom(1.25);
    expect(useReaderStore.getState().zoom).toBe(1.25);
  });

  it('close 重置全部阅读状态', () => {
    useReaderStore.setState({
      paperId: 1,
      pageCount: 10,
      currentPage: 4,
      zoom: 2,
      error: '出错了',
      selection: { text: '选中文字', pageNo: 4 },
      failedVersion: 'original',
    });

    useReaderStore.getState().close();

    const state = useReaderStore.getState();
    expect(state.paperId).toBeNull();
    expect(state.version).toBe('original');
    expect(state.pageCount).toBe(0);
    expect(state.currentPage).toBe(1);
    expect(state.zoom).toBe(1);
    expect(state.error).toBeNull();
    expect(state.selection).toBeNull();
    expect(state.failedVersion).toBeNull();
  });

  it('setSelection 与 setError 写入状态', () => {
    useReaderStore.getState().setSelection({ text: '一段话', pageNo: 2 });
    expect(useReaderStore.getState().selection).toEqual({ text: '一段话', pageNo: 2 });

    useReaderStore.getState().setError('无法打开');
    expect(useReaderStore.getState().error).toBe('无法打开');
  });
});
