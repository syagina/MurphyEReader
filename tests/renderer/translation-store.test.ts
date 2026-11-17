// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  Paper,
  TranslationCanceledEvent,
  TranslationDoneEvent,
  TranslationFailedEvent,
  TranslationJobInfo,
  TranslationProgressEvent,
  TranslationStartResult,
} from '@shared/types';
import { useTranslationStore } from '@renderer/stores/translation';

type ProgressCallback = (event: TranslationProgressEvent) => void;
type DoneCallback = (event: TranslationDoneEvent) => void;
type FailedCallback = (event: TranslationFailedEvent) => void;
type CanceledCallback = (event: TranslationCanceledEvent) => void;

function makePaper(overrides: Partial<Paper> = {}): Paper {
  return {
    id: 7,
    title: '样本论文',
    authors: '',
    year: null,
    filePathOriginal: 'C:/papers/original.pdf',
    filePathTranslated: 'C:/papers/translated.zh-CN.mono.pdf',
    pageCountOriginal: 2,
    pageCountTranslated: 2,
    hasTextLayer: true,
    outline: [],
    tags: [],
    folderId: null,
    storageDir: 'papers/样本论文 (7)',
    fileHash: null,
    lastPageOriginal: 1,
    lastPageTranslated: 1,
    addedAt: 1,
    lastReadAt: null,
    ...overrides,
  };
}

function makeJob(overrides: Partial<TranslationJobInfo> = {}): TranslationJobInfo {
  return {
    jobId: 'job-1',
    paperId: 7,
    title: '样本论文',
    status: 'running',
    startedAt: 1_700_000_000_000,
    percent: null,
    line: '',
    logs: [],
    error: null,
    ...overrides,
  };
}

interface Harness {
  callbacks: {
    progress: ProgressCallback | null;
    done: DoneCallback | null;
    failed: FailedCallback | null;
    canceled: CanceledCallback | null;
  };
  api: {
    start: ReturnType<typeof vi.fn>;
    getState: ReturnType<typeof vi.fn>;
    cancel: ReturnType<typeof vi.fn>;
  };
  cleanup: (() => void) | null;
}

function installApi(): Harness {
  const callbacks: Harness['callbacks'] = {
    progress: null,
    done: null,
    failed: null,
    canceled: null,
  };
  const api = {
    start: vi.fn(async (): Promise<TranslationStartResult> => ({
      jobId: 'job-1',
      paperId: 7,
      title: '样本论文',
    })),
    getState: vi.fn(async (): Promise<TranslationJobInfo | null> => null),
    cancel: vi.fn(async (_jobId: string): Promise<void> => undefined),
  };
  const translation = {
    ...api,
    onProgress: vi.fn((cb: ProgressCallback) => {
      callbacks.progress = cb;
      return () => {
        callbacks.progress = null;
      };
    }),
    onDone: vi.fn((cb: DoneCallback) => {
      callbacks.done = cb;
      return () => {
        callbacks.done = null;
      };
    }),
    onFailed: vi.fn((cb: FailedCallback) => {
      callbacks.failed = cb;
      return () => {
        callbacks.failed = null;
      };
    }),
    onCanceled: vi.fn((cb: CanceledCallback) => {
      callbacks.canceled = cb;
      return () => {
        callbacks.canceled = null;
      };
    }),
  };
  const papers = {
    list: vi.fn(async (): Promise<Paper[]> => [makePaper()]),
    checkFiles: vi.fn(async () => [
      {
        id: 7,
        originalExists: true,
        translatedExists: true,
        bilingualExists: false,
        translatedIsBilingual: false,
      },
    ]),
  };
  (window as unknown as { api: unknown }).api = { translation, papers };
  return { callbacks, api, cleanup: null };
}

let harness: Harness;

beforeEach(() => {
  harness = installApi();
  useTranslationStore.setState({
    job: null,
    logs: [],
    collapsed: false,
    hidden: false,
    donePaper: null,
  });
});

afterEach(() => {
  harness.cleanup?.();
  harness.cleanup = null;
  vi.restoreAllMocks();
});

describe('useTranslationStore.init', () => {
  it('恢复主进程中仍在运行的翻译任务', async () => {
    const running = makeJob({ percent: 30, line: '30% 完成', logs: ['30% 完成'] });
    harness.api.getState.mockResolvedValue(running);

    harness.cleanup = useTranslationStore.getState().init();

    await vi.waitFor(() => {
      expect(useTranslationStore.getState().job).toEqual(running);
    });
    expect(useTranslationStore.getState().logs).toEqual(['30% 完成']);
  });

  it('进度追加日志最多 100 行并更新百分比', async () => {
    harness.cleanup = useTranslationStore.getState().init();
    await useTranslationStore.getState().start(7);

    for (let index = 1; index <= 120; index += 1) {
      harness.callbacks.progress?.({
        jobId: 'job-1',
        paperId: 7,
        percent: Math.min(100, index),
        line: `第 ${index} 行`,
      });
    }

    const state = useTranslationStore.getState();
    expect(state.logs).toHaveLength(100);
    expect(state.logs[0]).toBe('第 21 行');
    expect(state.logs[99]).toBe('第 120 行');
    expect(state.job?.percent).toBe(100);
    expect(state.job?.line).toBe('第 120 行');
  });

  it('心跳进度只更新当前行，不写入日志历史', async () => {
    harness.cleanup = useTranslationStore.getState().init();
    await useTranslationStore.getState().start(7);
    harness.callbacks.progress?.({
      jobId: 'job-1',
      paperId: 7,
      percent: 10,
      line: 'BabelDOC 翻译进度：10%',
    });

    harness.callbacks.progress?.({
      jobId: 'job-1',
      paperId: 7,
      percent: 10,
      line: 'AI 已返回 8 段，等待返回 2 段…（已用时 30 秒）',
      appendLog: false,
    });

    const state = useTranslationStore.getState();
    expect(state.logs).toEqual(['BabelDOC 翻译进度：10%']);
    expect(state.job?.line).toBe('AI 已返回 8 段，等待返回 2 段…（已用时 30 秒）');
    expect(state.job?.percent).toBe(10);
  });

  it('完成事件保存最新文献并刷新文献库', async () => {
    harness.cleanup = useTranslationStore.getState().init();
    await useTranslationStore.getState().start(7);
    const updated = makePaper({ pageCountTranslated: 3 });

    harness.callbacks.done?.({ jobId: 'job-1', paper: updated });

    await vi.waitFor(() => {
      expect(useTranslationStore.getState().job?.status).toBe('done');
    });
    expect(useTranslationStore.getState().job?.line).toBe('翻译完成');
    expect(useTranslationStore.getState().donePaper).toEqual(updated);
    await vi.waitFor(() => {
      expect((window.api.papers.list as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
    });
  });

  it('完成事件带有补充说明时以它为完成行', async () => {
    harness.cleanup = useTranslationStore.getState().init();
    await useTranslationStore.getState().start(7);
    const updated = makePaper({ pageCountTranslated: 3 });

    harness.callbacks.done?.({
      jobId: 'job-1',
      paper: updated,
      message: '翻译完成（已改用双语对照版，避免内容遗漏）',
    });

    await vi.waitFor(() => {
      expect(useTranslationStore.getState().job?.status).toBe('done');
    });
    expect(useTranslationStore.getState().job?.line).toBe(
      '翻译完成（已改用双语对照版，避免内容遗漏）',
    );
  });

  it('失败与取消事件分别记录状态，dismiss 清空终态', async () => {
    harness.cleanup = useTranslationStore.getState().init();
    await useTranslationStore.getState().start(7);

    harness.callbacks.failed?.({ jobId: 'job-1', paperId: 7, message: '网络连接失败' });
    expect(useTranslationStore.getState().job).toMatchObject({
      status: 'failed',
      error: '网络连接失败',
    });
    expect(useTranslationStore.getState().dismiss).toBeTypeOf('function');
    harness.callbacks.canceled?.({ jobId: 'job-1', paperId: 7 });
    expect(useTranslationStore.getState().job?.status).toBe('canceled');

    useTranslationStore.getState().dismiss();
    expect(useTranslationStore.getState().job).toBeNull();
    expect(useTranslationStore.getState().logs).toEqual([]);
    expect(useTranslationStore.getState().donePaper).toBeNull();
  });
});

describe('useTranslationStore.start', () => {
  it('设置运行中的任务并可以请求取消', async () => {
    harness.cleanup = useTranslationStore.getState().init();

    await useTranslationStore.getState().start(7);

    expect(useTranslationStore.getState().job).toMatchObject({
      jobId: 'job-1',
      paperId: 7,
      title: '样本论文',
      status: 'running',
    });
    await useTranslationStore.getState().cancel();
    expect(harness.api.cancel).toHaveBeenCalledWith('job-1');
  });

  it('关闭窗口只隐藏卡片，任务继续；show 重新显示', async () => {
    harness.cleanup = useTranslationStore.getState().init();
    await useTranslationStore.getState().start(7);

    useTranslationStore.getState().hide();
    expect(useTranslationStore.getState().hidden).toBe(true);
    expect(useTranslationStore.getState().job?.status).toBe('running');
    expect(harness.api.cancel).not.toHaveBeenCalled();

    useTranslationStore.getState().show();
    expect(useTranslationStore.getState().hidden).toBe(false);
    expect(useTranslationStore.getState().job?.status).toBe('running');
  });

  it('新任务会自动重新打开此前隐藏的窗口', async () => {
    harness.cleanup = useTranslationStore.getState().init();
    await useTranslationStore.getState().start(7);
    useTranslationStore.getState().hide();

    await useTranslationStore.getState().start(7);

    expect(useTranslationStore.getState().hidden).toBe(false);
  });

  it('没有任务时 hide 不做任何事', () => {
    useTranslationStore.getState().hide();
    expect(useTranslationStore.getState().hidden).toBe(false);
  });

  it('把 Electron 前缀剥离后按固定消息重新抛出', async () => {
    harness.cleanup = useTranslationStore.getState().init();
    harness.api.start.mockRejectedValue(
      new Error(
        "Error invoking remote method 'translation:start': Error: 未检测到 BabelDOC，请在设置中安装或指定路径",
      ),
    );

    await expect(useTranslationStore.getState().start(7)).rejects.toThrow(
      '未检测到 BabelDOC，请在设置中安装或指定路径',
    );
    expect(useTranslationStore.getState().job).toBeNull();
  });

  it('未在运行时 dismiss 不会清除任务', async () => {
    harness.cleanup = useTranslationStore.getState().init();
    await useTranslationStore.getState().start(7);

    useTranslationStore.getState().dismiss();

    expect(useTranslationStore.getState().job?.status).toBe('running');
  });
});
