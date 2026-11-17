import { spawn as nodeSpawn } from 'node:child_process';
import type { ChildProcess, SpawnOptions } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import type {
  CommandInvocation,
  ToolJobRunnerOptions,
  ToolProgressEvent,
  ToolRunOptions,
  ToolRunResult,
} from '@shared/types';
import { createThrottledEmitter } from '../jobs/throttle';
import type { ThrottledEmitter } from '../jobs/throttle';

const DEFAULT_THROTTLE_MS = 250;
const REDACTED = '[REDACTED]';
/**
 * BabelDOC is a Python/Rich process. On Chinese Windows its stderr defaults to
 * GBK, while MurphyEReader decodes UTF-8, which produced mojibake paths and
 * `UnicodeEncodeError` tracebacks from Rich's logging handler. Force UTF-8 and
 * a plain, wide output stream so progress lines stay readable.
 */
const CHILD_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  PYTHONIOENCODING: 'utf-8',
  PYTHONUTF8: '1',
  PYTHONUNBUFFERED: '1',
  COLUMNS: '200',
  NO_COLOR: '1',
};
const SPAWN_OPTIONS: SpawnOptions = {
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: CHILD_ENV,
};
// Batch shims are pre-quoted into one cmd.exe /c argument by
// buildCommandInvocation; libuv must not escape those quotes again.
const CMD_SPAWN_OPTIONS: SpawnOptions = {
  ...SPAWN_OPTIONS,
  windowsVerbatimArguments: true,
};

function spawnOptionsFor(command: CommandInvocation): SpawnOptions {
  return command.file.toLowerCase() === 'cmd.exe' ? CMD_SPAWN_OPTIONS : SPAWN_OPTIONS;
}

interface ActiveJob {
  pid: number | null;
  canceled: boolean;
  timedOut: boolean;
  timeoutTimer: ReturnType<typeof setTimeout> | null;
  progress: ThrottledEmitter<ToolProgressEvent>;
}

interface StreamState {
  stream: NodeJS.ReadableStream | null;
  decoder: StringDecoder;
  buffer: string;
}

/**
 * Runs external tool processes with line-based progress, secret redaction,
 * timeouts, and process-tree cancellation. Only the main process uses it.
 */
export class ToolJobRunner {
  private readonly emit: (channel: string, payload: unknown) => void;
  private readonly spawn: typeof nodeSpawn;
  private readonly killTree: (pid: number) => Promise<void> | void;
  private readonly throttleMs: number;
  private readonly active = new Map<string, ActiveJob>();

  constructor(
    emit: (channel: string, payload: unknown) => void,
    options: ToolJobRunnerOptions = {},
  ) {
    this.emit = emit;
    this.spawn = options.spawn ?? nodeSpawn;
    this.killTree = options.killTree ?? defaultKillTree;
    this.throttleMs = options.throttleMs ?? DEFAULT_THROTTLE_MS;
  }

  run(options: ToolRunOptions): Promise<ToolRunResult> {
    const { jobId, kind, command } = options;
    const progress = createThrottledEmitter<ToolProgressEvent>(
      (event) => this.emit('tool:progress', event),
      this.throttleMs,
    );
    const job: ActiveJob = {
      pid: null,
      canceled: false,
      timedOut: false,
      timeoutTimer: null,
      progress,
    };
    this.active.set(jobId, job);

    const lines: string[] = [];

    return new Promise<ToolRunResult>((resolve, reject) => {
      let settled = false;

      const cleanup = (): void => {
        if (job.timeoutTimer !== null) {
          clearTimeout(job.timeoutTimer);
          job.timeoutTimer = null;
        }
        job.progress.flush();
        if (this.active.get(jobId) === job) {
          this.active.delete(jobId);
        }
      };

      const fail = (message: string): void => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        reject(new Error(message));
      };

      const redactText = (text: string): string => {
        let result = text;
        for (const secret of options.redact ?? []) {
          if (secret === '') {
            continue;
          }
          result = result.split(secret).join(REDACTED);
        }
        return result;
      };

      let lastPercent: number | null = null;

      const handleLine = (rawLine: string): void => {
        const line = redactText(rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine);
        if (line === '') {
          return;
        }
        lines.push(line);
        let percent: number | null = null;
        if (options.parsePercent !== undefined) {
          try {
            percent = options.parsePercent(line);
          } catch {
            percent = null;
          }
        }
        if (percent !== null) {
          lastPercent = percent;
        }
        options.onLine?.(line, percent);
        progress.push({ jobId, kind, line, percent: lastPercent });
      };

      let child: ChildProcess;
      try {
        child = this.spawn(command.file, command.args, spawnOptionsFor(command));
      } catch (error) {
        fail(`无法启动进程：${errorMessage(error)}`);
        return;
      }
      job.pid = child.pid ?? null;

      const streams: StreamState[] = [
        { stream: child.stdout, decoder: new StringDecoder('utf8'), buffer: '' },
        { stream: child.stderr, decoder: new StringDecoder('utf8'), buffer: '' },
      ];
      for (const state of streams) {
        if (state.stream === null) {
          continue;
        }
        state.stream.on('data', (chunk: Buffer | string) => {
          const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
          state.buffer += state.decoder.write(buffer);
          // BabelDOC's rich progress refreshes lines with a bare carriage
          // return inside a pipe. Splitting on both keeps those intermediate
          // updates from being held back until the process exits.
          const parts = state.buffer.split(/\r\n|\r|\n/);
          state.buffer = parts.pop() ?? '';
          for (const part of parts) {
            handleLine(part);
          }
        });
      }

      child.on('close', (code, signal) => {
        if (settled) {
          return;
        }
        settled = true;
        for (const state of streams) {
          const tail = state.decoder.end();
          if (tail !== '') {
            state.buffer += tail;
          }
          if (state.buffer !== '') {
            handleLine(state.buffer);
            state.buffer = '';
          }
        }
        cleanup();
        resolve({ code, signal, lines, canceled: job.canceled, timedOut: job.timedOut });
      });

      child.on('error', (error) => {
        fail(`无法启动进程：${errorMessage(error)}`);
      });

      if (options.timeoutMs !== undefined && Number.isFinite(options.timeoutMs) && options.timeoutMs > 0) {
        job.timeoutTimer = setTimeout(() => {
          job.timeoutTimer = null;
          job.timedOut = true;
          this.kill(job);
        }, options.timeoutMs);
      }
    });
  }

  cancel(jobId: string): boolean {
    const job = this.active.get(jobId);
    if (job === undefined) {
      return false;
    }
    job.canceled = true;
    this.kill(job);
    return true;
  }

  cancelAll(): void {
    for (const job of this.active.values()) {
      job.canceled = true;
      this.kill(job);
    }
  }

  activeJobIds(): string[] {
    return [...this.active.keys()];
  }

  private kill(job: ActiveJob): void {
    if (job.pid === null) {
      return;
    }
    const pid = job.pid;
    try {
      const pending = this.killTree(pid);
      if (pending !== undefined) {
        void pending.catch(() => {});
      }
    } catch {
      // Best effort: the process may already be gone.
    }
  }
}

function defaultKillTree(pid: number): void {
  if (process.platform === 'win32') {
    try {
      const killer = nodeSpawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      });
      killer.on('error', () => {});
    } catch {
      // Best effort: the process may already be gone.
    }
    return;
  }
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    // Best effort: the process may already be gone.
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
