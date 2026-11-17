// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EngineSettingsTab } from '@renderer/components/settings/EngineSettingsTab';
import { useAppSettingsStore } from '@renderer/stores/app-settings';
import type { AppSettings } from '@shared/types';

const SETTINGS: AppSettings = {
  libraryRoot: 'C:/Library',
  defaultLibraryRoot: 'C:/Library',
  babeldocPath: '',
  babeldocDetectedPath: null,
  aiPanelWidth: 360,
  theme: 'light',
  paperTexture: 45,
  translationQps: 8,
  translationWorkers: 8,
  translationAutoGlossary: true,
  onboarded: true,
};

let update: ReturnType<typeof vi.fn>;

function installApi(): void {
  update = vi.fn(async (patch: Partial<AppSettings>) => ({
    ...SETTINGS,
    ...patch,
  }));
  (window as unknown as { api: unknown }).api = {
    appSettings: {
      get: vi.fn(),
      update,
    },
    translation: {
      engineStatus: vi.fn(async () => ({
        detectedPath: null,
        configuredPath: '',
        uvPath: null,
        busy: false,
      })),
      onToolProgress: vi.fn(() => () => undefined),
      onToolDone: vi.fn(() => () => undefined),
    },
  };
}

beforeEach(() => {
  installApi();
  useAppSettingsStore.setState({
    settings: SETTINGS,
    loading: false,
    error: null,
  });
});

afterEach(cleanup);

describe('EngineSettingsTab performance settings', () => {
  it('夹紧并保存请求速率上限', async () => {
    render(<EngineSettingsTab />);

    const qps = screen.getByLabelText('请求速率上限（QPS）');
    fireEvent.change(qps, { target: { value: '999' } });
    fireEvent.blur(qps);

    await waitFor(() => {
      expect(update).toHaveBeenCalledWith({ translationQps: 512 });
    });
    expect((qps as HTMLInputElement).value).toBe('512');
  });

  it('独立保存并行线程数，不受请求速率影响', async () => {
    render(<EngineSettingsTab />);

    const workers = screen.getByLabelText('并行翻译线程数');
    fireEvent.change(workers, { target: { value: '24' } });
    fireEvent.blur(workers);

    await waitFor(() => {
      expect(update).toHaveBeenCalledWith({ translationWorkers: 24 });
    });
    expect(update).not.toHaveBeenCalledWith(
      expect.objectContaining({ translationQps: expect.anything() }),
    );
  });

  it('夹紧并保存并行线程数上限', async () => {
    render(<EngineSettingsTab />);

    const workers = screen.getByLabelText('并行翻译线程数');
    fireEvent.change(workers, { target: { value: '999' } });
    fireEvent.blur(workers);

    await waitFor(() => {
      expect(update).toHaveBeenCalledWith({ translationWorkers: 512 });
    });
    expect((workers as HTMLInputElement).value).toBe('512');
  });
});
