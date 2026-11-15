import { create } from 'zustand';
import type {
  Paper,
  TranslationJobInfo,
} from '@shared/types';
import { errorMessage, stripIpcErrorPrefix } from '../lib/errors';
import { useLibraryStore } from './library';

/** Progress log lines kept in the card; older lines are dropped. */
const MAX_LOG_LINES = 100;

export interface TranslationState {
  /** Latest whole-paper job, running or terminal; null when dismissed/idle. */
  job: TranslationJobInfo | null;
  logs: string[];
  /** True while the log panel is collapsed to save space. */
  collapsed: boolean;
  /** Paper rebound by the last successful translation. */
  donePaper: Paper | null;
  init(): () => void;
  start(paperId: number): Promise<void>;
  cancel(): Promise<void>;
  dismiss(): void;
  toggleLogs(): void;
}

// `init` is called from a React effect that StrictMode mounts twice; subscribe
// once and let the returned cleanup re-arm the subscription.
let unsubscribeEvents: (() => void) | null = null;

function runningJob(
  jobId: string,
  paperId: number,
  title: string,
  logs: string[] = [],
): TranslationJobInfo {
  return {
    jobId,
    paperId,
    title,
    status: 'running',
    percent: null,
    line: '',
    logs,
    error: null,
  };
}

/** Keeps the newest 100 lines and mirrors them into the job snapshot. */
function appendLog(
  job: TranslationJobInfo,
  logs: string[],
  line: string,
  percent: number | null,
): { job: TranslationJobInfo; logs: string[] } {
  const nextLogs = [...logs, line].slice(-MAX_LOG_LINES);
  return {
    logs: nextLogs,
    job: {
      ...job,
      percent: percent ?? job.percent,
      line,
      logs: nextLogs,
    },
  };
}

export const useTranslationStore = create<TranslationState>()((set, get) => ({
  job: null,
  logs: [],
  collapsed: false,
  donePaper: null,

  init() {
    let unsubscribe = unsubscribeEvents;
    if (unsubscribe === null) {
      const offProgress = window.api.translation.onProgress((event) => {
        set((state) => {
          if (state.job === null || state.job.jobId !== event.jobId) {
            return state;
          }
          return appendLog(state.job, state.logs, event.line, event.percent);
        });
      });
      const offDone = window.api.translation.onDone((event) => {
        set((state) => {
          const job =
            state.job !== null && state.job.jobId === event.jobId
              ? state.job
              : runningJob(event.jobId, event.paper.id, event.paper.title);
          return {
            job: {
              ...job,
              status: 'done',
              percent: 100,
              line: '翻译完成',
              error: null,
            },
            donePaper: event.paper,
          };
        });
        // The rebinding changed metadata and file status for this paper.
        void useLibraryStore
          .getState()
          .load()
          .catch(() => undefined);
      });
      const offFailed = window.api.translation.onFailed((event) => {
        set((state) => {
          const job =
            state.job !== null && state.job.jobId === event.jobId
              ? state.job
              : runningJob(event.jobId, event.paperId, '');
          return {
            job: {
              ...job,
              status: 'failed',
              line: event.message,
              error: event.message,
            },
          };
        });
      });
      const offCanceled = window.api.translation.onCanceled((event) => {
        set((state) => {
          const job =
            state.job !== null && state.job.jobId === event.jobId
              ? state.job
              : runningJob(event.jobId, event.paperId, '');
          return {
            job: { ...job, status: 'canceled', line: '已取消', error: null },
          };
        });
      });
      unsubscribe = () => {
        offProgress();
        offDone();
        offFailed();
        offCanceled();
        unsubscribeEvents = null;
      };
      unsubscribeEvents = unsubscribe;
    }

    // A running job survives a renderer reload: restore it from the main
    // process. A terminal event may already have arrived, so never overwrite a
    // newer job snapshot.
    void window.api.translation
      .getState()
      .then((job) => {
        if (job === null) {
          return;
        }
        set((state) => {
          if (state.job !== null && state.job.jobId !== job.jobId) {
            return state;
          }
          if (state.job !== null && state.job.status !== 'running') {
            return state;
          }
          return { job, logs: job.logs.slice(-MAX_LOG_LINES) };
        });
      })
      .catch(() => undefined);
    return unsubscribe;
  },

  async start(paperId) {
    try {
      const result = await window.api.translation.start(paperId);
      set({
        job: runningJob(result.jobId, result.paperId, result.title),
        logs: [],
        collapsed: false,
        donePaper: null,
      });
    } catch (error) {
      // Callers compare the exact missing-engine message to open settings, so
      // Electron's English IPC wrapper must never reach them.
      const message = stripIpcErrorPrefix(errorMessage(error));
      throw new Error(message);
    }
  },

  async cancel() {
    const job = get().job;
    if (job === null || job.status !== 'running') {
      return;
    }
    try {
      await window.api.translation.cancel(job.jobId);
    } catch (error) {
      const message = stripIpcErrorPrefix(errorMessage(error));
      set((state) => ({
        job: state.job === null ? null : { ...state.job, error: message, line: message },
      }));
    }
  },

  dismiss() {
    set((state) => {
      if (state.job === null || state.job.status === 'running') {
        return state;
      }
      return { job: null, logs: [], collapsed: false, donePaper: null };
    });
  },

  toggleLogs() {
    set((state) => ({ collapsed: !state.collapsed }));
  },
}));
