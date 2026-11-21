// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { Paper, PdfVersion } from '@shared/types';
import { TRANSLATION_REPAIRED_NOTICE } from '@shared/translation';
import { useLibraryStore } from '@renderer/stores/library';
import { useReaderStore } from '@renderer/stores/reader';
import {
  clearAll,
  keyFor,
  load as loadCached,
} from '@renderer/lib/pdf-document-cache';

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
    pageCountBilingual: null,
    hasTextLayer: true,
    outline: [],
    tags: [],
    lastPageOriginal: 1,
    lastPageTranslated: 1,
    lastVersion: 'original',
    lastOffsetOriginal: 0,
    lastOffsetTranslated: 0,
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
  const list = vi.fn(async (): Promise<Paper[]> => []);
  const markRead = vi.fn(
    async (
      _id: number,
      _version: PdfVersion,
      _pageNo: number,
      _offset: number,
    ): Promise<void> => undefined,
  );
  const checkFiles = vi.fn(
    async (): Promise<
      {
        id: number;
        originalExists: boolean;
        translatedExists: boolean;
        bilingualExists: boolean;
        translatedIsBilingual: boolean;
      }[]
    > => [],
  );
  const load = vi.fn(
    async (
      _paperId: number,
      _version: PdfVersion,
    ): Promise<{
      data: ArrayBuffer;
      fileName: string;
      repaired?: boolean;
      pageCountTranslated?: number;
    }> => ({
      data: new ArrayBuffer(8),
      fileName: 'sample.pdf',
    }),
  );
  (window as unknown as { api: unknown }).api = {
    papers: { get, list, markRead, checkFiles },
    pdf: { load },
  };
  return { get, list, markRead, checkFiles, load };
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

/** Puts a parsed document in the shared cache without calling the real parser. */
async function seedCache(
  paper: Paper,
  version: PdfVersion,
  numPages: number,
): Promise<void> {
  const loadingTask = {
    destroy: vi.fn(async () => undefined),
  } as unknown as PDFDocumentLoadingTask;
  const pdf = { numPages } as unknown as PDFDocumentProxy;
  await loadCached(keyFor(paper, version), async () => ({
    pdf,
    loadingTask,
    pageSizes: [],
  }));
}

let api: ReturnType<typeof installApi>;

beforeEach(async () => {
  // close() flushes and invalidates any session left by the previous test.
  useReaderStore.getState().close();
  await useReaderStore.getState().flushPosition();
  api = installApi();
  clearAll();
  useLibraryStore.setState({ papers: [], loading: false, fileStatus: {} });
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

  it('成功时恢复上次页码、页内偏移与原文页数', async () => {
    api.get.mockResolvedValue(
      makePaper({
        pageCountOriginal: 10,
        lastPageOriginal: 3,
        lastOffsetOriginal: 0.5,
      }),
    );

    await useReaderStore.getState().open(1);

    const state = useReaderStore.getState();
    expect(api.get).toHaveBeenCalledWith(1);
    expect(api.load).toHaveBeenCalledWith(1, 'original');
    expect(state.currentPage).toBe(3);
    expect(state.currentOffset).toBe(0.5);
    expect(state.error).toBeNull();
    expect(state.version).toBe('original');
    expect(state.pageCount).toBe(10);
  });

  it('恢复 lastVersion 为译本时的页码与偏移', async () => {
    api.get.mockResolvedValue(
      makePaper({
        filePathTranslated: 'C:/papers/fem-zh.pdf',
        pageCountTranslated: 10,
        lastVersion: 'translated',
        lastPageTranslated: 4,
        lastOffsetTranslated: 0.5,
      }),
    );

    await useReaderStore.getState().open(1);

    const state = useReaderStore.getState();
    expect(api.load).toHaveBeenCalledWith(1, 'translated');
    expect(state.version).toBe('translated');
    expect(state.currentPage).toBe(4);
    expect(state.currentOffset).toBe(0.5);
    expect(state.pageCount).toBe(10);
  });

  it('恢复的页码超过总页数时被钳制', async () => {
    api.get.mockResolvedValue(
      makePaper({ pageCountOriginal: 10, lastPageOriginal: 99 }),
    );

    await useReaderStore.getState().open(1);

    expect(useReaderStore.getState().currentPage).toBe(10);
  });

  it('传入初始页码时强制原文、偏移清零并立即记录', async () => {
    api.get.mockResolvedValue(
      makePaper({
        filePathTranslated: 'C:/papers/fem-zh.pdf',
        pageCountTranslated: 10,
        lastVersion: 'translated',
        lastPageOriginal: 3,
      }),
    );

    await useReaderStore.getState().open(1, 6);

    const state = useReaderStore.getState();
    expect(api.load).toHaveBeenCalledWith(1, 'original');
    expect(state.version).toBe('original');
    expect(state.currentPage).toBe(6);
    expect(state.currentOffset).toBe(0);
    await vi.waitFor(() => {
      expect(api.markRead).toHaveBeenCalledWith(1, 'original', 6, 0);
    });
  });

  it('初始页码按总页数钳制', async () => {
    api.get.mockResolvedValue(
      makePaper({ pageCountOriginal: 10, lastPageOriginal: 3 }),
    );

    await useReaderStore.getState().open(1, 99);
    expect(useReaderStore.getState().currentPage).toBe(10);

    await useReaderStore.getState().open(1, 0);
    expect(useReaderStore.getState().currentPage).toBe(1);

    await useReaderStore.getState().open(1, Number.NaN);
    expect(useReaderStore.getState().currentPage).toBe(1);
  });

  it('一次性初始页码在对应文献打开时生效并清空', async () => {
    api.get.mockImplementation(async (id) =>
      makePaper({ id, pageCountOriginal: 20, lastPageOriginal: 7 }),
    );

    useReaderStore.getState().requestInitialPage(2, 5);
    await useReaderStore.getState().open(2);

    const state = useReaderStore.getState();
    expect(state.currentPage).toBe(5);
    expect(state.pendingInitialPage).toBeNull();
  });

  it('一次性初始页码不会应用到其他文献，也不会被那次打开消耗', async () => {
    api.get.mockImplementation(async (id) =>
      makePaper({ id, pageCountOriginal: 20, lastPageOriginal: 7 }),
    );

    useReaderStore.getState().requestInitialPage(2, 5);
    await useReaderStore.getState().open(1);

    expect(useReaderStore.getState().currentPage).toBe(7);
    expect(useReaderStore.getState().pendingInitialPage).toEqual({
      paperId: 2,
      page: 5,
    });

    await useReaderStore.getState().open(2);
    expect(useReaderStore.getState().currentPage).toBe(5);
  });

  it('一次性初始页码只消费一次，再次打开回落到上次阅读页码', async () => {
    api.get.mockImplementation(async (id) =>
      makePaper({ id, pageCountOriginal: 20, lastPageOriginal: 7 }),
    );

    useReaderStore.getState().requestInitialPage(2, 5);
    await useReaderStore.getState().open(2);
    expect(useReaderStore.getState().currentPage).toBe(5);

    await useReaderStore.getState().open(2);
    expect(useReaderStore.getState().currentPage).toBe(7);
  });

  it('一次性初始页码按总页数钳制', async () => {
    api.get.mockResolvedValue(
      makePaper({ pageCountOriginal: 10, lastPageOriginal: 3 }),
    );

    useReaderStore.getState().requestInitialPage(1, 99);
    await useReaderStore.getState().open(1);

    expect(useReaderStore.getState().currentPage).toBe(10);
  });

  it('clearInitialPage 丢弃未被消费的一次性初始页码', async () => {
    api.get.mockResolvedValue(
      makePaper({ pageCountOriginal: 10, lastPageOriginal: 3 }),
    );

    useReaderStore.getState().requestInitialPage(1, 8);
    useReaderStore.getState().clearInitialPage();
    await useReaderStore.getState().open(1);

    expect(useReaderStore.getState().currentPage).toBe(3);
    expect(useReaderStore.getState().pendingInitialPage).toBeNull();
  });

  it('显式初始页码优先于一次性初始页码', async () => {
    api.get.mockImplementation(async (id) =>
      makePaper({ id, pageCountOriginal: 20, lastPageOriginal: 7 }),
    );

    useReaderStore.getState().requestInitialPage(2, 5);
    await useReaderStore.getState().open(2, 9);

    expect(useReaderStore.getState().currentPage).toBe(9);
    expect(useReaderStore.getState().pendingInitialPage).toBeNull();

    await useReaderStore.getState().open(2);
    expect(useReaderStore.getState().currentPage).toBe(7);
  });

  it('中英对照打不开时按比例回落到仅译文并提示', async () => {
    api.get.mockResolvedValue(
      makePaper({
        filePathTranslated: 'C:/papers/fem-zh.pdf',
        pageCountTranslated: 10,
        pageCountBilingual: 20,
        lastVersion: 'bilingual',
        lastPageTranslated: 8,
        lastOffsetTranslated: 0.5,
      }),
    );
    api.load.mockImplementation(async (_id, version) => {
      if (version === 'bilingual') {
        throw new Error('文件不存在');
      }
      return { data: new ArrayBuffer(8), fileName: 'fem-zh.pdf' };
    });

    await useReaderStore.getState().open(1);

    const state = useReaderStore.getState();
    expect(state.version).toBe('translated');
    expect(state.pageCount).toBe(10);
    // (8 - 1 + 0.5) / 20 = 0.375 → 3.75 → page 4, offset 0.75.
    expect(state.currentPage).toBe(4);
    expect(state.currentOffset).toBeCloseTo(0.75, 6);
    expect(state.versionNotice).toBe(
      '上次阅读的中英对照暂时无法打开，已切换到仅译文。',
    );
    expect(state.error).toBeNull();
  });

  it('旧版中英对照缺少页数时不按单语页数钳制，等 PDF.js 报告真实页数', async () => {
    api.get.mockResolvedValue(
      makePaper({
        filePathTranslated: 'C:/papers/fem-zh.pdf',
        pageCountTranslated: 10,
        pageCountBilingual: null,
        lastVersion: 'bilingual',
        lastPageTranslated: 15,
        lastOffsetTranslated: 0.5,
      }),
    );

    await useReaderStore.getState().open(1);

    expect(useReaderStore.getState().version).toBe('bilingual');
    expect(useReaderStore.getState().currentPage).toBe(15);
    expect(useReaderStore.getState().currentOffset).toBe(0.5);
    expect(useReaderStore.getState().pageCount).toBe(10);

    useReaderStore.getState().adoptDocumentPageCount(20);

    const state = useReaderStore.getState();
    expect(state.pageCount).toBe(20);
    expect(state.currentPage).toBe(15);
    expect(state.currentOffset).toBe(0.5);
  });

  it('命中缓存时跳过 IPC 读取并采用缓存文档页数', async () => {
    const paper = makePaper({
      pageCountOriginal: 10,
      lastPageOriginal: 3,
    });
    api.get.mockResolvedValue(paper);
    await seedCache(paper, 'original', 12);

    await useReaderStore.getState().open(1);

    expect(api.load).not.toHaveBeenCalled();
    expect(useReaderStore.getState().pageCount).toBe(12);
    expect(useReaderStore.getState().currentPage).toBe(3);
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
    const paperA = makePaper({
      id: 1,
      pageCountOriginal: 10,
      lastPageOriginal: 4,
    });
    const paperB = makePaper({
      id: 2,
      pageCountOriginal: 20,
      lastPageOriginal: 7,
    });
    const getA = deferred<Paper | null>();
    const getB = deferred<Paper | null>();
    const loadB = deferred<{ data: ArrayBuffer; fileName: string }>();
    api.get.mockImplementation((id) => (id === 1 ? getA.promise : getB.promise));
    api.load.mockImplementation((id) =>
      id === 1
        ? Promise.reject(new Error('文件不存在: 1'))
        : loadB.promise,
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
    const paperA = makePaper({
      id: 1,
      pageCountOriginal: 10,
      lastPageOriginal: 4,
    });
    const paperB = makePaper({
      id: 2,
      pageCountOriginal: 20,
      lastPageOriginal: 7,
    });
    const getA = deferred<Paper | null>();
    const loadA = deferred<{ data: ArrayBuffer; fileName: string }>();
    const getB = deferred<Paper | null>();
    const loadB = deferred<{ data: ArrayBuffer; fileName: string }>();
    api.get.mockImplementation((id) => (id === 1 ? getA.promise : getB.promise));
    api.load.mockImplementation((id) =>
      id === 1 ? loadA.promise : loadB.promise,
    );

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

describe('useReaderStore.setVersion', () => {
  it('译本被自动修复时采用双语页数并显示提示', async () => {
    useReaderStore.setState({
      paperId: 1,
      version: 'original',
      pageCount: 10,
      currentPage: 3,
    });
    api.get.mockResolvedValue(
      makePaper({
        filePathTranslated: 'C:/papers/translated.zh-CN.dual.pdf',
        pageCountTranslated: 10,
        lastPageTranslated: 4,
      }),
    );
    api.load.mockResolvedValue({
      data: new ArrayBuffer(8),
      fileName: 'dual.pdf',
      repaired: true,
      pageCountTranslated: 12,
    });

    await useReaderStore.getState().setVersion('translated');

    const state = useReaderStore.getState();
    expect(state.version).toBe('translated');
    expect(state.pageCount).toBe(12);
    // Live progress (page 3 of 10) maps onto the repaired 12-page layout;
    // the remembered translated page is not consulted.
    expect(state.currentPage).toBe(3);
    expect(state.currentOffset).toBeCloseTo(0.4, 6);
    expect(state.versionNotice).toBe(TRANSLATION_REPAIRED_NOTICE);
    await vi.waitFor(() => {
      expect(api.list).toHaveBeenCalled();
      expect(api.checkFiles).toHaveBeenCalled();
    });
  });

  it('普通切换不显示修复提示', async () => {
    useReaderStore.setState({ paperId: 1, version: 'original', pageCount: 10 });
    api.get.mockResolvedValue(
      makePaper({
        filePathTranslated: 'C:/papers/translated.zh-CN.mono.pdf',
        pageCountTranslated: 10,
      }),
    );

    await useReaderStore.getState().setVersion('translated');

    expect(useReaderStore.getState().version).toBe('translated');
    expect(useReaderStore.getState().versionNotice).toBeNull();
    expect(api.list).not.toHaveBeenCalled();
  });

  it('页数相同时保留当前页与页内偏移，不使用历史译本页码', async () => {
    useReaderStore.setState({
      paperId: 1,
      version: 'original',
      pageCount: 10,
      currentPage: 5,
      currentOffset: 0.5,
    });
    api.get.mockResolvedValue(
      makePaper({
        filePathTranslated: 'C:/papers/translated.zh-CN.mono.pdf',
        pageCountTranslated: 10,
        lastPageTranslated: 8,
        lastOffsetTranslated: 0.9,
      }),
    );

    await useReaderStore.getState().setVersion('translated');

    const state = useReaderStore.getState();
    expect(state.version).toBe('translated');
    expect(state.currentPage).toBe(5);
    expect(state.currentOffset).toBe(0.5);
  });

  it('页数不同时按阅读进度映射，不使用历史译本页码', async () => {
    useReaderStore.setState({
      paperId: 1,
      version: 'original',
      pageCount: 10,
      currentPage: 5,
      currentOffset: 0.5,
    });
    api.get.mockResolvedValue(
      makePaper({
        filePathTranslated: 'C:/papers/translated.zh-CN.mono.pdf',
        pageCountTranslated: 20,
        lastPageTranslated: 2,
      }),
    );

    await useReaderStore.getState().setVersion('translated');

    const state = useReaderStore.getState();
    expect(state.pageCount).toBe(20);
    // (5 - 1 + 0.5) / 10 = 0.45 → 9 → page 10, offset 0.
    expect(state.currentPage).toBe(10);
    expect(state.currentOffset).toBe(0);
  });

  it('旧版中英对照页数未知时延迟映射，adopt 后完成映射并持久化', async () => {
    useReaderStore.setState({
      paperId: 1,
      version: 'original',
      pageCount: 10,
      currentPage: 5,
      currentOffset: 0.5,
    });
    api.get.mockResolvedValue(
      makePaper({
        filePathTranslated: 'C:/papers/translated.zh-CN.dual.pdf',
        pageCountTranslated: 10,
        pageCountBilingual: null,
      }),
    );

    await useReaderStore.getState().setVersion('bilingual');

    let state = useReaderStore.getState();
    expect(state.version).toBe('bilingual');
    expect(state.pageCount).toBe(10);
    expect(state.currentPage).toBe(5);
    // Only the old version's position was written; the new one is deferred.
    expect(api.markRead).toHaveBeenCalledTimes(1);
    expect(api.markRead).toHaveBeenCalledWith(1, 'original', 5, 0.5);

    useReaderStore.getState().adoptDocumentPageCount(20);

    state = useReaderStore.getState();
    expect(state.pageCount).toBe(20);
    // (5 - 1 + 0.5) / 10 = 0.45 → 9 → page 10, offset 0.
    expect(state.currentPage).toBe(10);
    expect(state.currentOffset).toBe(0);
    await vi.waitFor(() => {
      expect(api.markRead).toHaveBeenCalledWith(1, 'bilingual', 10, 0);
    });
  });

  it('切换到已绑定的译本时同步页码、保留缩放并加载译本 PDF', async () => {
    api.get.mockResolvedValue(
      makePaper({
        filePathTranslated: 'C:/papers/fem-zh.pdf',
        pageCountTranslated: 10,
      }),
    );

    await useReaderStore.getState().open(1);
    useReaderStore.getState().setCurrentPosition(5, 0.5);
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
    expect(state.currentOffset).toBe(0.5);
    expect(state.pageCount).toBe(10);
    expect(state.zoom).toBe(1.5);
    expect(state.selection).toBeNull();
    expect(state.error).toBeNull();
    expect(state.failedVersion).toBeNull();
    expect(api.load).toHaveBeenCalledWith(1, 'translated');
  });

  it('未绑定译本时两种译本视图都拒绝切换', async () => {
    useReaderStore.setState({
      paperId: 1,
      version: 'original',
      pageCount: 10,
      currentPage: 3,
    });

    await useReaderStore.getState().setVersion('bilingual');
    expect(useReaderStore.getState().error).toBe('未绑定译本');
    expect(useReaderStore.getState().failedVersion).toBe('bilingual');

    await useReaderStore.getState().setVersion('translated');
    expect(useReaderStore.getState().error).toBe('未绑定译本');
    expect(useReaderStore.getState().failedVersion).toBe('translated');
    expect(api.load).not.toHaveBeenCalled();
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
      makePaper({
        filePathTranslated: 'C:/papers/fem-zh.pdf',
        pageCountTranslated: 10,
      }),
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

  it('校验读取期间滚动到的新位置不会被切换覆盖', async () => {
    api.get.mockResolvedValue(
      makePaper({
        filePathTranslated: 'C:/papers/fem-zh.pdf',
        pageCountTranslated: 10,
      }),
    );
    await useReaderStore.getState().open(1);

    const validating = deferred<{ data: ArrayBuffer; fileName: string }>();
    api.load.mockImplementationOnce(() => validating.promise);
    const switching = useReaderStore.getState().setVersion('translated');
    await flushAsync();
    useReaderStore.getState().setCurrentPosition(7, 0.25);
    validating.resolve({ data: new ArrayBuffer(8), fileName: 'fem-zh.pdf' });
    await switching;

    const state = useReaderStore.getState();
    expect(state.version).toBe('translated');
    expect(state.currentPage).toBe(7);
    expect(state.currentOffset).toBe(0.25);
  });

  it('切换前先落盘旧版本位置，再写入新版本位置', async () => {
    useReaderStore.setState({
      paperId: 1,
      version: 'original',
      pageCount: 10,
      currentPage: 5,
      currentOffset: 0.5,
    });
    api.get.mockResolvedValue(
      makePaper({
        filePathTranslated: 'C:/papers/fem-zh.pdf',
        pageCountTranslated: 10,
      }),
    );

    await useReaderStore.getState().setVersion('translated');

    await vi.waitFor(() => {
      expect(api.markRead).toHaveBeenCalledTimes(2);
    });
    expect(api.markRead.mock.calls[0]).toEqual([1, 'original', 5, 0.5]);
    expect(api.markRead.mock.calls[1]).toEqual([1, 'translated', 5, 0.5]);
  });

  it('setError 按当前版本记录失败版本并在清除时重置', () => {
    useReaderStore.setState({
      paperId: 1,
      version: 'translated',
      pageCount: 10,
      currentPage: 3,
    });

    useReaderStore.getState().setError('无法渲染');

    expect(useReaderStore.getState().failedVersion).toBe('translated');
    useReaderStore.getState().setError(null);
    expect(useReaderStore.getState().failedVersion).toBeNull();
    expect(useReaderStore.getState().error).toBeNull();
  });

  it('dismissVersionNotice 清除提示', () => {
    useReaderStore.setState({ versionNotice: TRANSLATION_REPAIRED_NOTICE });

    useReaderStore.getState().dismissVersionNotice();

    expect(useReaderStore.getState().versionNotice).toBeNull();
  });

  it('打开另一篇文献时清除提示', async () => {
    useReaderStore.setState({ versionNotice: TRANSLATION_REPAIRED_NOTICE });

    await useReaderStore.getState().open(1);

    expect(useReaderStore.getState().versionNotice).toBeNull();
  });
});

describe('useReaderStore 边界控制', () => {
  beforeEach(() => {
    useReaderStore.setState({ pageCount: 10, paperId: 1 });
  });

  it('jumpToPage 与 setCurrentPosition 按总页数钳制并记录偏移', () => {
    useReaderStore.getState().jumpToPage(99);
    expect(useReaderStore.getState().currentPage).toBe(10);
    expect(useReaderStore.getState().currentOffset).toBe(0);

    useReaderStore.getState().setCurrentPosition(0, 1.5);
    expect(useReaderStore.getState().currentPage).toBe(1);
    expect(useReaderStore.getState().currentOffset).toBe(0.999999);
  });

  it('setZoom 钳制在 0.5 到 3 之间', () => {
    useReaderStore.getState().setZoom(9);
    expect(useReaderStore.getState().zoom).toBe(3);

    useReaderStore.getState().setZoom(0.1);
    expect(useReaderStore.getState().zoom).toBe(0.5);

    useReaderStore.getState().setZoom(1.25);
    expect(useReaderStore.getState().zoom).toBe(1.25);
  });

  it('close 刷新未落盘的位置并重置全部阅读状态', async () => {
    useReaderStore.setState({
      paperId: 1,
      pageCount: 10,
      currentPage: 4,
      currentOffset: 0.5,
      positionSeq: 3,
      zoom: 2,
      error: '出错了',
      selection: {
        text: '选中文字',
        pageNo: 4,
        version: 'original',
        rects: [{ x: 0.1, y: 0.2, width: 0.3, height: 0.04 }],
      },
      failedVersion: 'original',
      versionNotice: TRANSLATION_REPAIRED_NOTICE,
    });
    useReaderStore.getState().setCurrentPosition(7, 0.25);

    useReaderStore.getState().close();

    await vi.waitFor(() => {
      expect(api.markRead).toHaveBeenCalledWith(1, 'original', 7, 0.25);
    });

    const state = useReaderStore.getState();
    expect(state.paperId).toBeNull();
    expect(state.version).toBe('original');
    expect(state.pageCount).toBe(0);
    expect(state.currentPage).toBe(1);
    expect(state.currentOffset).toBe(0);
    expect(state.positionSeq).toBe(0);
    expect(state.zoom).toBe(1);
    expect(state.error).toBeNull();
    expect(state.selection).toBeNull();
    expect(state.failedVersion).toBeNull();
    expect(state.versionNotice).toBeNull();
  });

  it('setSelection 与 setError 写入状态', () => {
    const selection = {
      text: '一段话',
      pageNo: 2,
      version: 'original' as const,
      rects: [{ x: 0.1, y: 0.2, width: 0.3, height: 0.04 }],
    };
    useReaderStore.getState().setSelection(selection);
    expect(useReaderStore.getState().selection).toEqual(selection);

    useReaderStore.getState().setError('无法打开');
    expect(useReaderStore.getState().error).toBe('无法打开');
  });
});
