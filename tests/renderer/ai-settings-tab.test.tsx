// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiSettingsTab } from '@renderer/components/settings/AiSettingsTab';
import { useSettingsStore } from '@renderer/stores/settings';

function installApi() {
  const openDeepSeekConsole = vi.fn(async () => undefined);
  (window as unknown as { api: unknown }).api = {
    settings: {
      get: vi.fn(),
      set: vi.fn(),
      test: vi.fn(),
      openDeepSeekConsole,
    },
  };
  return { openDeepSeekConsole };
}

function seedSettings() {
  useSettingsStore.setState({
    settings: {
      baseUrl: 'https://old.example.com/v1',
      chatModel: 'old-model',
      visionModel: 'old-vision',
      temperature: 0.3,
      tokenBudget: 100000,
      apiKeySet: true,
    },
    loading: false,
    error: null,
    testing: false,
  });
}

beforeEach(() => {
  installApi();
  seedSettings();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('AiSettingsTab DeepSeek guide', () => {
  it('渲染 DeepSeek 引导卡片', () => {
    render(<AiSettingsTab onClose={vi.fn()} />);

    expect(screen.getByText('推荐使用 DeepSeek API')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: '填入 DeepSeek 配置' }),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: '获取 DeepSeek API Key' }),
    ).toBeTruthy();
  });

  it('一键填入只改 Base URL 与对话模型，不清空密钥和视觉模型', () => {
    render(<AiSettingsTab onClose={vi.fn()} />);
    const vision = screen.getByLabelText('视觉模型') as HTMLInputElement;
    const key = screen.getByLabelText('API Key') as HTMLInputElement;
    fireEvent.change(vision, { target: { value: 'my-vision' } });
    fireEvent.change(key, { target: { value: 'sk-test' } });

    fireEvent.click(screen.getByRole('button', { name: '填入 DeepSeek 配置' }));

    expect(
      (screen.getByLabelText('Base URL') as HTMLInputElement).value,
    ).toBe('https://api.deepseek.com/v1');
    expect(
      (screen.getByLabelText('对话模型') as HTMLInputElement).value,
    ).toBe('deepseek-chat');
    expect((screen.getByLabelText('视觉模型') as HTMLInputElement).value).toBe(
      'my-vision',
    );
    expect((screen.getByLabelText('API Key') as HTMLInputElement).value).toBe(
      'sk-test',
    );
  });

  it('“获取 API Key”调用专用打开接口', async () => {
    const api = installApi();
    render(<AiSettingsTab onClose={vi.fn()} />);

    fireEvent.click(
      screen.getByRole('button', { name: '获取 DeepSeek API Key' }),
    );

    await waitFor(() =>
      expect(api.openDeepSeekConsole).toHaveBeenCalledTimes(1),
    );
  });
});
