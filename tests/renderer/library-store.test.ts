// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PaperLensApi } from '@shared/ipc';
import type { Paper } from '@shared/types';
import { useLibraryStore } from '@renderer/stores/library';

type PaperUpdatePatch = Parameters<PaperLensApi['papers']['update']>[1];

type FileCheck = { id: number; originalExists: boolean; translatedExists: boolean };

function makePaper(overrides: Partial<Paper> = {}): Paper {
  return {
    id: 1,
    title: '有限元方法导论',
    authors: '张三, 李四',
    year: 2020,
    filePathOriginal: 'C:/papers/fem.pdf',
    filePathTranslated: null,
    pageCountOriginal: 120,
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
  const papers = {
    list: vi.fn(async (): Promise<Paper[]> => []),
    importOriginal: vi.fn(async (): Promise<Paper | null> => null),
    attachTranslated: vi.fn(async (_id: number): Promise<Paper | null> => null),
    update: vi.fn(
      async (_id: number, _patch: PaperUpdatePatch): Promise<Paper> => makePaper(),
    ),
    remove: vi.fn(async (_id: number): Promise<void> => undefined),
    checkFiles: vi.fn(async (): Promise<FileCheck[]> => []),
    relocate: vi.fn(
      async (_id: number, _version: 'original' | 'translated'): Promise<Paper | null> => null,
    ),
  };
  (window as unknown as { api: unknown }).api = { papers };
  return papers;
}

let api: ReturnType<typeof installApi>;

beforeEach(() => {
  useLibraryStore.setState({ papers: [], loading: false, fileStatus: {} });
  api = installApi();
});

describe('useLibraryStore.load', () => {
  it('读取文献列表与文件状态', async () => {
    const papers = [
      makePaper({ id: 1, title: '第一篇' }),
      makePaper({ id: 2, title: '第二篇', addedAt: 2000 }),
    ];
    api.list.mockResolvedValue(papers);
    api.checkFiles.mockResolvedValue([
      { id: 1, originalExists: true, translatedExists: false },
      { id: 2, originalExists: false, translatedExists: true },
    ]);

    await useLibraryStore.getState().load();

    const state = useLibraryStore.getState();
    expect(state.papers).toHaveLength(2);
    expect(state.papers.map((paper) => paper.id)).toEqual([1, 2]);
    expect(state.loading).toBe(false);
    expect(state.fileStatus[1]).toEqual({ originalExists: true, translatedExists: false });
    expect(state.fileStatus[2].originalExists).toBe(false);
    expect(state.fileStatus[2].translatedExists).toBe(true);
  });

  it('失败时向上抛错并复位 loading', async () => {
    api.list.mockRejectedValue(new Error('数据库损坏'));

    await expect(useLibraryStore.getState().load()).rejects.toThrow('数据库损坏');

    expect(useLibraryStore.getState().loading).toBe(false);
  });
});

describe('useLibraryStore.importPaper', () => {
  it('把新文献插到列表最前并记录文件状态', async () => {
    useLibraryStore.setState({ papers: [makePaper({ id: 1 }), makePaper({ id: 2 })] });
    const imported = makePaper({ id: 3, title: '新导入文献' });
    api.importOriginal.mockResolvedValue(imported);

    await useLibraryStore.getState().importPaper();

    const state = useLibraryStore.getState();
    expect(state.papers).toHaveLength(3);
    expect(state.papers[0]).toEqual(imported);
    expect(state.fileStatus[3]).toEqual({ originalExists: true, translatedExists: false });
  });

  it('用户取消导入时列表不变', async () => {
    useLibraryStore.setState({ papers: [makePaper({ id: 1 })] });
    api.importOriginal.mockResolvedValue(null);

    await useLibraryStore.getState().importPaper();

    expect(useLibraryStore.getState().papers).toHaveLength(1);
  });
});

describe('useLibraryStore.removePaper', () => {
  it('删除文献并清除对应文件状态', async () => {
    useLibraryStore.setState({
      papers: [makePaper({ id: 1 }), makePaper({ id: 2 })],
      fileStatus: {
        1: { originalExists: true, translatedExists: false },
        2: { originalExists: true, translatedExists: true },
      },
    });
    api.remove.mockResolvedValue(undefined);

    await useLibraryStore.getState().removePaper(1);

    expect(api.remove).toHaveBeenCalledWith(1);
    const state = useLibraryStore.getState();
    expect(state.papers.map((paper) => paper.id)).toEqual([2]);
    expect(state.fileStatus[1]).toBeUndefined();
    expect(state.fileStatus[2]).toEqual({ originalExists: true, translatedExists: true });
  });
});

describe('useLibraryStore.relocate', () => {
  it('重新定位后调用 load 刷新列表与文件状态', async () => {
    const before = [makePaper({ id: 1 }), makePaper({ id: 2, title: '旧标题' })];
    const updated = makePaper({
      id: 2,
      title: '新标题',
      filePathOriginal: 'D:/papers/new.pdf',
      addedAt: 2000,
    });
    api.relocate.mockResolvedValue(updated);
    api.list.mockResolvedValueOnce(before).mockResolvedValueOnce([makePaper({ id: 1 }), updated]);
    api.checkFiles.mockResolvedValue([
      { id: 1, originalExists: true, translatedExists: false },
      { id: 2, originalExists: true, translatedExists: false },
    ]);

    await useLibraryStore.getState().load();
    await useLibraryStore.getState().relocate(2, 'original');

    expect(api.relocate).toHaveBeenCalledWith(2, 'original');
    expect(api.list).toHaveBeenCalledTimes(2);
    expect(api.checkFiles).toHaveBeenCalledTimes(2);
    const state = useLibraryStore.getState();
    expect(state.papers.find((paper) => paper.id === 2)?.title).toBe('新标题');
    expect(state.fileStatus[2]).toEqual({ originalExists: true, translatedExists: false });
  });
});

describe('useLibraryStore.attachTranslated', () => {
  it('替换列表中的文献并标记译本存在', async () => {
    const bound = makePaper({
      id: 2,
      filePathTranslated: 'D:/papers/zh.pdf',
      pageCountTranslated: 130,
    });
    useLibraryStore.setState({
      papers: [makePaper({ id: 1 }), makePaper({ id: 2 })],
      fileStatus: { 2: { originalExists: true, translatedExists: false } },
    });
    api.attachTranslated.mockResolvedValue(bound);

    await useLibraryStore.getState().attachTranslated(2);

    const state = useLibraryStore.getState();
    expect(api.attachTranslated).toHaveBeenCalledWith(2);
    expect(state.papers[1]).toEqual(bound);
    expect(state.fileStatus[2]).toEqual({ originalExists: true, translatedExists: true });
  });
});

describe('useLibraryStore.updateMeta', () => {
  it('用接口返回的文献替换列表项', async () => {
    const patch: PaperUpdatePatch = { title: '改后标题', year: 2021, tags: ['有限元'] };
    const updated = makePaper({ id: 2, title: '改后标题', year: 2021, tags: ['有限元'] });
    useLibraryStore.setState({ papers: [makePaper({ id: 1 }), makePaper({ id: 2 })] });
    api.update.mockResolvedValue(updated);

    await useLibraryStore.getState().updateMeta(2, patch);

    expect(api.update).toHaveBeenCalledWith(2, patch);
    expect(useLibraryStore.getState().papers[1]).toEqual(updated);
  });
});
