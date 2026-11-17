import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { JobRegistry } from '@main/jobs/job-registry';
import type { StoredAppSettings } from '@main/settings/app-settings';
import { BabeldocService } from '@main/tools/babeldoc-service';
import type {
  BabeldocInstallOutcome,
  BabeldocInstallPlan,
  BabeldocInstaller,
} from '@main/tools/babeldoc-installer';
import type { ToolJobRunner } from '@main/tools/job-runner';
import type {
  ToolDoneEvent,
  ToolProgressEvent,
  ToolRunOptions,
  ToolRunResult,
} from '@shared/types';

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
const MANAGED_ROOT = 'C:\\Users\\me\\AppData\\Local\\PaperLens\\translation-engine';
const MANAGED_BABELDOC = `${MANAGED_ROOT}\\bin\\babeldoc.exe`;
const MANAGED_LOG = `${MANAGED_ROOT}\\install.log`;
const MANAGED_RESULT = `${MANAGED_ROOT}\\install-result.json`;
const SCRIPT_PATH = 'C:\\Temp\\paperlens-babeldoc-install-job\\install.ps1';

const POWERSHELL_COMMAND = {
  file: 'powershell.exe',
  args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT_PATH],
};

const OK_RESULT: ToolRunResult = {
  code: 0,
  signal: null,
  lines: [],
  canceled: false,
  timedOut: false,
};

const SUCCESS_OUTCOME: BabeldocInstallOutcome = {
  ok: true,
  canceled: false,
  babeldocPath: MANAGED_BABELDOC,
  message: '安装完成',
};

function managedPlan(logPath = MANAGED_LOG): BabeldocInstallPlan {
  return {
    paths: {
      installRoot: MANAGED_ROOT,
      uvDir: `${MANAGED_ROOT}\\uv`,
      uvPath: `${MANAGED_ROOT}\\uv\\uv.exe`,
      toolDir: `${MANAGED_ROOT}\\tool`,
      binDir: `${MANAGED_ROOT}\\bin`,
      pythonDir: `${MANAGED_ROOT}\\python`,
      cacheDir: `${MANAGED_ROOT}\\cache`,
      babeldocPath: MANAGED_BABELDOC,
      logPath,
      resultPath: MANAGED_RESULT,
      scriptPath: SCRIPT_PATH,
      configPath: 'C:\\Temp\\paperlens-babeldoc-install-job\\install-config.json',
    },
    command: POWERSHELL_COMMAND,
  };
}

interface HarnessOptions {
  babeldocPath?: string;
  platform?: NodeJS.Platform;
  outcome?: BabeldocInstallOutcome | null;
  installer?: Pick<BabeldocInstaller, 'prepare' | 'readOutcome'>;
  exists?: (path: string) => boolean;
  which?: (command: string) => string[];
  probe?: (path: string) => Promise<boolean>;
  run?: (options: ToolRunOptions) => Promise<ToolRunResult>;
  /** Leave the real default probe (spawning `--help`) in place. */
  defaultProbe?: boolean;
}

function createHarness(options: HarnessOptions = {}) {
  const stored: StoredAppSettings = {
    libraryRoot: 'C:/library',
    defaultLibraryRoot: 'C:/Documents/PaperLens',
    babeldocPath: options.babeldocPath ?? '',
    aiPanelWidth: 360,
    theme: 'light',
    paperTexture: 45,
    translationQps: 8,
    translationWorkers: 8,
    translationAutoGlossary: true,
    onboarded: false,
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
  const prepare = vi.fn(
    (_jobId: string, _uvPath: string | null): BabeldocInstallPlan => managedPlan(),
  );
  const readOutcome = vi.fn(
    (): BabeldocInstallOutcome | null => options.outcome ?? null,
  );
  const installer = options.installer ?? { prepare, readOutcome };
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
    installer,
    env: ENV,
    platform: options.platform ?? 'win32',
    exists: options.exists ?? (() => false),
    which: options.which ?? (() => []),
    ...(options.defaultProbe === true
      ? {}
      : { probe: options.probe ?? (async () => true) }),
  });
  const waitForDone = (): Promise<ToolDoneEvent> =>
    new Promise((resolve) => bus.once('tool:done', resolve));
  return {
    service,
    jobs,
    bus,
    events,
    run,
    cancel,
    prepare,
    setBabeldocPath,
    stored,
    waitForDone,
  };
}

function isChineseMessage(message: string | null): boolean {
  return message !== null && /[\u4e00-\u9fff]/.test(message);
}

describe('BabeldocService.install', () => {
  it('Windows 没有 uv 也启动一键安装，并标记为不可取消', async () => {
    const harness = createHarness({ outcome: SUCCESS_OUTCOME });
    const done = harness.waitForDone();

    const result = await harness.service.install();

    expect(result).toEqual({
      started: true,
      jobId: expect.any(String),
      instructions: null,
      cancelable: false,
    });
    expect(harness.prepare).toHaveBeenCalledWith(result.jobId, null);
    expect(harness.run).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: result.jobId,
        kind: 'install',
        command: POWERSHELL_COMMAND,
      }),
    );
    await expect(done).resolves.toEqual({
      jobId: result.jobId,
      kind: 'install',
      ok: true,
      canceled: false,
      message: null,
    });
    expect(harness.setBabeldocPath).toHaveBeenCalledWith(MANAGED_BABELDOC);
    expect(harness.jobs.getState().toolTask).toBeNull();
  });

  it('Windows 已安装 uv 时把它交给一键安装器而不是直接运行 uv', async () => {
    const harness = createHarness({
      exists: (path) => path === UV_PATH,
      outcome: SUCCESS_OUTCOME,
    });
    const done = harness.waitForDone();

    const result = await harness.service.install();

    expect(harness.prepare).toHaveBeenCalledWith(result.jobId, UV_PATH);
    expect(harness.run).toHaveBeenCalledWith(
      expect.objectContaining({ command: POWERSHELL_COMMAND }),
    );
    await done;
  });

  it('非 Windows 没有 uv 时仍返回手动安装说明且不启动进程', async () => {
    const harness = createHarness({ platform: 'linux' });

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
    expect(harness.prepare).not.toHaveBeenCalled();
    expect(harness.jobs.getState().toolTask).toBeNull();
  });

  it('安装脚本报告失败时发出失败结果且不保存路径', async () => {
    const harness = createHarness({
      outcome: {
        ok: false,
        canceled: false,
        babeldocPath: null,
        message: '安装失败：所有安装源均未能完成安装',
      },
      run: async () => ({ ...OK_RESULT, code: 3 }),
    });
    const done = harness.waitForDone();

    await harness.service.install();
    const event = await done;

    expect(event).toMatchObject({
      kind: 'install',
      ok: false,
      canceled: false,
      message: '安装失败：所有安装源均未能完成安装',
    });
    expect(harness.setBabeldocPath).not.toHaveBeenCalled();
    expect(harness.jobs.getState().toolTask).toBeNull();
  });

  it('用户取消管理员授权时发出取消结果', async () => {
    const harness = createHarness({
      outcome: {
        ok: false,
        canceled: true,
        babeldocPath: null,
        message: '已取消管理员授权，安装未开始',
      },
      run: async () => ({ ...OK_RESULT, code: 2 }),
    });
    const done = harness.waitForDone();

    await harness.service.install();
    const event = await done;

    expect(event).toMatchObject({
      kind: 'install',
      ok: false,
      canceled: true,
      message: '已取消',
    });
  });

  it('一键安装进行中拒绝取消，避免提权子进程继续安装', async () => {
    let finishRun: ((result: ToolRunResult) => void) | null = null;
    const harness = createHarness({
      outcome: SUCCESS_OUTCOME,
      run: () =>
        new Promise<ToolRunResult>((resolve) => {
          finishRun = resolve;
        }),
    });
    const done = harness.waitForDone();

    const result = await harness.service.install();
    expect(result.jobId).not.toBeNull();
    expect(harness.service.cancel(result.jobId ?? '')).toBe(false);
    expect(harness.cancel).not.toHaveBeenCalled();

    finishRun?.(OK_RESULT);
    await done;
  });

  it('轮询安装日志，把新行推送给设置页', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'paperlens-install-log-'));
    const logPath = join(dir, 'install.log');
    const plan = managedPlan(logPath);
    const installer = {
      prepare: vi.fn(() => plan),
      readOutcome: vi.fn(() => SUCCESS_OUTCOME),
    };
    const harness = createHarness({
      installer,
      run: async () => {
        writeFileSync(
          logPath,
          `\uFEFF[10:00:00] 正在下载 uv\n[10:00:01] 正在安装 BabelDOC\n`,
          'utf8',
        );
        await new Promise((resolve) => setTimeout(resolve, 450));
        return OK_RESULT;
      },
    });
    const done = harness.waitForDone();

    await harness.service.install();
    await done;

    const progress = harness.events
      .filter((event) => event.channel === 'tool:progress')
      .map((event) => event.payload as ToolProgressEvent);
    expect(progress.some((event) => event.line.includes('正在下载 uv'))).toBe(true);
    expect(progress.some((event) => event.line.includes('正在安装 BabelDOC'))).toBe(
      true,
    );
    expect(progress.every((event) => event.kind === 'install')).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  it('runner.run 拒绝时转为失败事件而不是未处理的拒绝', async () => {
    const harness = createHarness({
      exists: (path) => path === UV_PATH,
      run: async () => {
        throw new Error('无法启动进程：spawn powershell ENOENT');
      },
    });
    const done = harness.waitForDone();

    await harness.service.install();
    const event = await done;

    expect(event).toMatchObject({
      kind: 'install',
      ok: false,
      canceled: false,
      message: '无法启动进程：spawn powershell ENOENT',
    });
    expect(harness.jobs.getState().toolTask).toBeNull();
  });

  it('已有工具任务时拒绝并原样传播忙碌消息', async () => {
    const harness = createHarness({ exists: (path) => path === UV_PATH });
    harness.jobs.tryAcquireTool('warmup', 'held-job');

    await expect(harness.service.install()).rejects.toThrow(BUSY);
    expect(harness.run).not.toHaveBeenCalled();
    expect(harness.prepare).not.toHaveBeenCalled();
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
          args: ['/d', '/s', '/c', `""${cmdPath}" --warmup"`],
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
  it('把普通任务的取消转交给 runner', () => {
    const harness = createHarness();

    expect(harness.service.cancel('job-1')).toBe(true);
    expect(harness.cancel).toHaveBeenCalledWith('job-1');
  });
});

/** Review Focus #4: detection's real `--help` probe must also run spaced shims. */
describe.skipIf(process.platform !== 'win32')('default probe integration', () => {
  it('默认探针能运行路径含空格的 .cmd 候选', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'paperlens babeldoc probe '));
    const shim = join(dir, 'babeldoc.cmd');
    writeFileSync(shim, '@echo off\r\nexit /b 0\r\n');
    try {
      const harness = createHarness({
        babeldocPath: shim,
        exists: (path) => path === shim,
        which: () => [],
        defaultProbe: true,
      });

      await expect(harness.service.detect()).resolves.toBe(shim);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
