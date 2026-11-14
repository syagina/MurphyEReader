// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SearchResult } from '@shared/types';
import { useSearchStore } from '@renderer/stores/search';

const DEBOUNCE_MS = 250;

function makePageResult(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    kind: 'page',
    paperId: 1,
    paperTitle: '有限元方法导论',
    snippet: '…有限元方法的核心思想…',
    pageNo: 12,
    ...overrides,
  };
}

function makeMessageResult(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    kind: 'message',
    paperId: 1,
    paperTitle: '有限元方法导论',
    snippet: '关于模型边界的讨论',
    conversationId: 3,
    ...overrides,
  };
}

function makeNoteResult(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    kind: 'note',
    paperId: 2,
    paperTitle: '热传导模型',
    snippet: '笔记里的模型假设',
    noteId: 7,
    ...overrides,
  };
}

function installApi() {
  const global = vi.fn(async (_query: string): Promise<SearchResult[]> => []);
  (window as unknown as { api: unknown }).api = { search: { global } };
  return { global };
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Lets pending promise continuations run without advancing fake timers. */
async function flushAsync(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

let api: ReturnType<typeof installApi>;

beforeEach(() => {
  vi.useFakeTimers();
  api = installApi();
  useSearchStore.getState().clear();
});

afterEach(() => {
  useSearchStore.getState().clear();
  vi.useRealTimers();
});

describe('useSearchStore.setQuery', () => {
  it('空查询不发起请求并清空结果', async () => {
    useSearchStore.setState({ results: [makePageResult()] });

    useSearchStore.getState().setQuery('   ');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS * 4);

    expect(api.global).not.toHaveBeenCalled();
    const state = useSearchStore.getState();
    expect(state.query).toBe('   ');
    expect(state.results).toEqual([]);
    expect(state.searching).toBe(false);
  });

  it('防抖结束后只发起一次请求并填充结果', async () => {
    const results = [makePageResult(), makeMessageResult(), makeNoteResult()];
    api.global.mockResolvedValue(results);

    useSearchStore.getState().setQuery('有限元');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS - 1);
    expect(api.global).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(api.global).toHaveBeenCalledTimes(1);
    expect(api.global).toHaveBeenCalledWith('有限元');

    const state = useSearchStore.getState();
    expect(state.results).toEqual(results);
    expect(state.searching).toBe(false);
    expect(state.error).toBeNull();
  });

  it('连续输入只在防抖后请求最后一个查询', async () => {
    api.global.mockResolvedValue([makePageResult({ snippet: '最后一次' })]);

    useSearchStore.getState().setQuery('有限');
    await vi.advanceTimersByTimeAsync(100);
    useSearchStore.getState().setQuery('有限元');
    await vi.advanceTimersByTimeAsync(100);
    useSearchStore.getState().setQuery('有限元方法');
    expect(api.global).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

    expect(api.global).toHaveBeenCalledTimes(1);
    expect(api.global).toHaveBeenCalledWith('有限元方法');
    expect(useSearchStore.getState().results).toEqual([
      makePageResult({ snippet: '最后一次' }),
    ]);
  });

  it('查询变化时丢弃晚到的旧请求结果', async () => {
    const oldRequest = deferred<SearchResult[]>();
    const newRequest = deferred<SearchResult[]>();
    api.global.mockImplementation((query) =>
      query === '模型' ? oldRequest.promise : newRequest.promise,
    );

    useSearchStore.getState().setQuery('模型');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(useSearchStore.getState().searching).toBe(true);

    useSearchStore.getState().setQuery('模型分析');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(api.global).toHaveBeenCalledTimes(2);

    oldRequest.resolve([makePageResult({ snippet: '旧结果' })]);
    await flushAsync();
    expect(useSearchStore.getState().results).toEqual([]);
    expect(useSearchStore.getState().searching).toBe(true);

    const fresh = [makeNoteResult({ snippet: '新结果' })];
    newRequest.resolve(fresh);
    await flushAsync();

    const state = useSearchStore.getState();
    expect(state.results).toEqual(fresh);
    expect(state.searching).toBe(false);
  });

  it('晚到的旧请求失败不会覆盖新查询的状态', async () => {
    const oldRequest = deferred<SearchResult[]>();
    const newRequest = deferred<SearchResult[]>();
    api.global.mockImplementation((query) =>
      query === '模型' ? oldRequest.promise : newRequest.promise,
    );

    useSearchStore.getState().setQuery('模型');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    useSearchStore.getState().setQuery('模型分析');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

    oldRequest.reject(new Error('旧的搜索失败'));
    await flushAsync();
    expect(useSearchStore.getState().error).toBeNull();
    expect(useSearchStore.getState().searching).toBe(true);

    newRequest.resolve([makeNoteResult()]);
    await flushAsync();
    expect(useSearchStore.getState().error).toBeNull();
    expect(useSearchStore.getState().results).toEqual([makeNoteResult()]);
  });

  it('请求失败时记录错误并结束搜索状态', async () => {
    api.global.mockRejectedValue(new Error('搜索服务不可用'));

    useSearchStore.getState().setQuery('有限元');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

    const state = useSearchStore.getState();
    expect(state.error).toBe('搜索服务不可用');
    expect(state.results).toEqual([]);
    expect(state.searching).toBe(false);
  });
});

describe('useSearchStore.clear', () => {
  it('取消在途防抖并不会再发起请求', async () => {
    useSearchStore.getState().setQuery('有限元');
    await vi.advanceTimersByTimeAsync(100);

    useSearchStore.getState().clear();

    const state = useSearchStore.getState();
    expect(state.query).toBe('');
    expect(state.results).toEqual([]);
    expect(state.searching).toBe(false);
    expect(state.error).toBeNull();

    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS * 2);
    expect(api.global).not.toHaveBeenCalled();
  });

  it('使在途请求的结果失效', async () => {
    const request = deferred<SearchResult[]>();
    api.global.mockImplementation(() => request.promise);

    useSearchStore.getState().setQuery('有限元');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(useSearchStore.getState().searching).toBe(true);

    useSearchStore.getState().clear();
    request.resolve([makePageResult()]);
    await flushAsync();

    const state = useSearchStore.getState();
    expect(state.query).toBe('');
    expect(state.results).toEqual([]);
    expect(state.searching).toBe(false);
  });
});

describe('useSearchStore 错误展示控制', () => {
  it('setError 与 dismissError 控制错误文案', () => {
    useSearchStore.getState().setError('文献不存在: 7');
    expect(useSearchStore.getState().error).toBe('文献不存在: 7');

    useSearchStore.getState().dismissError();
    expect(useSearchStore.getState().error).toBeNull();
    expect(useSearchStore.getState().query).toBe('');
  });
});
