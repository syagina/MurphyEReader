// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Folder } from '@shared/types';
import { useFoldersStore } from '@renderer/stores/folders';

function makeFolder(overrides: Partial<Folder> = {}): Folder {
  return {
    id: 1,
    name: '毕业论文',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function installApi() {
  const folders = {
    list: vi.fn(async (): Promise<Folder[]> => []),
    create: vi.fn(async (name: string): Promise<Folder> => makeFolder({ name })),
    rename: vi.fn(async (id: number, name: string): Promise<Folder> => makeFolder({ id, name })),
    remove: vi.fn(async (_id: number): Promise<void> => undefined),
  };
  (window as unknown as { api: unknown }).api = { folders };
  return folders;
}

let api: ReturnType<typeof installApi>;

beforeEach(() => {
  useFoldersStore.setState({ folders: [], loading: false, error: null });
  api = installApi();
});

describe('useFoldersStore.load', () => {
  it('读取文件夹列表并复位 loading', async () => {
    const folders = [makeFolder({ id: 1 }), makeFolder({ id: 2, name: '方法参考' })];
    api.list.mockResolvedValue(folders);

    await useFoldersStore.getState().load();

    const state = useFoldersStore.getState();
    expect(api.list).toHaveBeenCalledTimes(1);
    expect(state.folders).toEqual(folders);
    expect(state.loading).toBe(false);
    expect(state.error).toBeNull();
  });

  it('读取失败时记录中文错误并复位 loading', async () => {
    api.list.mockRejectedValue(new Error('数据库损坏'));

    await useFoldersStore.getState().load();

    const state = useFoldersStore.getState();
    expect(state.folders).toEqual([]);
    expect(state.loading).toBe(false);
    expect(state.error).toBe('数据库损坏');
  });
});

describe('useFoldersStore.create', () => {
  it('创建后把新文件夹追加到列表末尾', async () => {
    const existing = makeFolder({ id: 1 });
    const created = makeFolder({ id: 2, name: '待读' });
    useFoldersStore.setState({ folders: [existing] });
    api.create.mockResolvedValue(created);

    const returned = await useFoldersStore.getState().create('  待读  ');

    expect(api.create).toHaveBeenCalledWith('  待读  ');
    expect(returned).toEqual(created);
    expect(useFoldersStore.getState().folders).toEqual([existing, created]);
    expect(useFoldersStore.getState().error).toBeNull();
  });

  it('创建失败时记录错误且列表不变', async () => {
    const existing = makeFolder({ id: 1 });
    useFoldersStore.setState({ folders: [existing] });
    api.create.mockRejectedValue(new Error('已有同名文件夹'));

    const returned = await useFoldersStore.getState().create('毕业论文');

    expect(returned).toBeNull();
    expect(useFoldersStore.getState().folders).toEqual([existing]);
    expect(useFoldersStore.getState().error).toBe('已有同名文件夹');
  });

  it('创建失败时去掉 Electron 远程调用前缀再记录', async () => {
    api.create.mockRejectedValue(
      new Error("Error invoking remote method 'folders:create': Error: 已有同名文件夹"),
    );

    const returned = await useFoldersStore.getState().create('毕业论文');

    expect(returned).toBeNull();
    expect(useFoldersStore.getState().error).toBe('已有同名文件夹');
  });
});

describe('useFoldersStore.rename', () => {
  it('重命名后替换列表中的对应项', async () => {
    const first = makeFolder({ id: 1, name: '旧名称' });
    const second = makeFolder({ id: 2, name: '方法参考' });
    const renamed = makeFolder({ id: 1, name: '新名称' });
    useFoldersStore.setState({ folders: [first, second] });
    api.rename.mockResolvedValue(renamed);

    const returned = await useFoldersStore.getState().rename(1, '新名称');

    expect(api.rename).toHaveBeenCalledWith(1, '新名称');
    expect(returned).toEqual(renamed);
    expect(useFoldersStore.getState().folders).toEqual([renamed, second]);
  });

  it('重命名失败时记录错误且列表不变', async () => {
    const existing = makeFolder({ id: 1, name: '旧名称' });
    useFoldersStore.setState({ folders: [existing] });
    api.rename.mockRejectedValue(new Error('文件夹不存在'));

    const returned = await useFoldersStore.getState().rename(1, '新名称');

    expect(returned).toBeNull();
    expect(useFoldersStore.getState().folders).toEqual([existing]);
    expect(useFoldersStore.getState().error).toBe('文件夹不存在');
  });
});

describe('useFoldersStore.remove', () => {
  it('删除后从列表中移除该文件夹', async () => {
    const first = makeFolder({ id: 1 });
    const second = makeFolder({ id: 2, name: '方法参考' });
    useFoldersStore.setState({ folders: [first, second] });

    const removed = await useFoldersStore.getState().remove(1);

    expect(api.remove).toHaveBeenCalledWith(1);
    expect(removed).toBe(true);
    expect(useFoldersStore.getState().folders).toEqual([second]);
  });

  it('删除失败时记录错误且列表不变', async () => {
    const existing = makeFolder({ id: 1 });
    useFoldersStore.setState({ folders: [existing] });
    api.remove.mockRejectedValue(new Error('无法删除文件夹'));

    const removed = await useFoldersStore.getState().remove(1);

    expect(removed).toBe(false);
    expect(useFoldersStore.getState().folders).toEqual([existing]);
    expect(useFoldersStore.getState().error).toBe('无法删除文件夹');
  });
});
