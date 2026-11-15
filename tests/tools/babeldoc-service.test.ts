import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { JobRegistry } from '@main/jobs/job-registry';
import type { StoredAppSettings } from '@main/settings/app-settings';
import { BabeldocService } from '@main/tools/babeldoc-service';
import type { ToolJobRunner } from '@main/tools/job-runner';
import type { ToolDoneEvent, ToolRunOptions, ToolRunResult } from '@shared/types';

const BUSY = '请先等待当前任务完成';
const INVALID_ENGINE = '无法运行该翻译引擎，请重新选择';
const MISSING_ENGINE = '未检测到 BabelDOC，请在设置中安装或指定路径';

const ENV = {
  USERPROFILE: 'C:\\Users\\me',
  APPDATA: 'C:\\Users\\me\\AppData\\Roaming',
  LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local',
};

const PATH_BABELDOC = 'C:\\PATH\\babeldoc.exe';
const UV_PATH = 'C:\\Users\\me\\.local\\bin\\uv.exe';

const OK_RESULT: ToolRunResult = {
  code: 0,
  signal: null,
  lines: [],
  canceled: false,
  timedOut: false,
};

interface HarnessOptions {
  babeldocPath?: string;
  exists?: (path: string) => boolean;
  which?: (command: string) => string[];
  probe?: (path: string) => Promise<boolean>;
  run?: (options: ToolRunOptions) => Promise<ToolRunResult>;
}

function createHarness(options: HarnessOptions = {}) {
  const stored: StoredAppSettings = {
    libraryRoot: 'C:/library',
    defaultLibraryRoot: 'C:/Documents/PaperLens',
    babeldocPath: options.babeldocPath ?? '',
    aiPanelWidth: 360,
  };
  const jobs = new JobRegistry();
  const bus = new EventEmitter();
  const events: Array<{ channel: string; payload: unknown }> = [];
  const run = vi.fn(options.run ?? (async () => OK_RESULT));
  const cancel = vi.fn(() => true);
  const runner = {
    run,
    cancel,
    cancelAll: vi.fn(),
    activeJobIds: vi.fn(() => []),
  } as unknown as ToolJobRunner;
  const setBabeldocPath = vi.fn((path: string) => {
    stored.babeldocPath = path;
  });
  const service = new BabeldocService({
    jobs,
    runner,
    emit: (channel, payload) => {
      events.push({ channel, payload });
      bus.emit(channel, payload);
    },
    getStored: () => stored,
    setBabeldocPath,
    env: ENV,
    platform: 'win32',
    exists: options.exists ?? (() => false),
    which: options.which ?? (() => []),
    probe: options.probe ?? (async () => true),
  });
  const waitForDone = (): Promise<ToolDoneEvent> =>
    new Promise((resolve) => bus.once('tool:done', resolve));
  return {
    service,
    jobs,
    events,
    run,
    cancel,
    setBabeldocPath,
    stored,
    waitForDone,
  };
}

function isChineseMessage(message: string | null): boolean {
  return message !== null && /[\u4e00-\u9fff]/.test(message);
}

describe('BabeldocService.install', () => {
  it('没有 uv 时返回安装说明且不启动进程', async () => {
    const harness = createHarness();

    const result = await harness.service.install();

    expect(result).toEqual({
      started: false,
      jobId: null,
      instructions: expect.any(String),
    });
    const instructions = result.instructions ?? '';
    expect(instructions).toContain(
      'powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"',
    );
    expect(instructions).toContain('uv tool install --python 3.12 BabelDOC');
    expect(instructions).toContain('babeldoc --warmup');
    expect(harness.run).not.toHaveBeenCalled();
    expect(harness.jobs.getState().toolTask).toBeNull();
  });

  it('找到 uv 时异步启动安装、释放租约并发出 tool:done', async () => {
    const harness = createHarness({ exists: (path) => path === UV_PATH });
    const done = harness.waitForDone();

    const result = await harness.service.install();

    expect(result.started).toBe(true);
    expect(result.jobId).toEqual(expect.any(String));
    expect(result.instructions).toBeNull();

    await expect(done).resolves.toEqual({
      jobId: result.jobId,
      kind: 'install',
      ok: true,
      canceled: false,
      message: null,
    });
    expect(harness.run).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: result.jobId,
        kind: 'install',
        command: {
          file: UV_PATH,
          args: ['tool', 'install', '--python', '3.12', 'BabelDOC'],
        },
      }),
    );
    expect(harness.jobs.getState().toolTask).toBeNull();
  });

  it('安装进程非零退出时发出失败结果并保留中文消息', async () => {
    const harness = createHarness({
      exists: (path) => path === UV_PATH,
      run: async () => ({ ...OK_RESULT, code: 1 }),
    });
    const done = harness.waitForDone();

    await harness.service.install();
    const event = await done;

    expect(event.ok).toBe(false);
    expect(event.canceled).toBe(false);
    expect(isChineseMessage(event.message)).toBe(true);
    expect(harness.jobs.getState().toolTask).toBeNull();
  });

  it('runner.run 拒绝时转为失败事件而不是未处理的拒绝', async () => {
    const harness = createHarness({
      exists: (path) => path === UV_PATH,
      run: async () => {
        throw new Error('无法启动进程：spawn uv ENOENT');
      },
    });
    const done = harness.waitForDone();

    await harness.service.install();
    const event = await done;

    expect(event).toMatchObject({
      kind: 'install',
      ok: false,
      canceled: false,
      message: '无法启动进程：spawn uv ENOENT',
    });
    expect(harness.jobs.getState().toolTask).toBeNull();
  });

  it('已有工具任务时拒绝并原样传播忙碌消息', async () => {
    const harness = createHarness({ exists: (path) => path === UV_PATH });
    harness.jobs.tryAcquireTool('warmup', 'held-job');

    await expect(harness.service.install()).rejects.toThrow(BUSY);
    expect(harness.run).not.toHaveBeenCalled();
    expect(harness.jobs.getState()).toMatchObject({
      toolTask: 'warmup',
      toolJobId: 'held-job',
    });
  });
});

describe('BabeldocService.detect', () => {
  it('配置路径无效时继续按 where.exe、用户目录的顺序查找', async () => {
    const harness = createHarness({
      babeldocPath: 'C:\\Broken\\babeldoc.cmd',
      exists: (path) => path === PATH_BABELDOC,
      which: (command) => (command === 'babeldoc' ? [PATH_BABELDOC] : []),
    });

    await expect(harness.service.detect()).resolves.toBe(PATH_BABELDOC);
  });

  it('配置路径存在但 --help 失败时回退到后续候选', async () => {
    const configured = 'C:\\Tools\\babeldoc.cmd';
    const harness = createHarness({
      babeldocPath: configured,
      exists: () => true,
      which: (command) => (command === 'babeldoc' ? [PATH_BABELDOC] : []),
      probe: async (path) => path === PATH_BABELDOC,
    });

    await expect(harness.service.detect()).resolves.toBe(PATH_BABELDOC);
  });

  it('没有任何候选通过 --help 时返回 null', async () => {
    const harness = createHarness({
      exists: () => true,
      which: () => [PATH_BABELDOC],
      probe: async () => false,
    });

    await expect(harness.service.detect()).resolves.toBeNull();
  });
});

describe('BabeldocService.validate', () => {
  it('路径不存在时以固定中文消息拒绝', async () => {
    const harness = createHarness({ exists: () => false });

    await expect(harness.service.validate('C:\\Missing\\babeldoc.exe')).rejects.toThrow(
      INVALID_ENGINE,
    );
  });

  it('文件存在但 --help 失败时以固定中文消息拒绝', async () => {
    const harness = createHarness({ exists: () => true, probe: async () => false });

    await expect(harness.service.validate(PATH_BABELDOC)).rejects.toThrow(INVALID_ENGINE);
  });

  it('文件存在且 --help 成功时通过校验', async () => {
    const harness = createHarness({ exists: () => true, probe: async () => true });

    await expect(harness.service.validate(PATH_BABELDOC)).resolves.toBeUndefined();
  });
});

describe('BabeldocService.warmup', () => {
  it('未检测到引擎时以固定中文消息拒绝且不启动进程', async () => {
    const harness = createHarness();

    await expect(harness.service.warmup()).rejects.toThrow(MISSING_ENGINE);
    expect(harness.run).not.toHaveBeenCalled();
  });

  it('对 .cmd 引擎通过 cmd.exe 运行 --warmup 并发出完成事件', async () => {
    const cmdPath = 'C:\\Program Files\\My Tools\\babeldoc.cmd';
    const harness = createHarness({
      babeldocPath: cmdPath,
      exists: (path) => path === cmdPath,
    });
    const done = harness.waitForDone();

    const result = await harness.service.warmup();

    expect(result.started).toBe(true);
    expect(result.jobId).toEqual(expect.any(String));
    expect(harness.run).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: result.jobId,
        kind: 'warmup',
        command: {
          file: 'cmd.exe',
          args: ['/d', '/s', '/c', `"${cmdPath}" --warmup`],
        },
      }),
    );
    await expect(done).resolves.toMatchObject({
      jobId: result.jobId,
      kind: 'warmup',
      ok: true,
      canceled: false,
    });
    expect(harness.jobs.getState().toolTask).toBeNull();
  });
});

describe('BabeldocService.getStatus', () => {
  it('返回检测路径、配置路径、uv 路径与忙碌状态', async () => {
    const harness = createHarness({
      babeldocPath: PATH_BABELDOC,
      exists: (path) => path === PATH_BABELDOC || path === UV_PATH,
    });

    await expect(harness.service.getStatus()).resolves.toEqual({
      detectedPath: PATH_BABELDOC,
      configuredPath: PATH_BABELDOC,
      uvPath: UV_PATH,
      busy: false,
    });

    harness.jobs.tryAcquireTool('install', 'job-1');
    await expect(harness.service.getStatus()).resolves.toMatchObject({
      busy: true,
    });
  });
});

describe('BabeldocService.cancel', () => {
  it('把取消转交给 runner', () => {
    const harness = createHarness();

    expect(harness.service.cancel('job-1')).toBe(true);
    expect(harness.cancel).toHaveBeenCalledWith('job-1');
  });
});
