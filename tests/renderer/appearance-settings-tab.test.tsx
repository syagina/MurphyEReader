// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PAPER_TEXTURE_DEFAULT } from '@shared/appearance';
import type { AppSettings, AppSettingsUpdate } from '@shared/types';
import { AppearanceSettingsTab } from '@renderer/components/settings/AppearanceSettingsTab';
import { PAPER_TEXTURE_CSS_VAR } from '@renderer/lib/paper-texture';
import { useAppSettingsStore } from '@renderer/stores/app-settings';

function makeSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    libraryRoot: 'C:/library',
    defaultLibraryRoot: 'C:/Documents/PaperLens',
    babeldocPath: '',
    babeldocDetectedPath: null,
    aiPanelWidth: 360,
    theme: 'paper',
    paperTexture: PAPER_TEXTURE_DEFAULT,
    translationQps: 8,
    translationWorkers: 8,
    translationAutoGlossary: true,
    onboarded: true,
    ...overrides,
  };
}

function textureVar(): string {
  return document.documentElement.style.getPropertyValue(PAPER_TEXTURE_CSS_VAR);
}

function installApi(
  update: (patch: AppSettingsUpdate) => Promise<AppSettings> = async (patch) =>
    makeSettings({
      paperTexture: patch.paperTexture ?? PAPER_TEXTURE_DEFAULT,
    }),
): { update: ReturnType<typeof vi.fn> } {
  const updateMock = vi.fn(update);
  (window as unknown as { api: unknown }).api = {
    appSettings: { get: vi.fn(), update: updateMock },
  };
  return { update: updateMock };
}

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.style.removeProperty(PAPER_TEXTURE_CSS_VAR);
  useAppSettingsStore.setState({
    settings: makeSettings(),
    loading: false,
    error: null,
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('AppearanceSettingsTab', () => {
  it('拖动滑块立即预览，松开后保存一次', async () => {
    const api = installApi();
    render(<AppearanceSettingsTab />);

    const slider = screen.getByRole('slider', { name: '纸纹强度' });
    fireEvent.change(slider, { target: { value: '70' } });

    expect(textureVar()).toBe('70');
    expect(api.update).not.toHaveBeenCalled();

    fireEvent.pointerUp(slider);
    fireEvent.blur(slider);

    await vi.waitFor(() => {
      expect(api.update).toHaveBeenCalledTimes(1);
    });
    expect(api.update).toHaveBeenCalledWith({ paperTexture: 70 });
    expect(useAppSettingsStore.getState().settings?.paperTexture).toBe(70);
  });

  it('键盘调整后保存并显示当前百分比', async () => {
    const api = installApi();
    render(<AppearanceSettingsTab />);

    const slider = screen.getByRole('slider', { name: '纸纹强度' });
    fireEvent.change(slider, { target: { value: '23' } });
    fireEvent.keyUp(slider, { key: 'ArrowRight' });

    await vi.waitFor(() => {
      expect(api.update).toHaveBeenCalledWith({ paperTexture: 23 });
    });
    expect(screen.getByText('23%')).toBeTruthy();
  });

  it('保存失败时回滚预览和强度', async () => {
    installApi(async () => {
      throw new Error('disk unavailable');
    });
    render(<AppearanceSettingsTab />);

    const slider = screen.getByRole('slider', { name: '纸纹强度' });
    fireEvent.change(slider, { target: { value: '80' } });
    expect(textureVar()).toBe('80');

    fireEvent.pointerUp(slider);

    await vi.waitFor(() => {
      expect(textureVar()).toBe(String(PAPER_TEXTURE_DEFAULT));
    });
    expect(screen.getByText(`${PAPER_TEXTURE_DEFAULT}%`)).toBeTruthy();
  });

  it('设置尚未加载时禁用滑块', () => {
    useAppSettingsStore.setState({ settings: null });
    render(<AppearanceSettingsTab />);

    const slider = screen.getByRole('slider', { name: '纸纹强度' });
    expect((slider as HTMLInputElement).disabled).toBe(true);
  });
});
