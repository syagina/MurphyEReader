import { spawn, spawnSync } from 'node:child_process';
import type { ChildProcess, SpawnOptions } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import type {
  CommandInvocation,
  EngineActionResult,
  ToolDoneEvent,
  ToolProgressEvent,
  ToolRunResult,
  ToolTask,
  TranslationEngineStatus,
} from '@shared/types';
import { TRANSLATION_ENGINE_MISSING } from '@shared/translation';
import type { JobRegistry } from '../jobs/job-registry';
import type { StoredAppSettings } from '../settings/app-settings';
import type { ToolJobRunner } from './job-runner';
import { babeldocCandidates, buildCommandInvocation, uvCandidates } from './babeldoc';
import {
  BabeldocInstaller,
  type BabeldocInstallOutcome,
  type BabeldocInstallPlan,
} from './babeldoc-installer';

const PROBE_TIMEOUT_MS = 10_000;
const INVALID_ENGINE_MESSAGE = '无法运行该翻译引擎，请重新选择';
const MISSING_ENGINE_MESSAGE = TRANSLATION_ENGINE_MISSING;
const CANCELED_MESSAGE = '已取消';
const TIMED_OUT_MESSAGE = '操作超时';
const INSTALL_LOG_POLL_MS = 300;

const INSTALL_INSTRUCTIONS = [
  '未检测到 uv。请先在 PowerShell 中运行：',
  'powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"',
  '',
  '安装 uv 后运行：',
  'uv tool install --python 3.12 BabelDOC',
  '',
  '再预热模型：',
  'babeldoc --warmup',
  '',
  '完成后点击“重新检测”。',
].join('\n');

export interface BabeldocServiceDeps {
  jobs: JobRegistry;
  runner: ToolJobRunner;
  emit: (channel: string, payload: unknown) => void;
  getStored(): StoredAppSettings;
  setBabeldocPath(path: string): void;
  installer?: Pick<BabeldocInstaller, 'prepare' | 'readOutcome'>;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  exists?(path: string): boolean;
  which?(command: string): string[];
  probe?(path: string): Promise<boolean>;
}

type EngineJobKind = Extract<ToolTask, 'install' | 'warmup'>;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Keeps Chinese runner errors intact and prefixes unexpected English ones. */
function failureMessage(kind: EngineJobKind, error: unknown): string {
  const message = errorMessage(error);
  if (/[一-鿿]/.test(message)) {
    return message;
  }
  return kind === 'install' ? `安装失败：${message}` : `预热失败：${message}`;
}

/** `where.exe` (Windows) / `which` results for one command; [] when unavailable. */
function createDefaultWhich(
  platform: NodeJS.Platform,
): (command: string) => string[] {
  const finder = platform === 'win32' ? 'where.exe' : 'which';
  return (command) => {
    try {
      const result = spawnSync(finder, [command], {
        encoding: 'utf8',
        windowsHide: true,
      });
      if (
        result.error !== undefined ||
        result.status !== 0 ||
        typeof result.stdout !== 'string'
      ) {
        return [];
      }
      return result.stdout
        .split(/\r?\n/)
        .map((line) => line.trim().replace(/^"(.*)"$/, '$1'))
        .filter((line) => line !== '');
    } catch {
      return [];
    }
  };
}

/**
 * Runs `<executable> --help` through the same invocation builder used for real
 * jobs, so a `.cmd` shim works. Resolves true only for exit code 0 and kills
 * the process after ten seconds.
 */
function createDefaultProbe(
  platform: NodeJS.Platform,
): (path: string) => Promise<boolean> {
  return (path) =>
    new Promise<boolean>((resolve) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const finish = (ok: boolean): void => {
        if (settled) {
          return;
        }
        settled = true;
        if (timer !== null) {
          clearTimeout(timer);
          timer = null;
        }
        resolve(ok);
      };

      let child: ChildProcess;
      try {
        const invocation = buildCommandInvocation(path, ['--help'], platform);
        const spawnOptions: SpawnOptions = {
          windowsHide: true,
          stdio: 'ignore',
          // The builder already quoted the batch command; keep those quotes.
          ...(invocation.file.toLowerCase() === 'cmd.exe'
            ? { windowsVerbatimArguments: true }
            : {}),
        };
        child = spawn(invocation.file, invocation.args, spawnOptions);
      } catch {
        finish(false);
        return;
      }

      timer = setTimeout(() => {
        timer = null;
        try {
          child.kill();
        } catch {
          // Best effort: the process may already be gone.
        }
        finish(false);
      }, PROBE_TIMEOUT_MS);

      child.on('error', () => finish(false));
      child.on('close', (code) => finish(code === 0));
    });
}

/**
 * Detects, installs, and warms up the external BabelDOC CLI. Install and
 * warmup start asynchronously, hold the shared tool lease, and report through
 * the runner's `tool:progress` plus this service's `tool:done`.
 */
export class BabeldocService {
  private readonly deps: BabeldocServiceDeps;
  private readonly env: NodeJS.ProcessEnv;
  private readonly platform: NodeJS.Platform;
  private readonly exists: (path: string) => boolean;
  private readonly which: (command: string) => string[];
  private readonly probe: (path: string) => Promise<boolean>;
  private readonly installer: Pick<BabeldocInstaller, 'prepare' | 'readOutcome'>;
  private managedInstallJobId: string | null = null;
  private installLogTimer: ReturnType<typeof setInterval> | null = null;
  private installLogJobId: string | null = null;
  private installLogPath: string | null = null;
  private installLogLineCount = 0;

  constructor(deps: BabeldocServiceDeps) {
    this.deps = deps;
    this.env = deps.env ?? process.env;
    this.platform = deps.platform ?? process.platform;
    this.exists = deps.exists ?? ((path) => existsSync(path));
    this.which = deps.which ?? createDefaultWhich(this.platform);
    this.probe = deps.probe ?? createDefaultProbe(this.platform);
    this.installer =
      deps.installer ??
      new BabeldocInstaller({ env: this.env, platform: this.platform });
  }

  /** First existing candidate whose `--help` probe exits 0. */
  async detect(): Promise<string | null> {
    const candidates = babeldocCandidates({
      configuredPath: this.deps.getStored().babeldocPath,
      env: this.env,
      platform: this.platform,
      exists: this.exists,
      which: this.which,
    });
    for (const candidate of candidates) {
      if (!this.exists(candidate)) {
        continue;
      }
      try {
        if (await this.probe(candidate)) {
          return candidate;
        }
      } catch {
        // A probe failure only disqualifies this candidate.
      }
    }
    return null;
  }

  async getStatus(): Promise<TranslationEngineStatus> {
    const detectedPath = await this.detect();
    return {
      detectedPath,
      configuredPath: this.deps.getStored().babeldocPath,
      uvPath: this.findUv(),
      busy: this.deps.jobs.getState().toolTask !== null,
    };
  }

  /** Rejects with one fixed message unless the file exists and runs `--help`. */
  async validate(path: string): Promise<void> {
    const target = path.trim();
    if (target === '' || !this.exists(target)) {
      throw new Error(INVALID_ENGINE_MESSAGE);
    }
    let ok = false;
    try {
      ok = await this.probe(target);
    } catch {
      ok = false;
    }
    if (!ok) {
      throw new Error(INVALID_ENGINE_MESSAGE);
    }
  }

  findUv(): string | null {
    const candidates = uvCandidates({
      env: this.env,
      platform: this.platform,
      exists: this.exists,
      which: this.which,
    });
    return candidates[0] ?? null;
  }

  async install(): Promise<EngineActionResult> {
    if (this.platform === 'win32') {
      return this.installManaged();
    }

    const uv = this.findUv();
    if (uv === null) {
      return { started: false, jobId: null, instructions: INSTALL_INSTRUCTIONS };
    }
    const jobId = randomUUID();
    this.deps.jobs.tryAcquireTool('install', jobId);
    const command = buildCommandInvocation(
      uv,
      ['tool', 'install', '--python', '3.12', 'BabelDOC'],
      this.platform,
    );
    this.startBackground('install', jobId, command);
    return { started: true, jobId, instructions: null, cancelable: true };
  }

  /**
   * The Windows path downloads a private uv/Python/BabelDOC toolchain, shows a
   * UAC prompt, and writes progress to an install log. The elevated child is
   * outside the runner's process tree, so it must not be advertised as
   * cancelable.
   */
  private installManaged(): EngineActionResult {
    const jobId = randomUUID();
    this.deps.jobs.tryAcquireTool('install', jobId);
    try {
      const plan = this.installer.prepare(jobId, this.findUv());
      this.managedInstallJobId = jobId;
      this.beginInstallLogTail(jobId, plan.paths.logPath);
      this.startBackground('install', jobId, plan.command, plan);
      return { started: true, jobId, instructions: null, cancelable: false };
    } catch (error) {
      this.finishInstallLog();
      this.managedInstallJobId = null;
      this.deps.jobs.releaseTool(jobId);
      throw error;
    }
  }

  async warmup(): Promise<EngineActionResult> {
    const enginePath = await this.detect();
    if (enginePath === null) {
      throw new Error(MISSING_ENGINE_MESSAGE);
    }
    const jobId = randomUUID();
    this.deps.jobs.tryAcquireTool('warmup', jobId);
    this.startBackground(
      'warmup',
      jobId,
      buildCommandInvocation(enginePath, ['--warmup'], this.platform),
    );
    return { started: true, jobId, instructions: null };
  }

  cancel(jobId: string): boolean {
    if (this.managedInstallJobId === jobId) {
      return false;
    }
    return this.deps.runner.cancel(jobId);
  }

  private startBackground(
    kind: EngineJobKind,
    jobId: string,
    command: CommandInvocation,
    installPlan: BabeldocInstallPlan | null = null,
  ): void {
    // The run reports through tool:done; it must never reject into the caller
    // that already received its accepted action result.
    void this.runBackground(kind, jobId, command, installPlan);
  }

  private async runBackground(
    kind: EngineJobKind,
    jobId: string,
    command: CommandInvocation,
    installPlan: BabeldocInstallPlan | null,
  ): Promise<void> {
    let result: ToolRunResult | null = null;
    let failure: string | null = null;
    let outcome: BabeldocInstallOutcome | null = null;
    try {
      result = await this.deps.runner.run({ jobId, kind, command });
    } catch (error) {
      failure = failureMessage(kind, error);
    } finally {
      if (installPlan !== null) {
        this.finishInstallLog();
        try {
          outcome = this.installer.readOutcome(installPlan);
        } catch {
          outcome = null;
        }
        if (outcome?.ok === true && outcome.babeldocPath !== null) {
          try {
            this.deps.setBabeldocPath(outcome.babeldocPath);
          } catch {
            // Detection can still find the managed path; storing is best effort.
          }
        }
      }
      if (this.managedInstallJobId === jobId) {
        this.managedInstallJobId = null;
      }
      // Idempotent and job-scoped, so a late release can never clear a newer job.
      this.deps.jobs.releaseTool(jobId);
    }

    try {
      this.deps.emit(
        'tool:done',
        this.doneEvent(kind, jobId, result, failure, outcome, installPlan !== null),
      );
      // Refresh detection so the status the renderer asks for is current.
      await this.detect();
    } catch {
      // Completion reporting and re-detection are best effort.
    }
  }

  private beginInstallLogTail(jobId: string, logPath: string): void {
    this.finishInstallLog();
    this.installLogJobId = jobId;
    this.installLogPath = logPath;
    this.installLogLineCount = 0;
    const timer = setInterval(() => {
      this.flushInstallLog(false);
    }, INSTALL_LOG_POLL_MS);
    timer.unref?.();
    this.installLogTimer = timer;
  }

  /** Reads complete new lines from the elevated installer's UTF-8 log. */
  private flushInstallLog(final: boolean): void {
    const jobId = this.installLogJobId;
    const logPath = this.installLogPath;
    if (jobId === null || logPath === null) {
      return;
    }

    let text: string;
    try {
      text = readFileSync(logPath, 'utf8');
    } catch {
      return;
    }
    if (text.charCodeAt(0) === 0xfeff) {
      text = text.slice(1);
    }
    if (!final) {
      const lastNewline = text.lastIndexOf('\n');
      if (lastNewline < 0) {
        return;
      }
      // Ignore a line still being appended by PowerShell.
      text = text.slice(0, lastNewline + 1);
    }

    const lines = text.split(/\r?\n/);
    if (lines[lines.length - 1] === '') {
      lines.pop();
    }
    if (lines.length < this.installLogLineCount) {
      // The elevated child truncates the log after the first process wrote it.
      this.installLogLineCount = 0;
    }
    for (let index = this.installLogLineCount; index < lines.length; index += 1) {
      const line = lines[index].trimEnd();
      if (line === '') {
        continue;
      }
      const event: ToolProgressEvent = {
        jobId,
        kind: 'install',
        line,
        percent: null,
      };
      this.deps.emit('tool:progress', event);
    }
    this.installLogLineCount = lines.length;
  }

  private finishInstallLog(): void {
    if (this.installLogTimer === null) {
      return;
    }
    this.flushInstallLog(true);
    clearInterval(this.installLogTimer);
    this.installLogTimer = null;
    this.installLogJobId = null;
    this.installLogPath = null;
    this.installLogLineCount = 0;
  }

  private doneEvent(
    kind: EngineJobKind,
    jobId: string,
    result: ToolRunResult | null,
    failure: string | null,
    outcome: BabeldocInstallOutcome | null,
    managedInstall: boolean,
  ): ToolDoneEvent {
    if (outcome?.canceled === true) {
      return {
        jobId,
        kind,
        ok: false,
        canceled: true,
        message: CANCELED_MESSAGE,
      };
    }

    if (result === null) {
      return {
        jobId,
        kind,
        ok: false,
        canceled: false,
        message: failure ?? '任务失败',
      };
    }

    let message: string | null = null;
    let ok = result.code === 0 && !result.canceled && !result.timedOut;
    if (result.canceled) {
      message = CANCELED_MESSAGE;
    } else if (result.timedOut) {
      message = TIMED_OUT_MESSAGE;
    } else if (managedInstall) {
      if (outcome === null) {
        ok = false;
        message = '安装失败：安装结果缺失，请查看日志';
      } else if (!outcome.ok) {
        ok = false;
        message = outcome.message ?? '安装失败，请查看日志';
      }
    } else if (result.code !== 0) {
      message = kind === 'install' ? '安装失败，请查看日志' : '预热失败，请查看日志';
    }
    return {
      jobId,
      kind,
      ok,
      canceled: result.canceled,
      message,
    };
  }
}
