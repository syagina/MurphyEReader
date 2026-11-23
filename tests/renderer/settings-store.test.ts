// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AiProfile,
  AiProfileInput,
  AiSettings,
  AiSettingsInput,
  AiSpeedTestResult,
} from '@shared/types';
import { useSettingsStore } from '@renderer/stores/settings';

function makeSettings(overrides: Partial<AiSettings> = {}): AiSettings {
  return {
    baseUrl: 'https://api.example.com/v1',
    chatModel: 'gpt-4o',
    visionModel: 'gpt-4o-mini',
    temperature: 0.3,
    tokenBudget: 100000,
    apiKeySet: false,
    ...overrides,
  };
}

function makeProfile(overrides: Partial<AiProfile> = {}): AiProfile {
  return {
    id: 1,
    name: 'DeepSeek 官方',
    baseUrl: 'https://api.example.com/v1',
    chatModel: 'gpt-4o',
    visionModel: 'gpt-4o-mini',
    temperature: 0.3,
    tokenBudget: 100000,
    apiKeySet: true,
    active: true,
    createdAt: 1,
    ...overrides,
  };
}

function makeInput(overrides: Partial<AiProfileInput> = {}): AiProfileInput {
  return {
    name: 'DeepSeek 官方',
    baseUrl: 'https://api.example.com/v1',
    chatModel: 'gpt-4o',
    visionModel: 'gpt-4o-mini',
    temperature: 0.3,
    tokenBudget: 100000,
    ...overrides,
  };
}

function makeTestInput(overrides: Partial<AiSettingsInput> = {}): AiSettingsInput {
  return {
    baseUrl: 'https://api.example.com/v1',
    chatModel: 'gpt-4o',
    visionModel: 'gpt-4o-mini',
    temperature: 0.3,
    tokenBudget: 100000,
    ...overrides,
  };
}

function installApi() {
  const first = makeProfile();
  const api = {
    settings: {
      get: vi.fn(async (): Promise<AiSettings> => makeSettings()),
      test: vi.fn(
        async (
          _input: AiSettingsInput,
          _profileId?: number | null,
        ): Promise<{ ok: boolean; error?: string }> => ({ ok: true }),
      ),
      openDeepSeekConsole: vi.fn(async () => undefined),
    },
    aiProfiles: {
      list: vi.fn(async (): Promise<AiProfile[]> => [first]),
      create: vi.fn(async (input: AiProfileInput): Promise<AiProfile> =>
        makeProfile({ id: 2, name: input.name, active: false }),
      ),
      update: vi.fn(async (id: number, input: AiProfileInput): Promise<AiProfile> =>
        makeProfile({ id, name: input.name }),
      ),
      remove: vi.fn(async () => undefined),
      activate: vi.fn(async () => undefined),
      speedTestAll: vi.fn(async (): Promise<AiSpeedTestResult[]> => []),
    },
  };
  (window as unknown as { api: unknown }).api = api;
  return api;
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

let api: ReturnType<typeof installApi>;

function resetStore(): void {
  useSettingsStore.setState({
    settings: null,
    profiles: [],
    loading: false,
    error: null,
    testing: false,
    testingAll: false,
    speedResults: {},
  });
}

beforeEach(() => {
  resetStore();
  api = installApi();
});

describe('useSettingsStore.load', () => {
  it('同时加载当前设置与档案列表', async () => {
    const stored = makeSettings({ visionModel: 'qwen-vl-max', apiKeySet: true });
    const profiles = [makeProfile({ id: 3, name: '中转 A', active: false })];
    api.settings.get.mockResolvedValue(stored);
    api.aiProfiles.list.mockResolvedValue(profiles);

    await useSettingsStore.getState().load();

    const state = useSettingsStore.getState();
    expect(api.settings.get).toHaveBeenCalledTimes(1);
    expect(api.aiProfiles.list).toHaveBeenCalledTimes(1);
    expect(state.settings).toEqual(stored);
    expect(state.profiles).toEqual(profiles);
    expect(state.loading).toBe(false);
    expect(state.error).toBeNull();
  });

  it('加载失败时记录错误且不覆盖已有数据', async () => {
    const previousSettings = makeSettings({ baseUrl: 'https://old.example.com' });
    const previousProfiles = [makeProfile({ id: 9, name: '旧配置' })];
    useSettingsStore.setState({
      settings: previousSettings,
      profiles: previousProfiles,
    });
    api.settings.get.mockRejectedValue(new Error('设置读取失败'));

    await useSettingsStore.getState().load();

    const state = useSettingsStore.getState();
    expect(state.settings).toEqual(previousSettings);
    expect(state.profiles).toEqual(previousProfiles);
    expect(state.error).toBe('设置读取失败');
    expect(state.loading).toBe(false);
  });
});

describe('useSettingsStore 档案操作', () => {
  it('create 调用接口并刷新列表', async () => {
    const input = makeInput({ name: '中转 B' });
    const created = makeProfile({ id: 4, name: '中转 B', active: false });
    api.aiProfiles.create.mockResolvedValue(created);
    api.aiProfiles.list.mockResolvedValue([makeProfile(), created]);

    const result = await useSettingsStore.getState().create(input);

    expect(api.aiProfiles.create).toHaveBeenCalledWith(input);
    expect(result).toEqual(created);
    expect(useSettingsStore.getState().profiles).toEqual([makeProfile(), created]);
  });

  it('update 调用接口、丢弃该档案旧测速结果并刷新列表', async () => {
    const input = makeInput({ name: '新名字' });
    const updated = makeProfile({ id: 1, name: '新名字' });
    api.aiProfiles.update.mockResolvedValue(updated);
    api.aiProfiles.list.mockResolvedValue([updated]);
    useSettingsStore.setState({
      speedResults: {
        1: { profileId: 1, ok: true, firstTokenMs: 100, totalMs: 200 },
      },
    });

    await useSettingsStore.getState().update(1, input);

    expect(api.aiProfiles.update).toHaveBeenCalledWith(1, input);
    expect(useSettingsStore.getState().profiles).toEqual([updated]);
    expect(useSettingsStore.getState().speedResults).toEqual({});
  });

  it('remove 调用接口、丢弃该档案测速结果并刷新列表', async () => {
    useSettingsStore.setState({
      speedResults: {
        1: { profileId: 1, ok: true, firstTokenMs: 100, totalMs: 200 },
        2: { profileId: 2, ok: true, firstTokenMs: 50, totalMs: 100 },
      },
    });

    await useSettingsStore.getState().remove(1);

    expect(api.aiProfiles.remove).toHaveBeenCalledWith(1);
    expect(useSettingsStore.getState().speedResults).toEqual({
      2: { profileId: 2, ok: true, firstTokenMs: 50, totalMs: 100 },
    });
  });

  it('activate 调用接口并刷新当前设置', async () => {
    const activated = makeProfile({ id: 2, baseUrl: 'https://b.example.com/v1' });
    api.settings.get.mockResolvedValue(makeSettings({ baseUrl: activated.baseUrl }));
    api.aiProfiles.list.mockResolvedValue([activated]);

    await useSettingsStore.getState().activate(2);

    expect(api.aiProfiles.activate).toHaveBeenCalledWith(2);
    expect(useSettingsStore.getState().settings?.baseUrl).toBe(
      'https://b.example.com/v1',
    );
  });

  it('create 失败时记录错误并抛出', async () => {
    api.aiProfiles.create.mockRejectedValue(new Error('名称重复'));

    await expect(useSettingsStore.getState().create(makeInput())).rejects.toThrow(
      '名称重复',
    );

    expect(useSettingsStore.getState().error).toBe('名称重复');
  });
});

describe('useSettingsStore.test', () => {
  it('把档案 id 一并传给主进程，供空密钥回退', async () => {
    const input = makeTestInput({ apiKey: '' });
    api.settings.test.mockResolvedValue({ ok: true });

    const result = await useSettingsStore.getState().test(input, 7);

    expect(api.settings.test).toHaveBeenCalledWith(input, 7);
    expect(result).toEqual({ ok: true });
  });

  it('IPC 抛错时返回 ok:false 并附带原因', async () => {
    api.settings.test.mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await useSettingsStore.getState().test(makeTestInput(), null);

    expect(result).toEqual({ ok: false, error: 'ECONNREFUSED' });
    expect(useSettingsStore.getState().testing).toBe(false);
  });

  it('测试期间标记 testing，完成后返回接口结果', async () => {
    const pending = deferred<{ ok: boolean; error?: string }>();
    api.settings.test.mockImplementation(() => pending.promise);

    const running = useSettingsStore.getState().test(makeTestInput(), null);
    expect(useSettingsStore.getState().testing).toBe(true);

    pending.resolve({ ok: false, error: '401 密钥无效' });
    const result = await running;

    expect(result).toEqual({ ok: false, error: '401 密钥无效' });
    expect(useSettingsStore.getState().testing).toBe(false);
  });
});

describe('useSettingsStore.speedTestAll', () => {
  it('把并发测速结果按档案 id 存入状态', async () => {
    const results: AiSpeedTestResult[] = [
      { profileId: 1, ok: true, firstTokenMs: 120, totalMs: 300 },
      { profileId: 2, ok: false, error: '请求超时' },
    ];
    const pending = deferred<AiSpeedTestResult[]>();
    api.aiProfiles.speedTestAll.mockImplementation(() => pending.promise);

    const running = useSettingsStore.getState().speedTestAll();
    expect(useSettingsStore.getState().testingAll).toBe(true);

    pending.resolve(results);
    await running;

    expect(useSettingsStore.getState().speedResults).toEqual({
      1: results[0],
      2: results[1],
    });
    expect(useSettingsStore.getState().testingAll).toBe(false);
  });

  it('批量测速失败时记录错误并结束 testingAll', async () => {
    api.aiProfiles.speedTestAll.mockRejectedValue(new Error('解密失败'));

    await useSettingsStore.getState().speedTestAll();

    expect(useSettingsStore.getState().error).toBe('解密失败');
    expect(useSettingsStore.getState().testingAll).toBe(false);
  });
});
