import type { JobState, StorageTask, ToolTask } from '@shared/types';

const BUSY_MESSAGE = '请先等待当前任务完成';
const PAPER_TRANSLATING_MESSAGE = '该文献正在翻译，暂不能删除、重新定位或绑定译本';

/**
 * Global main-process concurrency gate. Storage-changing tasks and tool jobs
 * each allow one holder; a whole-paper translation holds both markers so no
 * storage task or other tool job can start while it runs.
 */
export class JobRegistry {
  private storageTask: StorageTask | null = null;
  private storagePaperId: number | null = null;
  private toolTask: ToolTask | null = null;
  private toolJobId: string | null = null;
  private translatingPaperId: number | null = null;
  private readonly onChange: (state: JobState) => void;

  constructor(onChange: (state: JobState) => void = () => {}) {
    this.onChange = onChange;
  }

  tryAcquireStorage(task: StorageTask, paperId?: number): void {
    if (this.storageTask !== null) {
      throw new Error(BUSY_MESSAGE);
    }
    this.storageTask = task;
    this.storagePaperId = paperId ?? null;
    this.notify();
  }

  releaseStorage(): void {
    // The translation marker is released as a whole through releaseTranslation.
    if (this.storageTask === null || this.storageTask === 'translate') {
      return;
    }
    this.storageTask = null;
    this.storagePaperId = null;
    this.notify();
  }

  tryAcquireTool(task: ToolTask, jobId: string): void {
    if (this.toolTask !== null) {
      throw new Error(BUSY_MESSAGE);
    }
    this.toolTask = task;
    this.toolJobId = jobId;
    this.notify();
  }

  releaseTool(jobId: string): void {
    // The translation marker is released as a whole through releaseTranslation.
    if (this.toolTask === null || this.toolTask === 'translate' || this.toolJobId !== jobId) {
      return;
    }
    this.toolTask = null;
    this.toolJobId = null;
    this.notify();
  }

  tryAcquireTranslation(paperId: number, jobId: string): void {
    if (this.storageTask !== null || this.toolTask !== null) {
      throw new Error(BUSY_MESSAGE);
    }
    this.storageTask = 'translate';
    this.storagePaperId = paperId;
    this.toolTask = 'translate';
    this.toolJobId = jobId;
    this.translatingPaperId = paperId;
    this.notify();
  }

  releaseTranslation(jobId: string): void {
    if (this.translatingPaperId === null || this.toolJobId !== jobId) {
      return;
    }
    this.storageTask = null;
    this.storagePaperId = null;
    this.toolTask = null;
    this.toolJobId = null;
    this.translatingPaperId = null;
    this.notify();
  }

  tryAcquireChangeRoot(): void {
    // A root change rewrites every managed path, so no storage task and no
    // tool job (install/warmup/whole-paper translation) may be running.
    if (this.storageTask !== null || this.toolTask !== null) {
      throw new Error(BUSY_MESSAGE);
    }
    this.tryAcquireStorage('changeRoot');
  }

  assertPaperNotTranslating(paperId: number): void {
    if (this.isPaperTranslating(paperId)) {
      throw new Error(PAPER_TRANSLATING_MESSAGE);
    }
  }

  isPaperTranslating(paperId: number): boolean {
    return this.translatingPaperId === paperId;
  }

  getState(): JobState {
    return {
      storageTask: this.storageTask,
      storagePaperId: this.storagePaperId,
      toolTask: this.toolTask,
      toolJobId: this.toolJobId,
      translatingPaperId: this.translatingPaperId,
    };
  }

  private notify(): void {
    this.onChange(this.getState());
  }
}
