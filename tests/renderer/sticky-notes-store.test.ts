// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  PdfVersion,
  StickyNote,
  StickyNoteCreateInput,
  StickyNoteExportResult,
  StickyNoteUpdatePatch,
} from '@shared/types';
import { useStickyNotesStore } from '@renderer/stores/sticky-notes';

function makeNote(id: number, overrides: Partial<StickyNote> = {}): StickyNote {
  return {
    id,
    paperId: 1,
    pdfVersion: 'original',
    pageNo: 1,
    quote: `引用 ${id}`,
    contentMd: `内容 ${id}`,
    anchor: {
      kind: 'text',
      rects: [{ x: 0.1, y: 0.2, width: 0.3, height: 0.04 }],
    },
    source: 'manual',
    createdAt: 1_000 + id,
    updatedAt: 1_000 + id,
    ...overrides,
  };
}

function makeInput(overrides: Partial<StickyNoteCreateInput> = {}): StickyNoteCreateInput {
  return {
    paperId: 1,
    pdfVersion: 'original',
    pageNo: 1,
    quote: '引用',
    contentMd: '内容',
    anchor: { kind: 'page' },
    source: 'manual',
    ...overrides,
  };
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

function installApi() {
  const stickyNotes = {
    list: vi.fn(async (_paperId: number, _version: PdfVersion): Promise<StickyNote[]> => []),
    create: vi.fn(async (input: StickyNoteCreateInput): Promise<StickyNote> =>
      makeNote(99, { ...input, createdAt: 5_000, updatedAt: 5_000 }),
    ),
    update: vi.fn(async (id: number, patch: StickyNoteUpdatePatch): Promise<StickyNote> =>
      makeNote(id, { ...patch, updatedAt: 9_000 }),
    ),
    remove: vi.fn(async (_id: number): Promise<void> => undefined),
    clearPageDrawings: vi.fn(
      async (_paperId: number, _version: PdfVersion, _pageNo: number): Promise<number> => 0,
    ),
    exportPdf: vi.fn(
      async (_paperId: number, _version: PdfVersion): Promise<StickyNoteExportResult | null> => ({
        filePath: 'C:/out/notes.pdf',
        exported: 2,
        skipped: 1,
      }),
    ),
  };
  (window as unknown as { api: unknown }).api = { stickyNotes };
  return stickyNotes;
}

let api: ReturnType<typeof installApi>;

beforeEach(() => {
  useStickyNotesStore.getState().reset();
  useStickyNotesStore.setState({ paperId: null, version: null });
  api = installApi();
});

describe('load', () => {
  it('按页码、创建时间与 id 排序加载当前隔离域', async () => {
    const pageTwo = makeNote(2, { pageNo: 2, createdAt: 100 });
    const pageOneLater = makeNote(3, { pageNo: 1, createdAt: 300 });
    const pageOneEarlier = makeNote(1, { pageNo: 1, createdAt: 200 });
    api.list.mockResolvedValue([pageTwo, pageOneLater, pageOneEarlier]);

    await useStickyNotesStore.getState().load(7, 'translated');

    expect(api.list).toHaveBeenCalledWith(7, 'translated');
    const state = useStickyNotesStore.getState();
    expect(state.paperId).toBe(7);
    expect(state.version).toBe('translated');
    expect(state.loading).toBe(false);
    expect(state.notes.map((note) => note.id)).toEqual([1, 3, 2]);
  });

  it('切换版本立即清空旧域并丢弃旧请求结果', async () => {
    const originalLoad = deferred<StickyNote[]>();
    const translatedLoad = deferred<StickyNote[]>();
    api.list
      .mockImplementationOnce(() => originalLoad.promise)
      .mockImplementationOnce(() => translatedLoad.promise);

    const first = useStickyNotesStore.getState().load(1, 'original');
    useStickyNotesStore.setState({ notes: [makeNote(1)], activeNoteId: 1 });

    const second = useStickyNotesStore.getState().load(1, 'translated');
    const duringSwitch = useStickyNotesStore.getState();
    expect(duringSwitch.version).toBe('translated');
    expect(duringSwitch.notes).toEqual([]);
    expect(duringSwitch.activeNoteId).toBeNull();

    originalLoad.resolve([makeNote(1, { pdfVersion: 'original' })]);
    await first;
    expect(useStickyNotesStore.getState().notes).toEqual([]);

    translatedLoad.resolve([makeNote(2, { pdfVersion: 'translated' })]);
    await second;
    expect(useStickyNotesStore.getState().notes.map((note) => note.id)).toEqual([2]);
  });

  it('同一域重新加载时保留当前便签直到新结果到达', async () => {
    useStickyNotesStore.setState({
      paperId: 1,
      version: 'original',
      notes: [makeNote(1)],
      activeNoteId: 1,
    });
    const pending = deferred<StickyNote[]>();
    api.list.mockImplementationOnce(() => pending.promise);

    const loading = useStickyNotesStore.getState().load(1, 'original');
    expect(useStickyNotesStore.getState().notes.map((note) => note.id)).toEqual([1]);

    pending.resolve([makeNote(1)]);
    await loading;
    expect(useStickyNotesStore.getState().activeNoteId).toBe(1);
  });

  it('加载失败时记录错误并结束加载态', async () => {
    api.list.mockRejectedValue(new Error('数据库损坏'));

    await useStickyNotesStore.getState().load(1, 'original');

    const state = useStickyNotesStore.getState();
    expect(state.loading).toBe(false);
    expect(state.error).toContain('数据库损坏');
    expect(state.notes).toEqual([]);
  });

  it('新列表不再包含活动便签时清空 activeNoteId', async () => {
    useStickyNotesStore.setState({
      paperId: 1,
      version: 'original',
      notes: [makeNote(1)],
      activeNoteId: 1,
    });
    api.list.mockResolvedValue([makeNote(2)]);

    await useStickyNotesStore.getState().load(1, 'original');

    expect(useStickyNotesStore.getState().activeNoteId).toBeNull();
  });
});

describe('create', () => {
  it('只把与当前论文和版本匹配的便签插入列表', async () => {
    useStickyNotesStore.setState({
      paperId: 1,
      version: 'original',
      notes: [makeNote(2, { pageNo: 2 })],
    });

    await useStickyNotesStore.getState().create(makeInput({ pageNo: 1 }));
    expect(useStickyNotesStore.getState().notes.map((note) => note.pageNo)).toEqual([1, 2]);

    api.create.mockResolvedValueOnce(
      makeNote(98, { pdfVersion: 'bilingual', pageNo: 1 }),
    );
    await useStickyNotesStore.getState().create(
      makeInput({ pdfVersion: 'bilingual', pageNo: 1 }),
    );
    expect(useStickyNotesStore.getState().notes.map((note) => note.pageNo)).toEqual([1, 2]);
  });

  it('创建失败时返回 null 并记录错误', async () => {
    api.create.mockRejectedValue(new Error('引用过长'));

    const result = await useStickyNotesStore.getState().create(makeInput());

    expect(result).toBeNull();
    expect(useStickyNotesStore.getState().error).toContain('引用过长');
  });

  it('创建成功会使在途的旧 load 失效，避免覆盖新便签', async () => {
    useStickyNotesStore.setState({ paperId: 1, version: 'original', notes: [] });
    const pending = deferred<StickyNote[]>();
    api.list.mockImplementationOnce(() => pending.promise);

    const loading = useStickyNotesStore.getState().load(1, 'original');
    await useStickyNotesStore.getState().create(makeInput());
    pending.resolve([makeNote(50)]);
    await loading;

    expect(useStickyNotesStore.getState().notes.map((note) => note.id)).toEqual([99]);
  });
});

describe('update / remove', () => {
  it('更新后替换列表项并保持排序', async () => {
    useStickyNotesStore.setState({
      paperId: 1,
      version: 'original',
      notes: [makeNote(1), makeNote(2)],
      activeNoteId: 2,
    });
    api.update.mockResolvedValueOnce(makeNote(1, { contentMd: '新内容' }));

    const updated = await useStickyNotesStore.getState().update(1, { contentMd: '新内容' });

    expect(api.update).toHaveBeenCalledWith(1, { contentMd: '新内容' });
    expect(updated?.contentMd).toBe('新内容');
    expect(useStickyNotesStore.getState().notes[0].contentMd).toBe('新内容');
    expect(useStickyNotesStore.getState().activeNoteId).toBe(2);
  });

  it('update 转发完整标注补丁并返回更新后的条', async () => {
    useStickyNotesStore.setState({
      paperId: 1,
      version: 'original',
      notes: [makeNote(1)],
    });
    const patch: StickyNoteUpdatePatch = {
      contentMd: '新内容',
      markStyle: 'wavy-underline',
      color: '#facc15',
      pin: { x: 0.5, y: 0.5, visible: true },
      popup: { mode: 'right' },
    };
    api.update.mockResolvedValueOnce(makeNote(1, { ...patch }));

    const updated = await useStickyNotesStore.getState().update(1, patch);

    expect(api.update).toHaveBeenCalledWith(1, patch);
    expect(updated?.markStyle).toBe('wavy-underline');
    expect(useStickyNotesStore.getState().notes[0].markStyle).toBe('wavy-underline');
  });

  it('删除后移除条目，删除活动便签时清空 activeNoteId', async () => {
    useStickyNotesStore.setState({
      paperId: 1,
      version: 'original',
      notes: [makeNote(1), makeNote(2)],
      activeNoteId: 1,
    });

    await expect(useStickyNotesStore.getState().remove(1)).resolves.toBe(true);

    const state = useStickyNotesStore.getState();
    expect(state.notes.map((note) => note.id)).toEqual([2]);
    expect(state.activeNoteId).toBeNull();
  });

  it('remove 成功返回 true，失败返回 false 并保留原条', async () => {
    useStickyNotesStore.setState({ paperId: 1, version: 'original', notes: [makeNote(1)] });
    api.remove.mockRejectedValueOnce(new Error('删除失败'));
    await expect(useStickyNotesStore.getState().remove(1)).resolves.toBe(false);
    expect(useStickyNotesStore.getState().notes).toHaveLength(1);
  });
});

describe('clearPageDrawings', () => {
  it('clearPageDrawings 只移除当前域当前页的 ink/shape', async () => {
    const note = makeNote(1);
    const ink = makeNote(2, { kind: 'ink', pageNo: 1 });
    const otherPage = makeNote(3, { kind: 'ink', pageNo: 2 });
    useStickyNotesStore.setState({
      paperId: 1, version: 'original', notes: [note, ink, otherPage],
    });
    api.clearPageDrawings.mockResolvedValueOnce(1);
    await expect(
      useStickyNotesStore.getState().clearPageDrawings(1, 'original', 1),
    ).resolves.toBe(1);
    expect(useStickyNotesStore.getState().notes.map((n) => n.id)).toEqual([1, 3]);
  });

  it('clearPageDrawings 失败时返回 null 并保留本地条', async () => {
    const ink = makeNote(2, { kind: 'ink', pageNo: 1 });
    useStickyNotesStore.setState({
      paperId: 1, version: 'original', notes: [ink],
    });
    api.clearPageDrawings.mockRejectedValueOnce(new Error('清空失败'));

    await expect(
      useStickyNotesStore.getState().clearPageDrawings(1, 'original', 1),
    ).resolves.toBeNull();

    const state = useStickyNotesStore.getState();
    expect(state.notes.map((n) => n.id)).toEqual([2]);
    expect(state.error).toContain('清空失败');
  });

  it('clearPageDrawings 响应晚于版本切换时不删除新域同页 ink/shape', async () => {
    useStickyNotesStore.setState({
      paperId: 1,
      version: 'original',
      notes: [makeNote(2, { kind: 'ink', pageNo: 3 })],
    });
    const clear = deferred<number>();
    api.clearPageDrawings.mockImplementationOnce(() => clear.promise);

    const clearing = useStickyNotesStore
      .getState()
      .clearPageDrawings(1, 'original', 3);

    api.list.mockResolvedValueOnce([
      makeNote(5, { kind: 'ink', pageNo: 3, pdfVersion: 'translated' }),
      makeNote(6, { kind: 'note', pageNo: 3, pdfVersion: 'translated' }),
    ]);
    await useStickyNotesStore.getState().load(1, 'translated');

    clear.resolve(1);
    await expect(clearing).resolves.toBe(1);

    const state = useStickyNotesStore.getState();
    expect(state.paperId).toBe(1);
    expect(state.version).toBe('translated');
    expect(state.loading).toBe(false);
    expect(state.notes.map((note) => note.id)).toEqual([5, 6]);
  });

  it('clearPageDrawings 旧域响应不使新域在途 load 失效', async () => {
    useStickyNotesStore.setState({
      paperId: 1,
      version: 'original',
      notes: [makeNote(2, { kind: 'ink', pageNo: 3 })],
    });
    const clear = deferred<number>();
    api.clearPageDrawings.mockImplementationOnce(() => clear.promise);

    const clearing = useStickyNotesStore
      .getState()
      .clearPageDrawings(1, 'original', 3);

    const translatedLoad = deferred<StickyNote[]>();
    api.list.mockImplementationOnce(() => translatedLoad.promise);
    const loading = useStickyNotesStore.getState().load(1, 'translated');

    clear.resolve(1);
    await expect(clearing).resolves.toBe(1);

    translatedLoad.resolve([
      makeNote(5, { kind: 'ink', pageNo: 3, pdfVersion: 'translated' }),
    ]);
    await loading;

    const state = useStickyNotesStore.getState();
    expect(state.loading).toBe(false);
    expect(state.notes.map((note) => note.id)).toEqual([5]);
  });

  it('clearPageDrawings 旧域失败不把错误写进新域', async () => {
    useStickyNotesStore.setState({
      paperId: 1,
      version: 'original',
      notes: [makeNote(2, { kind: 'ink', pageNo: 3 })],
    });
    const clear = deferred<number>();
    api.clearPageDrawings.mockImplementationOnce(() => clear.promise);

    const clearing = useStickyNotesStore
      .getState()
      .clearPageDrawings(1, 'original', 3);

    api.list.mockResolvedValueOnce([
      makeNote(5, { kind: 'ink', pageNo: 3, pdfVersion: 'translated' }),
    ]);
    await useStickyNotesStore.getState().load(1, 'translated');

    clear.reject(new Error('清空失败'));
    await expect(clearing).resolves.toBeNull();

    const state = useStickyNotesStore.getState();
    expect(state.error).toBeNull();
    expect(state.notes.map((note) => note.id)).toEqual([5]);
  });
});

describe('exportPdf', () => {
  it('导出结果写入 notice，并结束导出态', async () => {
    const result = await useStickyNotesStore.getState().exportPdf(1, 'original');

    expect(result).toEqual({
      filePath: 'C:/out/notes.pdf',
      exported: 2,
      skipped: 1,
    });
    const state = useStickyNotesStore.getState();
    expect(state.exporting).toBe(false);
    expect(state.notice).toEqual(result);
  });

  it('导出失败时记录错误并结束导出态', async () => {
    api.exportPdf.mockRejectedValue(new Error('不能覆盖文献库中的 PDF'));

    const result = await useStickyNotesStore.getState().exportPdf(1, 'original');

    expect(result).toBeNull();
    const state = useStickyNotesStore.getState();
    expect(state.exporting).toBe(false);
    expect(state.error).toContain('不能覆盖');
  });
});

describe('reset', () => {
  it('清空全部便签状态', async () => {
    useStickyNotesStore.setState({
      paperId: 1,
      version: 'original',
      notes: [makeNote(1)],
      activeNoteId: 1,
      error: 'x',
      notice: { filePath: 'p', exported: 1, skipped: 0 },
    });

    useStickyNotesStore.getState().reset();

    expect(useStickyNotesStore.getState()).toMatchObject({
      paperId: null,
      version: null,
      notes: [],
      activeNoteId: null,
      error: null,
      notice: null,
    });
  });
});
