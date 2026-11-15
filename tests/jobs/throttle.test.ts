import { afterEach, describe, expect, it, vi } from 'vitest';
import { createThrottledEmitter } from '@main/jobs/throttle';

afterEach(() => {
  vi.useRealTimers();
});

describe('createThrottledEmitter', () => {
  it('首次立即发送，窗口内只保留最后一个值，定时器收尾', () => {
    vi.useFakeTimers();
    const out: string[] = [];
    const throttle = createThrottledEmitter<string>((value) => out.push(value), 250);

    throttle.push('first');
    throttle.push('second');
    throttle.push('third');
    expect(out).toEqual(['first']);

    vi.advanceTimersByTime(250);
    expect(out).toEqual(['first', 'third']);
  });

  it('flush 立即发送挂起值并取消定时器', () => {
    vi.useFakeTimers();
    const out: string[] = [];
    const throttle = createThrottledEmitter<string>((value) => out.push(value), 250);

    throttle.push('first');
    throttle.push('second');
    throttle.flush();
    expect(out).toEqual(['first', 'second']);

    vi.advanceTimersByTime(250);
    expect(out).toEqual(['first', 'second']);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('没有挂起值时 flush 不发送', () => {
    vi.useFakeTimers();
    const out: string[] = [];
    const throttle = createThrottledEmitter<string>((value) => out.push(value), 250);

    throttle.flush();
    expect(out).toEqual([]);

    throttle.push('only');
    expect(out).toEqual(['only']);
    throttle.flush();
    expect(out).toEqual(['only']);
  });

  it('窗口结束后下一次 push 重新立即发送', () => {
    vi.useFakeTimers();
    const out: string[] = [];
    const throttle = createThrottledEmitter<string>((value) => out.push(value), 250);

    throttle.push('a');
    vi.advanceTimersByTime(250);
    expect(vi.getTimerCount()).toBe(0);

    throttle.push('b');
    expect(out).toEqual(['a', 'b']);
  });
});
