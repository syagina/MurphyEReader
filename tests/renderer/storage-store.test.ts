// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AppSettings,
  FolderImportSummary,
  ImportProgressEvent,
  JobState,
  LegacyMigrationSummary,
  Paper,
  RootChangeResult,
  StorageInfo,
} from '@shared/types';
import { useAppSettingsStore } from '@renderer/stores/app-settings';
import { useStorageStore, IDLE_JOB_STATE } from '@renderer/stores/storage';

type FileCheck = { id: number; originalExists: boolean; translatedExists: boolean };

function makeInfo(overrides: Partial<StorageInfo> = {}): StorageInfo {
  return {
    root: 'C:/library',
    defaultRoot: 'C:/Documents/PaperLens',
    writable: true,
    migration: null,
    error: null,
    ...overrides,
  };
}

function makeRootChange(overrides: Partial<RootChangeResult> = {}): RootChangeResult {
  return {
    root: 'D:/new-library',
    migrated: 2,
    unmanaged: [],
    keptOldCopies: true,
    ...overrides,
  };
}

function makeAppSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    libraryRoot: 'C:/library',
    defaultLibraryRoot: 'C:/Documents/PaperLens',
    babeldocPath: '',
    babeldocDetectedPath: null,
    aiPanelWidth: 360,
    ...overrides,
  };
}

function installApi() {
  const papers = {
    list: vi.fn(async (): Promise<Paper[]> => []),
    checkFiles: vi.fn(async (): Promise<FileCheck[]> => []),
  };
  const storage = {
    getInfo: vi.fn(async (): Promise<StorageInfo> => makeInfo()),
    migrateLegacy: vi.fn(
      async (): Promise<LegacyMigrationSummary> => ({ adopted: 0, skipped: [] }),
    ),
    chooseRoot: vi.fn(async (): Promise<string | null> => null),
    changeRoot: vi.fn(
      async (_newRoot: string): Promise<RootChangeResult> => makeRootChange(),
    ),
    openRoot: vi.fn(async (): Promise<void> => undefined),
    revealPaper: vi.fn(async (_paperId: number): Promise<void> => undefined),
    importFolder: vi.fn(async (): Promise<FolderImportSummary | null> => null),
    cancelImport: vi.fn(async (): Promise<void> => undefined),
    onBusy: vi.fn((_cb: (state: JobState) => void) => () => undefined),
    onMigrated: vi.fn((_cb: (summary: LegacyMigrationSummary) => void) => () => undefined),
    onImportProgress: vi.fn(
      (_cb: (event: ImportProgressEvent) => void) => () => undefined,
    ),
  };
  const appSettings = {
    get: vi.fn(async (): Promise<AppSettings> => makeAppSettings()),
    update: vi.fn(async (): Promise<AppSettings> => makeAppSettings()),
  };
  (window as unknown as { api: unknown }).api = { papers, storage, appSettings };
  return { papers, storage, appSettings };
}

let api: ReturnType<typeof installApi>;
let cleanup: (() => void) | null;

function resetStores(): void {
  useStorageStore.setState({
    info: null,
    busy: IDLE_JOB_STATE,
    loading: false,
    error: null,
    errorDismissed: false,
    lastMigration: null,
    migrationDismissed: false,
    rootChangeNotice: null,
    importProgress: null,
    lastFolderSummary: null,
  });
  useAppSettingsStore.setState({ settings: null, loading: false, error: null });
}

beforeEach(() => {
  resetStores();
  api = installApi();
});

afterEach(() => {
  cleanup?.();
  cleanup = null;
});

describe('useStorageStore.chooseAndChangeRoot', () => {
  it('更改位置后更新根目录、记录旧副本提示并刷新文献库', async () => {
    useStorageStore.setState({ info: makeInfo({ root: 'C:/library' }) });
    api.storage.chooseRoot.mockResolvedValue('D:/new-library');
    api.storage.changeRoot.mockResolvedValue(
      makeRootChange({ root: 'D:/new-library', migrated: 3 }),
    );
    api.storage.getInfo.mockResolvedValue(makeInfo({ root: 'D:/new-library' }));

    await useStorageStore.getState().chooseAndChangeRoot();

    expect(api.storage.changeRoot).toHaveBeenCalledWith('D:/new-library');
    const state = useStorageStore.getState();
    expect(state.info?.root).toBe('D:/new-library');
    expect(state.rootChangeNotice).toBe(
      '已迁移 3 篇文献，旧位置的副本仍保留，可自行清理',
    );
    expect(state.error).toBeNull();
    expect(state.loading).toBe(false);
    expect(api.papers.list).toHaveBeenCalledTimes(1);
    expect(api.papers.checkFiles).toHaveBeenCalledTimes(1);
  });

  it('未托管文献被明确列出，不报告全部完成', async () => {
    useStorageStore.setState({ info: makeInfo() });
    api.storage.chooseRoot.mockResolvedValue('D:/new-library');
    api.storage.changeRoot.mockResolvedValue(
      makeRootChange({
        root: 'D:/new-library',
        migrated: 1,
        unmanaged: [
          { paperId: 5, title: '缺失一' },
          { paperId: 6, title: '缺失二' },
        ],
      }),
    );

    await useStorageStore.getState().chooseAndChangeRoot();

    const notice = useStorageStore.getState().rootChangeNotice ?? '';
    expect(notice).toContain('已迁移 1 篇文献，旧位置的副本仍保留，可自行清理');
    expect(notice).toContain('2 篇未托管（文件缺失），未迁移');
    expect(notice).toContain('缺失一、缺失二');
  });

  it('用户取消目录选择时状态不变', async () => {
    const previous = makeInfo({ root: 'C:/library' });
    useStorageStore.setState({ info: previous });
    api.storage.chooseRoot.mockResolvedValue(null);

    await useStorageStore.getState().chooseAndChangeRoot();

    expect(api.storage.changeRoot).not.toHaveBeenCalled();
    expect(useStorageStore.getState().info).toEqual(previous);
    expect(useStorageStore.getState().rootChangeNotice).toBeNull();
  });

  it('changeRoot 失败时保留旧根目录、清除旧提示并记录中文错误', async () => {
    useStorageStore.setState({
      info: makeInfo({ root: 'C:/library' }),
      rootChangeNotice: '已迁移 2 篇文献，旧位置的副本仍保留，可自行清理',
    });
    api.storage.chooseRoot.mockResolvedValue('E:/blocked');
    api.storage.changeRoot.mockRejectedValue(new Error('新位置不可写，请选择其他文件夹'));

    await useStorageStore.getState().chooseAndChangeRoot();

    const state = useStorageStore.getState();
    expect(state.info?.root).toBe('C:/library');
    expect(state.error).toBe('新位置不可写，请选择其他文件夹');
    expect(state.errorDismissed).toBe(false);
    expect(state.rootChangeNotice).toBeNull();
    expect(api.papers.list).not.toHaveBeenCalled();
    expect(state.loading).toBe(false);
  });
});

describe('useStorageStore.openRoot / revealPaper', () => {
  it('打开根目录与打开文献文件夹都直接调用接口', async () => {
    await useStorageStore.getState().openRoot();
    await useStorageStore.getState().revealPaper(7);

    expect(api.storage.openRoot).toHaveBeenCalledTimes(1);
    expect(api.storage.revealPaper).toHaveBeenCalledWith(7);
  });

  it('打开文件夹失败时向上抛出中文错误', async () => {
    api.storage.revealPaper.mockRejectedValue(new Error('无法打开文件夹：拒绝访问'));

    await expect(useStorageStore.getState().revealPaper(8)).rejects.toThrow(
      '无法打开文件夹：拒绝访问',
    );
  });
});

describe('useStorageStore.loadInfo', () => {
  it('文献库重载失败时保留新的 info 并单独记录错误', async () => {
    api.storage.getInfo.mockResolvedValue(
      makeInfo({ root: 'D:/fresh', migration: { adopted: 1, skipped: [] } }),
    );
    api.papers.list.mockRejectedValue(new Error('文献列表读取失败'));

    await useStorageStore.getState().loadInfo();

    const state = useStorageStore.getState();
    expect(state.info?.root).toBe('D:/fresh');
    expect(state.lastMigration).toEqual({ adopted: 1, skipped: [] });
    expect(state.error).toBe('文献列表读取失败');
    expect(state.loading).toBe(false);
  });

  it('没有较新的操作错误时沿用主进程返回的 info.error', async () => {
    api.storage.getInfo.mockResolvedValue(
      makeInfo({ error: '文献库目录不可写：拒绝访问' }),
    );

    await useStorageStore.getState().loadInfo();

    expect(useStorageStore.getState().error).toBe('文献库目录不可写：拒绝访问');
  });

  it('优先保留较新的 store 错误，而不是被 info.error 覆盖', async () => {
    useStorageStore.setState({
      info: makeInfo({ error: '旧错误' }),
      error: '新错误',
      errorDismissed: false,
    });
    api.storage.getInfo.mockResolvedValue(makeInfo({ error: '主进程旧错误' }));

    await useStorageStore.getState().loadInfo();

    expect(useStorageStore.getState().error).toBe('新错误');
  });

  it('关闭错误后，后续 getInfo 不再重新显示已关闭的横幅', async () => {
    useStorageStore.setState({
      info: makeInfo({ error: '文献库目录不可写：拒绝访问' }),
      error: null,
    });
    useStorageStore.getState().dismissError();

    expect(useStorageStore.getState().info?.error).toBeNull();
    expect(useStorageStore.getState().errorDismissed).toBe(true);

    api.storage.getInfo.mockResolvedValue(
      makeInfo({ error: '文献库目录不可写：拒绝访问' }),
    );
    await useStorageStore.getState().loadInfo();

    const state = useStorageStore.getState();
    expect(state.error).toBeNull();
    expect(state.info?.error).toBeNull();
  });

  it('已关闭错误后新的操作错误重新显示', async () => {
    useStorageStore.setState({ errorDismissed: true, error: null });
    useStorageStore.setState({ info: makeInfo() });
    api.storage.chooseRoot.mockResolvedValue('E:/blocked');
    api.storage.changeRoot.mockRejectedValue(new Error('新位置不可写，请选择其他文件夹'));

    await useStorageStore.getState().chooseAndChangeRoot();

    expect(useStorageStore.getState().error).toBe('新位置不可写，请选择其他文件夹');
    expect(useStorageStore.getState().errorDismissed).toBe(false);
  });
});

describe('useStorageStore import folder', () => {
  const summary: FolderImportSummary = {
    imported: 2,
    skipped: 1,
    failed: [{ file: 'C:/inbox/bad.pdf', message: '无法读取 PDF：损坏' }],
    canceled: false,
  };

  it('完成后保存摘要、清空进度并刷新文献库', async () => {
    api.storage.importFolder.mockResolvedValue(summary);

    const result = await useStorageStore.getState().importFolder();

    expect(result).toEqual(summary);
    const state = useStorageStore.getState();
    expect(state.lastFolderSummary).toEqual(summary);
    expect(state.importProgress).toBeNull();
    expect(state.error).toBeNull();
    expect(api.papers.list).toHaveBeenCalledTimes(1);
    expect(api.papers.checkFiles).toHaveBeenCalledTimes(1);
  });

  it('取消目录选择时返回 null 且不刷新文献库', async () => {
    api.storage.importFolder.mockResolvedValue(null);

    const result = await useStorageStore.getState().importFolder();

    expect(result).toBeNull();
    expect(useStorageStore.getState().lastFolderSummary).toBeNull();
    expect(api.papers.list).not.toHaveBeenCalled();
  });

  it('导入失败时记录中文错误、清空进度且不显示摘要', async () => {
    api.storage.importFolder.mockRejectedValue(new Error('无法读取文件夹：拒绝访问'));

    const result = await useStorageStore.getState().importFolder();

    expect(result).toBeNull();
    const state = useStorageStore.getState();
    expect(state.error).toBe('无法读取文件夹：拒绝访问');
    expect(state.errorDismissed).toBe(false);
    expect(state.lastFolderSummary).toBeNull();
    expect(state.importProgress).toBeNull();
    expect(api.papers.list).not.toHaveBeenCalled();
  });

  it('取消导入直接调用接口，失败时记录错误', async () => {
    await useStorageStore.getState().cancelImport();
    expect(api.storage.cancelImport).toHaveBeenCalledTimes(1);

    api.storage.cancelImport.mockRejectedValue(new Error('取消失败'));
    await useStorageStore.getState().cancelImport();
    expect(useStorageStore.getState().error).toBe('取消失败');
  });

  it('关闭摘要后不再显示', () => {
    useStorageStore.setState({ lastFolderSummary: summary });

    useStorageStore.getState().dismissFolderSummary();

    expect(useStorageStore.getState().lastFolderSummary).toBeNull();
  });
});

describe('useStorageStore.init 导入进度', () => {
  it('订阅导入进度，done 时清空横幅', async () => {
    const listeners: { progress?: (event: ImportProgressEvent) => void } = {};
    api.storage.onImportProgress.mockImplementation((cb) => {
      listeners.progress = cb;
      return () => undefined;
    });

    cleanup = useStorageStore.getState().init();
    await vi.waitFor(() => {
      expect(api.storage.getInfo).toHaveBeenCalled();
    });
    expect(listeners.progress).toBeDefined();

    listeners.progress!({
      jobId: 'job-1',
      phase: 'copy',
      current: 2,
      total: 5,
      file: 'C:/inbox/b.pdf',
    });
    expect(useStorageStore.getState().importProgress).toMatchObject({
      phase: 'copy',
      current: 2,
      total: 5,
    });

    listeners.progress!({ jobId: 'job-1', phase: 'done', current: 5, total: 5, file: '' });
    expect(useStorageStore.getState().importProgress).toBeNull();
  });
});

describe('useStorageStore.init', () => {
  it('迁移事件的文献重载失败被捕获为 store 错误，不产生未处理的拒绝', async () => {
    const listeners: { migrated?: (summary: LegacyMigrationSummary) => void } = {};
    api.storage.onMigrated.mockImplementation((cb) => {
      listeners.migrated = cb;
      return () => undefined;
    });
    api.papers.list.mockRejectedValue(new Error('文献列表读取失败'));

    cleanup = useStorageStore.getState().init();
    await vi.waitFor(() => {
      expect(api.storage.getInfo).toHaveBeenCalled();
    });
    expect(listeners.migrated).toBeDefined();

    listeners.migrated!({ adopted: 1, skipped: [] });

    await vi.waitFor(() => {
      expect(useStorageStore.getState().error).toBe('文献列表读取失败');
    });
    expect(useStorageStore.getState().lastMigration).toEqual({ adopted: 1, skipped: [] });
  });
});
