// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiSettings, AiSettingsInput } from '@shared/types';
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

function makeInput(overrides: Partial<AiSettingsInput> = {}): AiSettingsInput {
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
  const settings = {
    get: vi.fn(async (): Promise<AiSettings> => makeSettings()),
    set: vi.fn(
      async (input: AiSettingsInput): Promise<AiSettings> =>
        makeSettings({
          ...input,
          apiKeySet: input.apiKey !== undefined && input.apiKey !== '',
        }),
    ),
    test: vi.fn(
      async (_input: AiSettingsInput): Promise<{ ok: boolean; error?: string }> => ({ ok: true }),
    ),
  };
  const api = { settings };
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
    loading: false,
    error: null,
    testing: false,
  });
}

beforeEach(() => {
  resetStore();
  api = installApi();
});

describe('useSettingsStore.load', () => {
  it('加载设置并写入状态', async () => {
    const stored = makeSettings({ visionModel: 'qwen-vl-max', apiKeySet: true });
    api.settings.get.mockResolvedValue(stored);

    await useSettingsStore.getState().load();

    const state = useSettingsStore.getState();
    expect(api.settings.get).toHaveBeenCalledTimes(1);
    expect(state.settings).toEqual(stored);
    expect(state.loading).toBe(false);
    expect(state.error).toBeNull();
  });

  it('加载失败时记录错误且不覆盖已有设置', async () => {
    const previous = makeSettings({ baseUrl: 'https://old.example.com' });
    useSettingsStore.setState({ settings: previous });
    api.settings.get.mockRejectedValue(new Error('设置读取失败'));

    await useSettingsStore.getState().load();

    const state = useSettingsStore.getState();
    expect(state.settings).toEqual(previous);
    expect(state.error).toBe('设置读取失败');
    expect(state.loading).toBe(false);
  });
});

describe('useSettingsStore.save', () => {
  it('调用 settings.set 并用返回结果更新状态', async () => {
    const input = makeInput({ apiKey: 'sk-new-key', visionModel: 'gpt-4o-mini' });
    const updated = makeSettings({ apiKeySet: true, visionModel: 'gpt-4o-mini' });
    api.settings.set.mockResolvedValue(updated);

    await useSettingsStore.getState().save(input);

    expect(api.settings.set).toHaveBeenCalledTimes(1);
    expect(api.settings.set).toHaveBeenCalledWith(input);
    expect(useSettingsStore.getState().settings).toEqual(updated);
    expect(useSettingsStore.getState().error).toBeNull();
  });

  it('保存失败时记录错误并抛出，供对话框保持打开', async () => {
    api.settings.set.mockRejectedValue(new Error('设置写入失败'));

    await expect(useSettingsStore.getState().save(makeInput())).rejects.toThrow('设置写入失败');

    expect(useSettingsStore.getState().error).toBe('设置写入失败');
  });
});

describe('useSettingsStore.test', () => {
  it('IPC 抛错时返回 ok:false 并附带原因', async () => {
    const input = makeInput({ apiKey: '' });
    api.settings.test.mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await useSettingsStore.getState().test(input);

    expect(api.settings.test).toHaveBeenCalledWith(input);
    expect(result).toEqual({ ok: false, error: 'ECONNREFUSED' });
    expect(useSettingsStore.getState().testing).toBe(false);
  });

  it('测试期间标记 testing，完成后返回接口结果', async () => {
    const input = makeInput();
    const pending = deferred<{ ok: boolean; error?: string }>();
    api.settings.test.mockImplementation(() => pending.promise);

    const running = useSettingsStore.getState().test(input);
    expect(useSettingsStore.getState().testing).toBe(true);

    pending.resolve({ ok: false, error: '401 密钥无效' });
    const result = await running;

    expect(result).toEqual({ ok: false, error: '401 密钥无效' });
    expect(useSettingsStore.getState().testing).toBe(false);
    expect(api.settings.test).toHaveBeenCalledWith(input);
  });

  it('成功结果原样返回', async () => {
    api.settings.test.mockResolvedValue({ ok: true });

    const result = await useSettingsStore.getState().test(makeInput());

    expect(result).toEqual({ ok: true });
    expect(useSettingsStore.getState().testing).toBe(false);
  });
});
