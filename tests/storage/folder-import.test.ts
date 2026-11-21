import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ImportPaperResult, Paper } from '@shared/types';
import { openDb } from '@main/db';
import { listPapers } from '@main/db/papers';
import { JobRegistry } from '@main/jobs/job-registry';
import {
  collectPdfFiles,
  runFolderImport,
} from '@main/storage/folder-import';
import type { FolderImportProgress } from '@main/storage/folder-import';
import { PaperLibrary } from '@main/storage/library-service';
import type { PaperLibraryDeps } from '@main/storage/library-service';
import { isPathInside } from '@main/storage/paths';
import { generateFixtures, SAMPLE_SCANNED_PDF, SAMPLE_TEXT_PDF } from '../fixtures/generate';

const BUSY = '请先等待当前任务完成';

let tempDir: string;
let root: string;
let db: Database.Database;
let jobs: JobRegistry;

function makePaper(overrides: Partial<Paper> = {}): Paper {
  return {
    id: 1,
    title: '样本文献',
    authors: '',
    year: null,
    filePathOriginal: 'C:/papers/a.pdf',
    filePathTranslated: null,
    pageCountOriginal: 1,
    pageCountTranslated: null,
    pageCountBilingual: null,
    hasTextLayer: true,
    outline: [],
    tags: [],
    folderId: null,
    storageDir: null,
    fileHash: null,
    lastPageOriginal: 1,
    lastPageTranslated: 1,
    lastVersion: 'original',
    lastOffsetOriginal: 0,
    lastOffsetTranslated: 0,
    addedAt: 1000,
    lastReadAt: null,
    ...overrides,
  };
}

function makeLibrary(overrides: Partial<PaperLibraryDeps> = {}): PaperLibrary {
  return new PaperLibrary({ db, jobs, getRoot: () => root, ...overrides });
}

beforeAll(async () => {
  await generateFixtures();
});

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'paperlens-folder-'));
  root = join(tempDir, 'library');
  db = openDb(':memory:');
  jobs = new JobRegistry();
});

afterEach(() => {
  db.close();
  rmSync(tempDir, { recursive: true, force: true });
});

describe('collectPdfFiles', () => {
  it('递归收集 PDF，大小写不敏感，排序确定并排除文献库内的文件', async () => {
    const folder = join(tempDir, 'inbox');
    const libraryRoot = join(folder, 'library');
    mkdirSync(join(folder, 'nested'), { recursive: true });
    mkdirSync(join(libraryRoot, 'papers', 'Managed (1)'), { recursive: true });
    writeFileSync(join(folder, 'b.pdf'), 'b');
    writeFileSync(join(folder, 'A.PDF'), 'a');
    writeFileSync(join(folder, 'notes.txt'), 'x');
    writeFileSync(join(folder, 'nested', 'c.pdf'), 'c');
    writeFileSync(join(libraryRoot, 'papers', 'Managed (1)', 'original.pdf'), 'managed');

    const files = await collectPdfFiles(folder, libraryRoot);

    expect(files.map((file) => relative(folder, file))).toEqual([
      'A.PDF',
      'b.pdf',
      join('nested', 'c.pdf'),
    ]);
    expect(files.some((file) => isPathInside(libraryRoot, file, 'win32'))).toBe(false);
  });

  it('跳过符号链接（junction）指向的目录', async () => {
    const folder = join(tempDir, 'inbox');
    const outside = join(tempDir, 'outside');
    mkdirSync(folder, { recursive: true });
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(folder, 'real.pdf'), 'real');
    writeFileSync(join(outside, 'linked.pdf'), 'linked');
    try {
      symlinkSync(
        outside,
        join(folder, 'linked-dir'),
        process.platform === 'win32' ? 'junction' : 'dir',
      );
    } catch {
      // The environment cannot create links; nothing left to verify here.
      return;
    }

    const files = await collectPdfFiles(folder, join(tempDir, 'library'));

    expect(files.map((file) => relative(folder, file))).toEqual(['real.pdf']);
  });

  it('空文件夹返回空列表', async () => {
    const folder = join(tempDir, 'empty');
    mkdirSync(folder, { recursive: true });

    expect(await collectPdfFiles(folder, root)).toEqual([]);
  });
});

describe('runFolderImport', () => {
  it('统计成功、重复跳过与单个失败', async () => {
    const result = await runFolderImport(
      ['a.pdf', 'b.pdf', 'c.pdf'],
      async (file) => {
        if (file === 'b.pdf') return { paper: makePaper({ id: 2 }), duplicate: true };
        if (file === 'c.pdf') throw new Error('坏 PDF');
        return { paper: makePaper({ id: 1 }), duplicate: false };
      },
      { isCanceled: () => false, onProgress: () => undefined },
    );

    expect(result).toMatchObject({
      imported: 1,
      skipped: 1,
      failed: [{ file: 'c.pdf' }],
      canceled: false,
    });
    expect(result.failed[0]?.message).toBe('坏 PDF');
  });

  it('恢复的重复文件计入导入而不是跳过', async () => {
    const result = await runFolderImport(
      ['a.pdf', 'b.pdf'],
      async (file) =>
        file === 'a.pdf'
          ? { paper: makePaper({ id: 1 }), duplicate: true, restored: true }
          : { paper: makePaper({ id: 2 }), duplicate: true },
      { isCanceled: () => false, onProgress: () => undefined },
    );

    expect(result).toMatchObject({ imported: 1, skipped: 1, failed: [] });
  });

  it('取消后当前文件完成、后续文件不再开始且已导入结果保留', async () => {
    const started: string[] = [];
    let canceled = false;

    const result = await runFolderImport(
      ['a.pdf', 'b.pdf', 'c.pdf'],
      async (file): Promise<ImportPaperResult> => {
        started.push(file);
        return { paper: makePaper({ id: started.length }), duplicate: false };
      },
      {
        isCanceled: () => canceled,
        onProgress: (event) => {
          if (event.phase === 'copy') {
            canceled = true;
          }
        },
      },
    );

    expect(started).toEqual(['a.pdf']);
    expect(result).toMatchObject({ imported: 1, skipped: 0, failed: [], canceled: true });
  });

  it('空文件列表返回全零摘要并发出 scan 与 done', async () => {
    const progress: FolderImportProgress[] = [];

    const result = await runFolderImport(
      [],
      async () => {
        throw new Error('不应调用');
      },
      {
        isCanceled: () => false,
        onProgress: (event) => progress.push(event),
      },
    );

    expect(result).toEqual({ imported: 0, skipped: 0, failed: [], canceled: false });
    expect(progress.map((event) => event.phase)).toEqual(['scan', 'done']);
  });
});

describe('PaperLibrary.importFolder', () => {
  it('整批只占一个租约，递归导入并保留源文件，最后发出 done', async () => {
    const folder = join(tempDir, 'inbox');
    mkdirSync(join(folder, 'nested'), { recursive: true });
    copyFileSync(SAMPLE_TEXT_PDF, join(folder, 'a.pdf'));
    copyFileSync(SAMPLE_SCANNED_PDF, join(folder, 'nested', 'b.pdf'));
    const progress: { jobId: string; phase: string; current: number; total: number }[] = [];
    const library = makeLibrary({
      emit: (channel, payload) => {
        expect(channel).toBe('storage:importProgress');
        progress.push(payload as (typeof progress)[number]);
      },
    });

    const summary = await library.importFolder(folder);

    expect(summary).toEqual({ imported: 2, skipped: 0, failed: [], canceled: false });
    expect(listPapers(db)).toHaveLength(2);
    expect(existsSync(join(folder, 'a.pdf'))).toBe(true);
    expect(existsSync(join(folder, 'nested', 'b.pdf'))).toBe(true);
    expect(jobs.getState().storageTask).toBeNull();
    for (const paper of listPapers(db)) {
      expect(paper.storageDir).not.toBeNull();
      expect(existsSync(paper.filePathOriginal)).toBe(true);
    }
    expect(progress[0]).toMatchObject({ phase: 'scan', total: 2 });
    expect(progress[progress.length - 1]).toMatchObject({ phase: 'done', total: 2 });
    expect(new Set(progress.map((event) => event.jobId)).size).toBe(1);
  });

  it('导入期间其他存储任务报忙，结束后释放租约', async () => {
    const folder = join(tempDir, 'inbox');
    mkdirSync(folder, { recursive: true });
    copyFileSync(SAMPLE_TEXT_PDF, join(folder, 'a.pdf'));
    let releaseCopy!: () => void;
    const copyGate = new Promise<void>((resolve) => {
      releaseCopy = resolve;
    });
    let markStarted!: () => void;
    const copyStarted = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const library = makeLibrary({
      copyFile: async (source, target) => {
        markStarted();
        await copyGate;
        copyFileSync(source, target);
      },
    });

    const running = library.importFolder(folder);
    await copyStarted;

    expect(jobs.getState().storageTask).toBe('importFolder');
    expect(() => jobs.tryAcquireStorage('import')).toThrow(BUSY);

    releaseCopy();
    const summary = await running;

    expect(summary.imported).toBe(1);
    expect(jobs.getState().storageTask).toBeNull();
  });

  it('已导入过的文件按哈希计入跳过且不重复入库', async () => {
    const library = makeLibrary();
    await library.importPaper(SAMPLE_TEXT_PDF);
    const folder = join(tempDir, 'inbox');
    mkdirSync(folder, { recursive: true });
    copyFileSync(SAMPLE_TEXT_PDF, join(folder, 'again.pdf'));

    const summary = await library.importFolder(folder);

    expect(summary).toMatchObject({ imported: 0, skipped: 1, failed: [], canceled: false });
    expect(listPapers(db)).toHaveLength(1);
  });

  it('单个坏 PDF 记入失败，其他文件继续导入', async () => {
    const folder = join(tempDir, 'inbox');
    mkdirSync(folder, { recursive: true });
    copyFileSync(SAMPLE_TEXT_PDF, join(folder, 'good.pdf'));
    writeFileSync(join(folder, 'bad.pdf'), '这不是 PDF');

    const summary = await makeLibrary().importFolder(folder);

    expect(summary.imported).toBe(1);
    expect(summary.skipped).toBe(0);
    expect(summary.canceled).toBe(false);
    expect(summary.failed).toHaveLength(1);
    expect(summary.failed[0]?.file).toBe(join(folder, 'bad.pdf'));
    expect(summary.failed[0]?.message).toContain('无法读取 PDF：');
    expect(listPapers(db)).toHaveLength(1);
  });

  it('取消后当前文件完成，后续文件不再开始，已导入结果保留', async () => {
    const folder = join(tempDir, 'inbox');
    mkdirSync(folder, { recursive: true });
    copyFileSync(SAMPLE_TEXT_PDF, join(folder, 'a.pdf'));
    copyFileSync(SAMPLE_SCANNED_PDF, join(folder, 'b.pdf'));
    let library!: PaperLibrary;
    let copies = 0;
    library = makeLibrary({
      copyFile: async (source, target) => {
        copies += 1;
        library.cancelImport();
        copyFileSync(source, target);
      },
    });

    const summary = await library.importFolder(folder);

    expect(summary.canceled).toBe(true);
    expect(summary.imported).toBe(1);
    expect(copies).toBe(1);
    expect(listPapers(db)).toHaveLength(1);
    expect(existsSync(join(folder, 'b.pdf'))).toBe(true);
    expect(jobs.getState().storageTask).toBeNull();
  });

  it('文献库根目录本身不会重新导入已托管的文件', async () => {
    const library = makeLibrary();
    await library.importPaper(SAMPLE_TEXT_PDF);

    const summary = await library.importFolder(root);

    expect(summary).toEqual({ imported: 0, skipped: 0, failed: [], canceled: false });
    expect(listPapers(db)).toHaveLength(1);
  });

  it('空文件夹返回全零摘要', async () => {
    const folder = join(tempDir, 'empty');
    mkdirSync(folder, { recursive: true });

    expect(await makeLibrary().importFolder(folder)).toEqual({
      imported: 0,
      skipped: 0,
      failed: [],
      canceled: false,
    });
    expect(jobs.getState().storageTask).toBeNull();
  });
});
