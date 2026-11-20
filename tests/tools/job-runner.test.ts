import type { spawn as nodeSpawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ToolJobRunner,
  withLoopbackProxyBypass,
} from '@main/tools/job-runner';
import type { ToolProgressEvent } from '@shared/types';

interface FakeChild extends EventEmitter {
  pid: number | undefined;
  stdout: EventEmitter;
  stderr: EventEmitter;
}

interface CapturedEvent {
  channel: string;
  payload: unknown;
}

function fakeChild(pid: number | undefined = 123): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.pid = pid;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  return child;
}

function spawnReturning(child: FakeChild): typeof nodeSpawn {
  return vi.fn(() => child) as unknown as typeof nodeSpawn;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('withLoopbackProxyBypass', () => {
  it('keeps existing bypass entries and adds every loopback host', () => {
    const env = withLoopbackProxyBypass({
      NO_PROXY: 'internal.example, 127.0.0.1',
    });

    expect(env.NO_PROXY?.split(',')).toEqual([
      'internal.example',
      '127.0.0.1',
      'localhost',
      '::1',
    ]);
    expect(env.no_proxy).toBe(env.NO_PROXY);
  });

  it('keeps a lowercase bypass list and deduplicates case-insensitively', () => {
    const env = withLoopbackProxyBypass({
      no_proxy: 'corp.example,LOCALHOST',
    });

    expect(env.NO_PROXY?.split(',')).toEqual([
      'corp.example',
      'LOCALHOST',
      '127.0.0.1',
      '::1',
    ]);
    expect(env.no_proxy).toBe(env.NO_PROXY);
  });
});

describe('ToolJobRunner', () => {
  it('脱敏密钥、解析百分比、收集全部输出行并发送进度事件', async () => {
    const child = fakeChild();
    const spawn = spawnReturning(child);
    const events: CapturedEvent[] = [];
    const runner = new ToolJobRunner((channel, payload) => events.push({ channel, payload }), {
      spawn,
      killTree: vi.fn(),
    });

    const promise = runner.run({
      jobId: 'job-1',
      kind: 'warmup',
      command: { file: 'babeldoc.exe', args: ['--warmup'] },
      redact: ['secret-key'],
      parsePercent: (line) => {
        const match = /(\d{1,3})%/.exec(line);
        return match ? Number(match[1]) : null;
      },
    });

    child.stdout.emit('data', Buffer.from('loading secret-key\nprogress 42%\n'));
    child.emit('close', 0, null);

    await expect(promise).resolves.toEqual({
      code: 0,
      signal: null,
      lines: ['loading [REDACTED]', 'progress 42%'],
      canceled: false,
      timedOut: false,
    });
    expect(spawn).toHaveBeenCalledWith(
      'babeldoc.exe',
      ['--warmup'],
      expect.objectContaining({
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: expect.objectContaining({
          PYTHONIOENCODING: 'utf-8',
          PYTHONUTF8: '1',
          PYTHONUNBUFFERED: '1',
          COLUMNS: '200',
          NO_COLOR: '1',
          NO_PROXY: expect.stringContaining('127.0.0.1'),
          no_proxy: expect.stringContaining('127.0.0.1'),
        }),
      }),
    );
    expect(runner.activeJobIds()).toEqual([]);

    const progress = events
      .filter((event) => event.channel === 'tool:progress')
      .map((event) => event.payload as ToolProgressEvent);
    expect(progress).toHaveLength(2);
    expect(progress[0]).toMatchObject({
      jobId: 'job-1',
      kind: 'warmup',
      line: 'loading [REDACTED]',
      percent: null,
    });
    expect(progress[1]).toMatchObject({ line: 'progress 42%', percent: 42 });
    expect(JSON.stringify(events)).not.toContain('secret-key');
  });

  it('拼接跨块的部分行、合并 stderr，并按字面量而非正则脱敏', async () => {
    const child = fakeChild();
    const runner = new ToolJobRunner(() => {}, {
      spawn: spawnReturning(child),
      killTree: vi.fn(),
    });

    const promise = runner.run({
      jobId: 'job-2',
      kind: 'install',
      command: { file: 'uv', args: ['tool', 'install'] },
      redact: ['a.b'],
    });

    child.stdout.emit('data', Buffer.from('hello '));
    child.stderr.emit('data', Buffer.from('warn a.b axb\r\n'));
    child.stdout.emit('data', Buffer.from('world\ntail'));
    child.emit('close', 1, null);

    await expect(promise).resolves.toEqual({
      code: 1,
      signal: null,
      lines: ['warn [REDACTED] axb', 'hello world', 'tail'],
      canceled: false,
      timedOut: false,
    });
  });

  it('按单独回车拆分行内进度刷新，且不把 CRLF 拆成空行', async () => {
    const child = fakeChild();
    const runner = new ToolJobRunner(() => {}, {
      spawn: spawnReturning(child),
      killTree: vi.fn(),
    });

    const promise = runner.run({
      jobId: 'job-cr',
      kind: 'translate',
      command: { file: 'babeldoc.exe', args: [] },
    });

    // BabelDOC's rich progress refreshes with a bare \r inside a pipe; the
    // intermediate update must surface as its own line, not stay buffered.
    child.stdout.emit('data', Buffer.from('translate 10/100\rtranslate 20/100\r'));
    child.stdout.emit('data', Buffer.from('progress 42%\r\nfinal'));
    child.emit('close', 0, null);

    await expect(promise).resolves.toEqual({
      code: 0,
      signal: null,
      lines: ['translate 10/100', 'translate 20/100', 'progress 42%', 'final'],
      canceled: false,
      timedOut: false,
    });
  });

  it('收尾进度事件携带最近一次解析到的百分比', async () => {
    const child = fakeChild();
    const events: CapturedEvent[] = [];
    const runner = new ToolJobRunner((channel, payload) => events.push({ channel, payload }), {
      spawn: spawnReturning(child),
      killTree: vi.fn(),
    });

    const promise = runner.run({
      jobId: 'job-3',
      kind: 'warmup',
      command: { file: 'babeldoc.exe', args: ['--warmup'] },
      parsePercent: (line) => {
        const match = /(\d{1,3})%/.exec(line);
        return match ? Number(match[1]) : null;
      },
    });

    child.stdout.emit('data', Buffer.from('progress 10%\nstill working\n'));
    child.emit('close', 0, null);

    await promise;
    const progress = events
      .filter((event) => event.channel === 'tool:progress')
      .map((event) => event.payload as ToolProgressEvent);
    expect(progress[1]).toMatchObject({ line: 'still working', percent: 10 });
  });

  it('cancel 终止进程树并解析出 canceled 结果', async () => {
    const child = fakeChild(123);
    const killTree = vi.fn();
    const runner = new ToolJobRunner(() => {}, {
      spawn: spawnReturning(child),
      killTree,
    });

    const promise = runner.run({
      jobId: 'job-4',
      kind: 'install',
      command: { file: 'uv', args: [] },
    });

    expect(runner.activeJobIds()).toEqual(['job-4']);
    expect(runner.cancel('missing')).toBe(false);
    expect(runner.cancel('job-4')).toBe(true);
    expect(runner.cancel('job-4')).toBe(true);
    expect(killTree).toHaveBeenCalledTimes(2);
    expect(killTree).toHaveBeenCalledWith(123);

    child.emit('close', null, 'SIGTERM');
    const result = await promise;
    expect(result).toMatchObject({ canceled: true, code: null, signal: 'SIGTERM' });
    expect(result.timedOut).toBe(false);
    expect(runner.activeJobIds()).toEqual([]);
  });

  it('cancelAll 取消所有活动任务', async () => {
    const first = fakeChild(11);
    const second = fakeChild(22);
    const children = [first, second];
    const spawn = vi.fn(() => children.shift()) as unknown as typeof nodeSpawn;
    const killTree = vi.fn();
    const runner = new ToolJobRunner(() => {}, { spawn, killTree });

    const firstRun = runner.run({
      jobId: 'a',
      kind: 'install',
      command: { file: 'x', args: [] },
    });
    const secondRun = runner.run({
      jobId: 'b',
      kind: 'warmup',
      command: { file: 'y', args: [] },
    });
    expect(runner.activeJobIds()).toEqual(['a', 'b']);

    runner.cancelAll();
    expect(killTree.mock.calls).toEqual([[11], [22]]);

    first.emit('close', null, 'SIGTERM');
    second.emit('close', null, 'SIGTERM');
    await expect(firstRun).resolves.toMatchObject({ canceled: true });
    await expect(secondRun).resolves.toMatchObject({ canceled: true });
    expect(runner.activeJobIds()).toEqual([]);
  });

  it('进程启动失败时以中文错误拒绝', async () => {
    const child = fakeChild();
    const runner = new ToolJobRunner(() => {}, {
      spawn: spawnReturning(child),
      killTree: vi.fn(),
    });

    const promise = runner.run({
      jobId: 'job-5',
      kind: 'install',
      command: { file: 'missing', args: [] },
    });
    child.emit('error', new Error('spawn missing ENOENT'));

    await expect(promise).rejects.toThrow('无法启动进程：spawn missing ENOENT');
    expect(runner.activeJobIds()).toEqual([]);
  });

  it('spawn 同步抛出时也转为中文错误', async () => {
    const spawn = vi.fn(() => {
      throw new Error('bad args');
    }) as unknown as typeof nodeSpawn;
    const runner = new ToolJobRunner(() => {}, { spawn, killTree: vi.fn() });

    await expect(
      runner.run({ jobId: 'job-6', kind: 'install', command: { file: 'x', args: [] } }),
    ).rejects.toThrow('无法启动进程：bad args');
    expect(runner.activeJobIds()).toEqual([]);
  });

  it('超时后终止进程树并标记 timedOut', async () => {
    vi.useFakeTimers();
    const child = fakeChild(321);
    const killTree = vi.fn();
    const runner = new ToolJobRunner(() => {}, {
      spawn: spawnReturning(child),
      killTree,
    });

    const promise = runner.run({
      jobId: 'job-7',
      kind: 'warmup',
      command: { file: 'babeldoc.exe', args: ['--warmup'] },
      timeoutMs: 1000,
    });

    vi.advanceTimersByTime(1000);
    expect(killTree).toHaveBeenCalledWith(321);

    child.emit('close', null, 'SIGTERM');
    await expect(promise).resolves.toMatchObject({
      canceled: false,
      timedOut: true,
      signal: 'SIGTERM',
    });
    expect(runner.activeJobIds()).toEqual([]);
  });
});
