// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiSettingsTab } from '@renderer/components/settings/AiSettingsTab';
import { useSettingsStore } from '@renderer/stores/settings';
import type { AiProfile, AiSettings } from '@shared/types';

function makeProfile(overrides: Partial<AiProfile> = {}): AiProfile {
  return {
    id: 1,
    name: 'DeepSeek 官方',
    baseUrl: 'https://api.deepseek.com/v1',
    chatModel: 'deepseek-chat',
    visionModel: 'deepseek-vl',
    temperature: 0.3,
    tokenBudget: 100000,
    apiKeySet: true,
    active: true,
    createdAt: 1,
    ...overrides,
  };
}

const ACTIVE = makeProfile();
const SPARE = makeProfile({
  id: 2,
  name: '中转 A',
  baseUrl: 'https://relay.example.com/v1',
  chatModel: 'deepseek-reasoner',
  temperature: 0.6,
  active: false,
  createdAt: 2,
});

function makeSettings(): AiSettings {
  return {
    baseUrl: ACTIVE.baseUrl,
    chatModel: ACTIVE.chatModel,
    visionModel: ACTIVE.visionModel,
    temperature: ACTIVE.temperature,
    tokenBudget: ACTIVE.tokenBudget,
    apiKeySet: true,
  };
}

function installApi() {
  const openDeepSeekConsole = vi.fn(async () => undefined);
  const profiles: AiProfile[] = [{ ...ACTIVE }, { ...SPARE }];
  const aiProfiles = {
    list: vi.fn(async (): Promise<AiProfile[]> => profiles.map((profile) => ({ ...profile }))),
    create: vi.fn(async (input: { name: string }): Promise<AiProfile> => {
      const created = makeProfile({
        id: profiles.length + 1,
        name: input.name,
        active: false,
        createdAt: profiles.length + 1,
      });
      profiles.push(created);
      return { ...created };
    }),
    update: vi.fn(async (id: number, input: { name: string }): Promise<AiProfile> => {
      const index = profiles.findIndex((profile) => profile.id === id);
      const updated = { ...profiles[index], name: input.name };
      profiles[index] = updated;
      return { ...updated };
    }),
    remove: vi.fn(async () => undefined),
    activate: vi.fn(async (id: number) => {
      for (const profile of profiles) {
        profile.active = profile.id === id;
      }
    }),
    speedTestAll: vi.fn(async () => []),
  };
  (window as unknown as { api: unknown }).api = {
    settings: {
      get: vi.fn(async (): Promise<AiSettings> => makeSettings()),
      test: vi.fn(async () => ({ ok: true })),
      openDeepSeekConsole,
    },
    aiProfiles,
  };
  return { openDeepSeekConsole, aiProfiles, profiles };
}

function seedStore(profiles: AiProfile[]) {
  useSettingsStore.setState({
    settings: makeSettings(),
    profiles: profiles.map((profile) => ({ ...profile })),
    loading: false,
    error: null,
    testing: false,
    testingAll: false,
    speedResults: {},
  });
}

let api: ReturnType<typeof installApi>;

beforeEach(() => {
  api = installApi();
  seedStore(api.profiles);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('AiSettingsTab DeepSeek guide', () => {
  it('渲染 DeepSeek 引导卡片', async () => {
    render(<AiSettingsTab onClose={vi.fn()} />);

    expect(screen.getByText('推荐使用 DeepSeek API')).toBeTruthy();
    expect(screen.getByRole('button', { name: '填入 DeepSeek 配置' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '获取 DeepSeek API Key' })).toBeTruthy();
    await screen.findByDisplayValue('DeepSeek 官方');
  });

  it('一键填入只改 Base URL 与对话模型，不清空密钥和视觉模型', async () => {
    render(<AiSettingsTab onClose={vi.fn()} />);
    await screen.findByDisplayValue('DeepSeek 官方');
    const vision = screen.getByLabelText('视觉模型') as HTMLInputElement;
    const key = screen.getByLabelText('API Key') as HTMLInputElement;
    fireEvent.change(vision, { target: { value: 'my-vision' } });
    fireEvent.change(key, { target: { value: 'sk-test' } });

    fireEvent.click(screen.getByRole('button', { name: '填入 DeepSeek 配置' }));

    expect((screen.getByLabelText('Base URL') as HTMLInputElement).value).toBe(
      'https://api.deepseek.com/v1',
    );
    expect((screen.getByLabelText('对话模型') as HTMLInputElement).value).toBe(
      'deepseek-chat',
    );
    expect((screen.getByLabelText('视觉模型') as HTMLInputElement).value).toBe(
      'my-vision',
    );
    expect((screen.getByLabelText('API Key') as HTMLInputElement).value).toBe(
      'sk-test',
    );
  });

  it('“获取 API Key”调用专用打开接口', async () => {
    render(<AiSettingsTab onClose={vi.fn()} />);
    await screen.findByDisplayValue('DeepSeek 官方');

    fireEvent.click(screen.getByRole('button', { name: '获取 DeepSeek API Key' }));

    await waitFor(() => expect(api.openDeepSeekConsole).toHaveBeenCalledTimes(1));
  });
});

describe('AiSettingsTab 配置档案', () => {
  it('列出全部档案并标记当前使用', async () => {
    render(<AiSettingsTab onClose={vi.fn()} />);

    expect(await screen.findByRole('button', { name: /DeepSeek 官方/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /中转 A/ })).toBeTruthy();
    expect(screen.getByText('使用中')).toBeTruthy();
    expect(screen.getByRole('button', { name: '设为当前' })).toBeTruthy();
  });

  it('选中其他档案后用其字段填充表单', async () => {
    render(<AiSettingsTab onClose={vi.fn()} />);
    await screen.findByDisplayValue('DeepSeek 官方');

    fireEvent.click(screen.getByRole('button', { name: /中转 A/ }));

    await waitFor(() =>
      expect((screen.getByLabelText('配置名称') as HTMLInputElement).value).toBe(
        '中转 A',
      ),
    );
    expect((screen.getByLabelText('Base URL') as HTMLInputElement).value).toBe(
      'https://relay.example.com/v1',
    );
    expect((screen.getByLabelText('对话模型') as HTMLInputElement).value).toBe(
      'deepseek-reasoner',
    );
  });

  it('保存所选档案调用 update 并刷新表单', async () => {
    render(<AiSettingsTab onClose={vi.fn()} />);
    await screen.findByDisplayValue('DeepSeek 官方');
    fireEvent.change(screen.getByLabelText('配置名称'), {
      target: { value: '官方主源' },
    });

    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() =>
      expect(api.aiProfiles.update).toHaveBeenCalledWith(1, expect.objectContaining({
        name: '官方主源',
        baseUrl: 'https://api.deepseek.com/v1',
        chatModel: 'deepseek-chat',
        temperature: 0.3,
        tokenBudget: 100000,
      })),
    );
    expect(await screen.findByText('已保存「官方主源」')).toBeTruthy();
  });

  it('新建配置调用 create', async () => {
    render(<AiSettingsTab onClose={vi.fn()} />);
    await screen.findByDisplayValue('DeepSeek 官方');

    fireEvent.click(screen.getByRole('button', { name: '＋ 新建配置' }));
    await screen.findByRole('button', { name: '保存为新配置' });
    fireEvent.change(screen.getByLabelText('配置名称'), {
      target: { value: '备用源' },
    });
    fireEvent.change(screen.getByLabelText('Base URL'), {
      target: { value: 'https://backup.example.com/v1' },
    });
    fireEvent.change(screen.getByLabelText('对话模型'), {
      target: { value: 'backup-model' },
    });

    fireEvent.click(screen.getByRole('button', { name: '保存为新配置' }));

    await waitFor(() =>
      expect(api.aiProfiles.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: '备用源',
          baseUrl: 'https://backup.example.com/v1',
          chatModel: 'backup-model',
          temperature: 0.3,
          tokenBudget: 100000,
        }),
      ),
    );
    expect(await screen.findByText('已创建「备用源」')).toBeTruthy();
  });

  it('“设为当前”调用 activate', async () => {
    render(<AiSettingsTab onClose={vi.fn()} />);
    await screen.findByDisplayValue('DeepSeek 官方');

    fireEvent.click(screen.getByRole('button', { name: '设为当前' }));

    await waitFor(() => expect(api.aiProfiles.activate).toHaveBeenCalledWith(2));
  });

  it('测速结果按首字延迟排序并显示失败原因', async () => {
    render(<AiSettingsTab onClose={vi.fn()} />);
    await screen.findByDisplayValue('DeepSeek 官方');

    act(() => {
      useSettingsStore.setState({
        speedResults: {
          1: { profileId: 1, ok: true, firstTokenMs: 500, totalMs: 700 },
          2: { profileId: 2, ok: true, firstTokenMs: 120, totalMs: 300 },
        },
      });
    });

    const rows = screen.getAllByRole('listitem');
    expect(rows[0].textContent).toContain('中转 A');
    expect(rows[0].textContent).toContain('首字 0.12s');
    expect(rows[1].textContent).toContain('DeepSeek 官方');

    act(() => {
      useSettingsStore.setState({
        speedResults: {
          1: { profileId: 1, ok: false, error: '请求超时' },
          2: { profileId: 2, ok: true, firstTokenMs: 120, totalMs: 300 },
        },
      });
    });

    expect(screen.getByText('失败：请求超时')).toBeTruthy();
  });

  it('点击“同时测速”调用批量测速', async () => {
    render(<AiSettingsTab onClose={vi.fn()} />);
    await screen.findByDisplayValue('DeepSeek 官方');

    fireEvent.click(screen.getByRole('button', { name: '同时测速' }));

    await waitFor(() => expect(api.aiProfiles.speedTestAll).toHaveBeenCalledTimes(1));
  });
});

describe('AiSettingsTab 草稿测试', () => {
  it('测试连接把当前档案 id 传给主进程，空密钥可回退', async () => {
    render(<AiSettingsTab onClose={vi.fn()} />);
    await screen.findByDisplayValue('DeepSeek 官方');

    fireEvent.click(screen.getByRole('button', { name: '测试连接' }));

    await waitFor(() =>
      expect((window as unknown as {
        api: { settings: { test: ReturnType<typeof vi.fn> } };
      }).api.settings.test).toHaveBeenCalledWith(
        {
          baseUrl: 'https://api.deepseek.com/v1',
          chatModel: 'deepseek-chat',
          visionModel: 'deepseek-vl',
          temperature: 0.3,
          tokenBudget: 100000,
        },
        1,
      ),
    );
    expect(await screen.findByText('连接成功')).toBeTruthy();
  });
});
