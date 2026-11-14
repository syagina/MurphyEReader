// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Note, NoteType } from '@shared/types';
import { useNotesStore } from '@renderer/stores/notes';

function makeNote(id: number, overrides: Partial<Note> = {}): Note {
  return {
    id,
    paperId: 1,
    type: 'manual',
    title: `笔记 ${id}`,
    contentMd: `内容 ${id}`,
    tags: [],
    createdAt: 1_000 + id,
    updatedAt: 1_000 + id,
    ...overrides,
  };
}

interface CreateInput {
  paperId: number;
  type: NoteType;
  title: string;
  contentMd: string;
  tags: string[];
}

interface GenerateParams {
  paperId: number;
  selectionText?: string;
  conceptTitle?: string;
  currentPageNo?: number;
}

type GenerateKind = 'summary' | 'concept' | 'innovation';

function installApi() {
  const notes = {
    list: vi.fn(async (_paperId?: number): Promise<Note[]> => []),
    create: vi.fn(async (input: CreateInput): Promise<Note> =>
      makeNote(99, { ...input, createdAt: 5_000, updatedAt: 5_000 }),
    ),
    update: vi.fn(
      async (
        id: number,
        patch: { title?: string; contentMd?: string; tags?: string[] },
      ): Promise<Note> => makeNote(id, { ...patch, updatedAt: 9_000 }),
    ),
    remove: vi.fn(async (_id: number): Promise<void> => undefined),
    generate: vi.fn(
      async (_kind: GenerateKind, _params: GenerateParams): Promise<Note | null> =>
        makeNote(77, { type: 'summary', updatedAt: 7_000 }),
    ),
  };
  (window as unknown as { api: unknown }).api = { notes };
  return notes;
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

function resetStore(): void {
  useNotesStore.setState({
    notes: [],
    selectedNoteId: null,
    paperId: null,
    generating: null,
    error: null,
  });
}

beforeEach(() => {
  resetStore();
  api = installApi();
});

describe('useNotesStore.load', () => {
  it('按文献加载笔记并按更新时间倒序保存', async () => {
    const loaded = [
      makeNote(1, { updatedAt: 1_000 }),
      makeNote(2, { updatedAt: 3_000 }),
      makeNote(3, { updatedAt: 2_000 }),
    ];
    api.list.mockResolvedValue(loaded);

    await useNotesStore.getState().load(1);

    const state = useNotesStore.getState();
    expect(api.list).toHaveBeenCalledWith(1);
    expect(state.paperId).toBe(1);
    expect(state.notes.map((note) => note.id)).toEqual([2, 3, 1]);
    expect(state.error).toBeNull();
  });

  it('不传文献时加载全部笔记', async () => {
    const loaded = [makeNote(1), makeNote(2, { paperId: 2 })];
    api.list.mockResolvedValue(loaded);

    await useNotesStore.getState().load();

    const state = useNotesStore.getState();
    expect(api.list.mock.calls[0]?.[0]).toBeUndefined();
    expect(state.paperId).toBeNull();
    expect(state.notes).toHaveLength(2);
  });

  it('切换文献时先清空旧列表，完成后再写入新文献笔记', async () => {
    useNotesStore.setState({
      paperId: 1,
      notes: [makeNote(1)],
      selectedNoteId: 1,
    });
    const pending = deferred<Note[]>();
    api.list.mockReturnValue(pending.promise);

    const loading = useNotesStore.getState().load(2);

    expect(useNotesStore.getState().paperId).toBe(2);
    expect(useNotesStore.getState().notes).toEqual([]);

    pending.resolve([makeNote(5, { paperId: 2 })]);
    await loading;

    const state = useNotesStore.getState();
    expect(state.notes.map((note) => note.id)).toEqual([5]);
    expect(state.selectedNoteId).toBeNull();
  });

  it('同一文献刷新时保留仍然存在的选中笔记', async () => {
    useNotesStore.setState({
      paperId: 1,
      notes: [makeNote(1), makeNote(2)],
      selectedNoteId: 2,
    });
    api.list.mockResolvedValue([makeNote(1), makeNote(2)]);

    await useNotesStore.getState().load(1);

    expect(useNotesStore.getState().selectedNoteId).toBe(2);
  });

  it('加载失败时写入错误并保持空列表', async () => {
    api.list.mockRejectedValue(new Error('数据库错误'));

    await useNotesStore.getState().load(1);

    const state = useNotesStore.getState();
    expect(state.error).toBe('数据库错误');
    expect(state.notes).toEqual([]);
  });

  it('加载列表不会清除已有的生成错误', async () => {
    useNotesStore.setState({ error: 'AI 请求失败' });
    api.list.mockResolvedValue([makeNote(1)]);

    await useNotesStore.getState().load(1);

    expect(useNotesStore.getState().error).toBe('AI 请求失败');
  });

  it('被取代的加载结果不会覆盖较新的加载结果', async () => {
    const stale = deferred<Note[]>();
    api.list.mockReturnValueOnce(stale.promise).mockResolvedValueOnce([makeNote(2)]);

    const first = useNotesStore.getState().load(1);
    const second = useNotesStore.getState().load(1);
    await second;
    stale.resolve([makeNote(9)]);
    await first;

    const state = useNotesStore.getState();
    expect(state.paperId).toBe(1);
    expect(state.notes.map((note) => note.id)).toEqual([2]);
  });
});

describe('useNotesStore.create', () => {
  it('创建后加入列表并选中新笔记', async () => {
    useNotesStore.setState({ paperId: 1, notes: [makeNote(1, { updatedAt: 1_000 })] });
    const input: CreateInput = {
      paperId: 1,
      type: 'manual',
      title: '手动笔记',
      contentMd: '选中的文字',
      tags: [],
    };

    await useNotesStore.getState().create(input);

    const state = useNotesStore.getState();
    expect(api.create).toHaveBeenCalledWith(input);
    expect(state.notes[0]?.id).toBe(99);
    expect(state.selectedNoteId).toBe(99);
  });

  it('创建失败时写入错误且不改变列表与选中项', async () => {
    useNotesStore.setState({ paperId: 1, notes: [makeNote(1)], selectedNoteId: 1 });
    api.create.mockRejectedValue(new Error('写入失败'));

    await useNotesStore.getState().create({
      paperId: 1,
      type: 'manual',
      title: '手动笔记',
      contentMd: '',
      tags: [],
    });

    const state = useNotesStore.getState();
    expect(state.error).toBe('写入失败');
    expect(state.notes.map((note) => note.id)).toEqual([1]);
    expect(state.selectedNoteId).toBe(1);
  });

  it('为其他文献创建笔记时不插入当前过滤列表也不选中', async () => {
    useNotesStore.setState({ paperId: 1, notes: [makeNote(1)], selectedNoteId: 1 });
    api.create.mockResolvedValue(makeNote(99, { paperId: 2, updatedAt: 5_000 }));

    await useNotesStore.getState().create({
      paperId: 2,
      type: 'manual',
      title: '另一篇',
      contentMd: '',
      tags: [],
    });

    const state = useNotesStore.getState();
    expect(state.notes.map((note) => note.id)).toEqual([1]);
    expect(state.selectedNoteId).toBe(1);
  });
});

describe('useNotesStore.update', () => {
  it('保存后用返回的笔记替换列表项并保持选中', async () => {
    const original = makeNote(1, { title: '旧标题', contentMd: '旧正文', updatedAt: 1_000 });
    const updated = makeNote(1, {
      title: '新标题',
      contentMd: '新正文',
      tags: ['方法'],
      updatedAt: 9_000,
    });
    useNotesStore.setState({ paperId: 1, notes: [original], selectedNoteId: 1 });
    api.update.mockResolvedValue(updated);

    await useNotesStore.getState().update(1, {
      title: '新标题',
      contentMd: '新正文',
      tags: ['方法'],
    });

    const state = useNotesStore.getState();
    expect(api.update).toHaveBeenCalledWith(1, {
      title: '新标题',
      contentMd: '新正文',
      tags: ['方法'],
    });
    expect(state.notes[0]).toEqual(updated);
    expect(state.selectedNoteId).toBe(1);
    expect(state.error).toBeNull();
  });

  it('保存失败时写入错误并保留原笔记内容', async () => {
    const original = makeNote(1, { title: '旧标题' });
    useNotesStore.setState({ paperId: 1, notes: [original] });
    api.update.mockRejectedValue(new Error('保存失败'));

    await useNotesStore.getState().update(1, { title: '新标题' });

    const state = useNotesStore.getState();
    expect(state.error).toBe('保存失败');
    expect(state.notes[0]).toEqual(original);
  });
});

describe('useNotesStore.remove', () => {
  it('删除选中的笔记后从列表移除并清空选中项', async () => {
    useNotesStore.setState({
      paperId: 1,
      notes: [makeNote(1), makeNote(2)],
      selectedNoteId: 2,
    });

    await useNotesStore.getState().remove(2);

    const state = useNotesStore.getState();
    expect(api.remove).toHaveBeenCalledWith(2);
    expect(state.notes.map((note) => note.id)).toEqual([1]);
    expect(state.selectedNoteId).toBeNull();
  });

  it('删除其他笔记时保留当前选中项', async () => {
    useNotesStore.setState({
      paperId: 1,
      notes: [makeNote(1), makeNote(2)],
      selectedNoteId: 1,
    });

    await useNotesStore.getState().remove(2);

    expect(useNotesStore.getState().selectedNoteId).toBe(1);
  });

  it('删除失败时写入错误且不移除笔记', async () => {
    useNotesStore.setState({ paperId: 1, notes: [makeNote(1)] });
    api.remove.mockRejectedValue(new Error('删除失败'));

    await useNotesStore.getState().remove(1);

    const state = useNotesStore.getState();
    expect(state.error).toBe('删除失败');
    expect(state.notes.map((note) => note.id)).toEqual([1]);
  });
});

describe('useNotesStore.generate', () => {
  it('总结生成成功后按当前文献过滤器加入列表但不自动打开', async () => {
    useNotesStore.setState({ paperId: 1, notes: [makeNote(1, { updatedAt: 1_000 })] });
    const generated = makeNote(77, { type: 'summary', updatedAt: 7_000 });
    api.generate.mockResolvedValue(generated);

    const result = await useNotesStore.getState().generate('summary', { paperId: 1 });

    const state = useNotesStore.getState();
    expect(result).toEqual(generated);
    expect(api.generate).toHaveBeenCalledWith('summary', { paperId: 1 });
    expect(state.notes[0]?.id).toBe(77);
    expect(state.selectedNoteId).toBeNull();
    expect(state.generating).toBeNull();
    expect(state.error).toBeNull();
  });

  it('概念卡生成成功后自动选中新笔记', async () => {
    useNotesStore.setState({ paperId: 1, notes: [] });
    const generated = makeNote(88, { type: 'concept', updatedAt: 8_000 });
    api.generate.mockResolvedValue(generated);

    await useNotesStore.getState().generate('concept', {
      paperId: 1,
      selectionText: '一段选文',
      conceptTitle: '熵',
      currentPageNo: 3,
    });

    expect(api.generate).toHaveBeenCalledWith('concept', {
      paperId: 1,
      selectionText: '一段选文',
      conceptTitle: '熵',
      currentPageNo: 3,
    });
    expect(useNotesStore.getState().selectedNoteId).toBe(88);
    expect(useNotesStore.getState().notes.map((note) => note.id)).toEqual([88]);
  });

  it('生成结果属于其他文献时不加入当前列表也不选中', async () => {
    useNotesStore.setState({ paperId: 1, notes: [makeNote(1)] });
    api.generate.mockResolvedValue(makeNote(77, { paperId: 2, type: 'summary' }));

    const result = await useNotesStore.getState().generate('summary', { paperId: 2 });

    const state = useNotesStore.getState();
    expect(result).not.toBeNull();
    expect(state.notes.map((note) => note.id)).toEqual([1]);
    expect(state.selectedNoteId).toBeNull();
  });

  it('未限定文献时（全部笔记视图）任何生成结果都加入列表', async () => {
    useNotesStore.setState({ paperId: null, notes: [] });
    api.generate.mockResolvedValue(makeNote(77, { paperId: 2, type: 'summary' }));

    await useNotesStore.getState().generate('summary', { paperId: 2 });

    expect(useNotesStore.getState().notes.map((note) => note.id)).toEqual([77]);
  });

  it('生成返回 null（文献缺失）时列表不变且不报错', async () => {
    const existing = makeNote(1);
    useNotesStore.setState({ paperId: 1, notes: [existing] });
    api.generate.mockResolvedValue(null);

    const result = await useNotesStore.getState().generate('summary', { paperId: 999 });

    const state = useNotesStore.getState();
    expect(result).toBeNull();
    expect(state.notes).toEqual([existing]);
    expect(state.selectedNoteId).toBeNull();
    expect(state.error).toBeNull();
    expect(state.generating).toBeNull();
  });

  it('生成失败时写入错误、重置生成状态并返回 null', async () => {
    useNotesStore.setState({ paperId: 1, notes: [] });
    api.generate.mockRejectedValue(new Error('AI 请求失败'));

    const result = await useNotesStore.getState().generate('innovation', { paperId: 1 });

    const state = useNotesStore.getState();
    expect(result).toBeNull();
    expect(state.error).toBe('AI 请求失败');
    expect(state.notes).toEqual([]);
    expect(state.generating).toBeNull();
  });

  it('生成期间暴露 generating 状态', async () => {
    useNotesStore.setState({ paperId: 1, notes: [] });
    const pending = deferred<Note | null>();
    api.generate.mockReturnValue(pending.promise);

    const task = useNotesStore.getState().generate('summary', { paperId: 1 });
    expect(useNotesStore.getState().generating).toBe('summary');

    pending.resolve(null);
    await task;

    expect(useNotesStore.getState().generating).toBeNull();
  });

  it('已有生成任务时忽略新的生成请求', async () => {
    useNotesStore.setState({ paperId: 1, notes: [] });
    const pending = deferred<Note | null>();
    api.generate.mockReturnValue(pending.promise);

    const first = useNotesStore.getState().generate('summary', { paperId: 1 });
    const second = await useNotesStore.getState().generate('concept', { paperId: 1 });

    expect(second).toBeNull();
    expect(api.generate).toHaveBeenCalledTimes(1);

    pending.resolve(null);
    await first;
  });
});

describe('useNotesStore.selectNote / clearError', () => {
  it('selectNote 设置并清空选中项', () => {
    useNotesStore.getState().selectNote(3);
    expect(useNotesStore.getState().selectedNoteId).toBe(3);

    useNotesStore.getState().selectNote(null);
    expect(useNotesStore.getState().selectedNoteId).toBeNull();
  });

  it('clearError 清除错误信息', () => {
    useNotesStore.setState({ error: '旧错误' });

    useNotesStore.getState().clearError();

    expect(useNotesStore.getState().error).toBeNull();
  });
});
