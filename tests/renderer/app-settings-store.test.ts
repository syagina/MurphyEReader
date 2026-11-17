// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSettings, AppSettingsUpdate } from '@shared/types';
import { useAppSettingsStore } from '@renderer/stores/app-settings';

function makeSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    libraryRoot: 'C:/library',
    defaultLibraryRoot: 'C:/Documents/PaperLens',
    babeldocPath: '',
    babeldocDetectedPath: null,
    aiPanelWidth: 360,
    theme: 'light',
    paperTexture: 45,
    translationQps: 8,
    translationWorkers: 8,
    translationAutoGlossary: true,
    onboarded: false,
    ...overrides,
  };
}

function installApi() {
  const appSettings = {
    get: vi.fn(async (): Promise<AppSettings> => makeSettings()),
    update: vi.fn(
      async (_patch: AppSettingsUpdate): Promise<AppSettings> => makeSettings(),
    ),
  };
  (window as unknown as { api: unknown }).api = { appSettings };
  return appSettings;
}

beforeEach(() => {
  useAppSettingsStore.setState({ settings: null, loading: false, error: null });
});

describe('useAppSettingsStore IPC error display', () => {
  it('load 失败时去掉 Electron 前缀', async () => {
    const api = installApi();
    api.get.mockRejectedValue(
      new Error("Error invoking remote method 'appSettings:get': Error: 请先等待当前任务完成"),
    );

    await useAppSettingsStore.getState().load();

    const state = useAppSettingsStore.getState();
    expect(state.error).toBe('请先等待当前任务完成');
    expect(state.loading).toBe(false);
  });

  it('save 失败时去掉前缀、记录中文消息并继续抛出', async () => {
    const api = installApi();
    api.update.mockRejectedValue(
      new Error(
        "Error invoking remote method 'appSettings:update': Error: 无法运行该翻译引擎，请重新选择",
      ),
    );

    await expect(
      useAppSettingsStore.getState().save({ babeldocPath: 'C:\\Bad\\babeldoc.exe' }),
    ).rejects.toThrow();

    expect(useAppSettingsStore.getState().error).toBe('无法运行该翻译引擎，请重新选择');
  });

  it('无前缀的未知错误原样保留', async () => {
    const api = installApi();
    api.get.mockRejectedValue(new Error('boom'));

    await useAppSettingsStore.getState().load();

    expect(useAppSettingsStore.getState().error).toBe('boom');
  });
});
