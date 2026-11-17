// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsDialog } from '@renderer/components/SettingsDialog';
import { useAppSettingsStore } from '@renderer/stores/app-settings';

vi.mock('@renderer/components/settings/AiSettingsTab', () => ({
  AiSettingsTab: () => null,
}));
vi.mock('@renderer/components/settings/EngineSettingsTab', () => ({
  EngineSettingsTab: () => null,
}));
vi.mock('@renderer/components/settings/LibrarySettingsTab', () => ({
  LibrarySettingsTab: () => null,
}));

function installApi() {
  (window as unknown as { api: unknown }).api = {
    appSettings: {
      get: vi.fn(async () => ({
        libraryRoot: '',
        defaultLibraryRoot: '',
        babeldocPath: '',
        babeldocDetectedPath: null,
        aiPanelWidth: 360,
        theme: 'light',
        paperTexture: 45,
        translationQps: 8,
        translationWorkers: 8,
        translationAutoGlossary: true,
        onboarded: true,
      })),
      update: vi.fn(),
      getOnboarding: vi.fn(async () => ({ onboarded: true })),
    },
  };
}

beforeEach(() => {
  installApi();
  useAppSettingsStore.setState({ settings: null, loading: false, error: null });
});

afterEach(cleanup);

describe('SettingsDialog tabs', () => {
  it('设置分类包含外观，纸纹强度在设置页调节，主题仍只在顶栏切换', async () => {
    render(<SettingsDialog onClose={vi.fn()} />);

    const labels = screen.getAllByRole('tab').map((tab) => tab.textContent);
    expect(labels).toEqual(['AI 接口', '文献库', '翻译引擎', '外观', '教程']);

    fireEvent.click(screen.getByRole('tab', { name: '外观' }));

    expect(
      await screen.findByRole('slider', { name: '纸纹强度' }),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: '浅色' })).toBeNull();
    expect(screen.queryByRole('button', { name: '纸感' })).toBeNull();
  });

  it('教程页集中放置新手引导和快捷键，其他标签页不重复显示', async () => {
    const onReplay = vi.fn();
    render(
      <SettingsDialog onClose={vi.fn()} onReplayOnboarding={onReplay} />,
    );

    expect(screen.queryByRole('region', { name: '新手引导' })).toBeNull();
    expect(screen.queryByRole('region', { name: '快捷键' })).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: '教程' }));

    expect(
      await screen.findByRole('region', { name: '新手引导' }),
    ).toBeTruthy();
    expect(screen.getByRole('region', { name: '快捷键' })).toBeTruthy();
    expect(screen.getByText('Ctrl+Shift+T')).toBeTruthy();

    fireEvent.click(
      screen.getByRole('button', { name: '重新查看新手引导' }),
    );
    expect(onReplay).toHaveBeenCalledTimes(1);
  });

  it('未提供回调时教程页说明引导暂不可用', () => {
    render(<SettingsDialog onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('tab', { name: '教程' }));

    expect(
      screen.queryByRole('button', { name: '重新查看新手引导' }),
    ).toBeNull();
    expect(screen.getByText('新手引导暂不可用。')).toBeTruthy();
  });
});
