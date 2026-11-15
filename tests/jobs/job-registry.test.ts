import { describe, expect, it } from 'vitest';
import { JobRegistry } from '@main/jobs/job-registry';
import type { JobState } from '@shared/types';

const BUSY = '请先等待当前任务完成';
const TRANSLATING = '该文献正在翻译，暂不能删除、重新定位或绑定译本';

describe('JobRegistry', () => {
  it('存储任务互斥，变更根目录复用存储标记', () => {
    const states: JobState[] = [];
    const jobs = new JobRegistry((state) => states.push(state));

    jobs.tryAcquireStorage('import');
    expect(() => jobs.tryAcquireStorage('remove')).toThrow(BUSY);
    jobs.releaseStorage();

    jobs.tryAcquireChangeRoot();
    expect(jobs.getState().storageTask).toBe('changeRoot');
    jobs.releaseStorage();

    jobs.tryAcquireTranslation(5, 'job-1');
    expect(() => jobs.tryAcquireStorage('remove')).toThrow(BUSY);
    expect(() => jobs.tryAcquireChangeRoot()).toThrow(BUSY);
    expect(() => jobs.assertPaperNotTranslating(5)).toThrow(TRANSLATING);
    expect(() => jobs.tryAcquireTool('install', 'job-2')).toThrow(BUSY);
    jobs.releaseTranslation('job-1');

    expect(jobs.getState()).toMatchObject({
      storageTask: null,
      toolTask: null,
      translatingPaperId: null,
    });
    expect(states.length).toBeGreaterThan(0);
  });

  it('变更根目录要求存储任务与工具任务都空闲', () => {
    const jobs = new JobRegistry();

    jobs.tryAcquireTool('install', 'job-x');
    expect(() => jobs.tryAcquireChangeRoot()).toThrow(BUSY);
    expect(jobs.getState()).toMatchObject({
      storageTask: null,
      toolTask: 'install',
      toolJobId: 'job-x',
    });

    jobs.releaseTool('job-x');
    jobs.tryAcquireChangeRoot();
    expect(jobs.getState()).toMatchObject({
      storageTask: 'changeRoot',
      toolTask: null,
    });
    jobs.releaseStorage();
  });

  it('每次状态变化都通知监听者，状态是完整快照', () => {
    const states: JobState[] = [];
    const jobs = new JobRegistry((state) => states.push(state));

    jobs.tryAcquireStorage('import', 3);
    jobs.releaseStorage();

    expect(states).toEqual([
      {
        storageTask: 'import',
        storagePaperId: 3,
        toolTask: null,
        toolJobId: null,
        translatingPaperId: null,
      },
      {
        storageTask: null,
        storagePaperId: null,
        toolTask: null,
        toolJobId: null,
        translatingPaperId: null,
      },
    ]);
  });

  it('获取失败与空操作释放都不触发通知', () => {
    const states: JobState[] = [];
    const jobs = new JobRegistry((state) => states.push(state));

    jobs.releaseStorage();
    jobs.releaseTool('missing');
    jobs.releaseTranslation('missing');
    expect(states).toEqual([]);

    jobs.tryAcquireStorage('import');
    states.length = 0;
    expect(() => jobs.tryAcquireStorage('remove')).toThrow(BUSY);
    expect(states).toEqual([]);
  });

  it('工具任务互斥，释放只匹配自己的 jobId', () => {
    const jobs = new JobRegistry();

    jobs.tryAcquireTool('install', 'job-1');
    expect(jobs.getState()).toMatchObject({ toolTask: 'install', toolJobId: 'job-1' });
    expect(() => jobs.tryAcquireTool('warmup', 'job-2')).toThrow(BUSY);

    jobs.releaseTool('job-2');
    expect(jobs.getState()).toMatchObject({ toolTask: 'install', toolJobId: 'job-1' });

    jobs.releaseTool('job-1');
    expect(jobs.getState()).toMatchObject({ toolTask: null, toolJobId: null });
    jobs.releaseTool('job-1');
    expect(jobs.getState().toolTask).toBeNull();
  });

  it('翻译同时占用存储与工具标记，释放清空全部字段', () => {
    const jobs = new JobRegistry();

    jobs.tryAcquireTranslation(5, 'job-1');
    expect(jobs.getState()).toEqual({
      storageTask: 'translate',
      storagePaperId: 5,
      toolTask: 'translate',
      toolJobId: 'job-1',
      translatingPaperId: 5,
    });
    expect(jobs.isPaperTranslating(5)).toBe(true);
    expect(jobs.isPaperTranslating(6)).toBe(false);
    expect(() => jobs.assertPaperNotTranslating(6)).not.toThrow();
    expect(() => jobs.tryAcquireTranslation(6, 'job-2')).toThrow(BUSY);

    jobs.releaseTranslation('other');
    expect(jobs.isPaperTranslating(5)).toBe(true);

    jobs.releaseTranslation('job-1');
    expect(jobs.getState()).toEqual({
      storageTask: null,
      storagePaperId: null,
      toolTask: null,
      toolJobId: null,
      translatingPaperId: null,
    });

    jobs.releaseTranslation('job-1');
    expect(jobs.getState().translatingPaperId).toBeNull();
  });

  it('翻译需要存储与工具都空闲', () => {
    const jobs = new JobRegistry();

    jobs.tryAcquireStorage('import');
    expect(() => jobs.tryAcquireTranslation(1, 'job-1')).toThrow(BUSY);
    jobs.releaseStorage();

    jobs.tryAcquireTool('install', 'job-2');
    expect(() => jobs.tryAcquireTranslation(1, 'job-1')).toThrow(BUSY);
    jobs.releaseTool('job-2');

    jobs.tryAcquireTranslation(1, 'job-1');
    expect(jobs.isPaperTranslating(1)).toBe(true);
  });

  it('getState 返回快照，外部修改不影响内部状态', () => {
    const jobs = new JobRegistry();
    jobs.tryAcquireStorage('import');

    const snapshot = jobs.getState();
    snapshot.storageTask = 'remove';
    snapshot.storagePaperId = 9;

    expect(jobs.getState()).toMatchObject({
      storageTask: 'import',
      storagePaperId: null,
    });
  });
});
