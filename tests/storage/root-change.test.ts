import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '@main/db';
import { createPaper, getPaper, updatePaper } from '@main/db/papers';
import type { NewPaperInput } from '@main/db/papers';
import { JobRegistry } from '@main/jobs/job-registry';
import { getStoredAppSettings, setLibraryRootSetting } from '@main/settings/app-settings';
import { PaperLibrary } from '@main/storage/library-service';
import {
  CUSTOM_TRANSLATED_NAME,
  ORIGINAL_PDF_NAME,
  canonicalStorageDir,
  storageFile,
} from '@main/storage/paths';
import { changeLibraryRoot } from '@main/storage/root-change';
import {
  generateFixtures,
  SAMPLE_SCANNED_PDF,
  SAMPLE_TEXT_PDF,
} from '../fixtures/generate';

const BUSY = '请先等待当前任务完成';
const SAME_ROOT = '新位置与当前位置相同';
const NESTED_ROOT = '新位置不能位于当前文献库内部，也不能包含当前文献库';
const INVALID_NEW_ROOT = '新位置无效，请选择其他文件夹';
const UNWRITABLE_ROOT = '新位置不可写，请选择其他文件夹';
const INVALID_STORAGE_DIR = '文献文件夹路径异常，已中止迁移';
const MISSING_FOLDER = '文献文件夹不存在，已中止迁移';
const DESTINATION_EXISTS = '目标位置已存在同名文献文件夹，已中止迁移';

let tempDir: string;
let oldRoot: string;
let newRoot: string;
let documentsDir: string;
let db: Database.Database;
let jobs: JobRegistry;

function makeInput(overrides: Partial<NewPaperInput> = {}): NewPaperInput {
  return {
    title: '旧文献',
    authors: '',
    year: null,
    filePathOriginal: join(tempDir, 'legacy.pdf'),
    filePathTranslated: null,
    pageCountOriginal: 1,
    pageCountTranslated: null,
    hasTextLayer: true,
    outline: [],
    folderId: null,
    storageDir: null,
    fileHash: null,
    ...overrides,
  };
}

function makeExternal(name: string, source: string): string {
  const target = join(tempDir, name);
  copyFileSync(source, target);
  return target;
}

function makeLibrary(root: string): PaperLibrary {
  return new PaperLibrary({ db, jobs, getRoot: () => root });
}

beforeAll(async () => {
  await generateFixtures();
});

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'paperlens-root-change-'));
  oldRoot = join(tempDir, 'old-library');
  newRoot = join(tempDir, 'new-library');
  documentsDir = join(tempDir, 'documents');
  db = openDb(':memory:');
  jobs = new JobRegistry();
  setLibraryRootSetting(db, oldRoot);
});

afterEach(() => {
  db.close();
  rmSync(tempDir, { recursive: true, force: true });
});

describe('changeLibraryRoot', () => {
  it('把已托管文献复制到新根目录，事务更新路径与设置，旧文件保留', async () => {
    const imported = await makeLibrary(oldRoot).importPaper(SAMPLE_TEXT_PDF);

    const result = await changeLibraryRoot(db, jobs, oldRoot, newRoot);

    expect(result).toMatchObject({ migrated: 1, unmanaged: [], keptOldCopies: true });
    expect(result.root).toBe(newRoot);
    const moved = getPaper(db, imported.paper.id)!;
    expect(moved.filePathOriginal).toBe(
      storageFile(newRoot, moved.storageDir!, ORIGINAL_PDF_NAME),
    );
    expect(existsSync(moved.filePathOriginal)).toBe(true);
    expect(existsSync(storageFile(oldRoot, moved.storageDir!, ORIGINAL_PDF_NAME))).toBe(true);
    expect(getStoredAppSettings(db, documentsDir).libraryRoot).toBe(newRoot);
    expect(jobs.getState().storageTask).toBeNull();
  });

  it('先收养未托管文献，再连同新收养的行一起迁移', async () => {
    const external = makeExternal('legacy.pdf', SAMPLE_TEXT_PDF);
    const legacy = createPaper(db, makeInput({ title: '待收养', filePathOriginal: external }));

    const result = await changeLibraryRoot(db, jobs, oldRoot, newRoot);

    expect(result).toMatchObject({ migrated: 1, unmanaged: [] });
    const moved = getPaper(db, legacy.id)!;
    expect(moved.storageDir).toBe(canonicalStorageDir(legacy.id, '待收养'));
    expect(moved.filePathOriginal).toBe(
      storageFile(newRoot, moved.storageDir!, ORIGINAL_PDF_NAME),
    );
    expect(existsSync(moved.filePathOriginal)).toBe(true);
    // The adoption copy inside the old root stays behind with the old library.
    expect(
      existsSync(storageFile(oldRoot, moved.storageDir!, ORIGINAL_PDF_NAME)),
    ).toBe(true);
    expect(existsSync(external)).toBe(true);
    expect(getStoredAppSettings(db, documentsDir).libraryRoot).toBe(newRoot);
  });

  it('新位置位于旧库内部或包含旧库时拒绝，设置不变', async () => {
    await makeLibrary(oldRoot).importPaper(SAMPLE_TEXT_PDF);

    await expect(
      changeLibraryRoot(db, jobs, oldRoot, join(oldRoot, 'inside')),
    ).rejects.toThrow(NESTED_ROOT);
    await expect(
      changeLibraryRoot(db, jobs, oldRoot, tempDir),
    ).rejects.toThrow(NESTED_ROOT);

    expect(getStoredAppSettings(db, documentsDir).libraryRoot).toBe(oldRoot);
    expect(jobs.getState().storageTask).toBeNull();
  });

  it('新位置与当前位置相同时拒绝', async () => {
    await expect(
      changeLibraryRoot(db, jobs, oldRoot, oldRoot),
    ).rejects.toThrow(SAME_ROOT);
    expect(jobs.getState().storageTask).toBeNull();
  });

  it('相对路径的新位置拒绝', async () => {
    await expect(
      changeLibraryRoot(db, jobs, oldRoot, 'relative-library'),
    ).rejects.toThrow(INVALID_NEW_ROOT);
    expect(getStoredAppSettings(db, documentsDir).libraryRoot).toBe(oldRoot);
  });

  it('新位置不可写时拒绝且不收养未托管文献', async () => {
    const blocked = join(tempDir, 'blocked-root');
    writeFileSync(blocked, 'not a directory');
    const external = makeExternal('legacy.pdf', SAMPLE_TEXT_PDF);
    const legacy = createPaper(db, makeInput({ filePathOriginal: external }));

    await expect(changeLibraryRoot(db, jobs, oldRoot, blocked)).rejects.toThrow(
      UNWRITABLE_ROOT,
    );

    expect(getStoredAppSettings(db, documentsDir).libraryRoot).toBe(oldRoot);
    expect(getPaper(db, legacy.id)?.storageDir).toBeNull();
    expect(existsSync(join(oldRoot, 'papers'))).toBe(false);
    expect(jobs.getState().storageTask).toBeNull();
  });

  it('目标位置已存在同名文献文件夹时中止，不合并也不切根目录', async () => {
    const imported = await makeLibrary(oldRoot).importPaper(SAMPLE_TEXT_PDF);
    const storageDir = imported.paper.storageDir!;
    mkdirSync(join(newRoot, storageDir), { recursive: true });

    await expect(changeLibraryRoot(db, jobs, oldRoot, newRoot)).rejects.toThrow(
      DESTINATION_EXISTS,
    );

    expect(getStoredAppSettings(db, documentsDir).libraryRoot).toBe(oldRoot);
    expect(getPaper(db, imported.paper.id)?.filePathOriginal).toBe(
      imported.paper.filePathOriginal,
    );
  });

  it('目标文献文件夹路径被同名文件占用时中止并保留旧设置与旧路径', async () => {
    const imported = await makeLibrary(oldRoot).importPaper(SAMPLE_TEXT_PDF);
    mkdirSync(join(newRoot, 'papers'), { recursive: true });
    writeFileSync(join(newRoot, imported.paper.storageDir!), 'blocked');

    await expect(changeLibraryRoot(db, jobs, oldRoot, newRoot)).rejects.toThrow(
      DESTINATION_EXISTS,
    );

    expect(getStoredAppSettings(db, documentsDir).libraryRoot).toBe(oldRoot);
    expect(getPaper(db, imported.paper.id)?.filePathOriginal).toBe(
      imported.paper.filePathOriginal,
    );
    expect(existsSync(imported.paper.filePathOriginal)).toBe(true);
  });

  it('原文缺失的未托管文献列入 unmanaged，而不是报告全部完成', async () => {
    const managed = await makeLibrary(oldRoot).importPaper(SAMPLE_TEXT_PDF);
    const missing = createPaper(
      db,
      makeInput({ title: '缺失文献', filePathOriginal: join(tempDir, 'gone.pdf') }),
    );

    const result = await changeLibraryRoot(db, jobs, oldRoot, newRoot);

    expect(result.migrated).toBe(1);
    expect(result.unmanaged).toEqual([{ paperId: missing.id, title: '缺失文献' }]);
    expect(getPaper(db, managed.paper.id)?.filePathOriginal).toBe(
      storageFile(newRoot, managed.paper.storageDir!, ORIGINAL_PDF_NAME),
    );
    expect(getPaper(db, missing.id)?.storageDir).toBeNull();
    expect(getPaper(db, missing.id)?.filePathOriginal).toBe(join(tempDir, 'gone.pdf'));
    expect(getStoredAppSettings(db, documentsDir).libraryRoot).toBe(newRoot);
  });

  it('托管文件夹内的译本随文件夹复制并在新根目录下重新绑定', async () => {
    const library = makeLibrary(oldRoot);
    const imported = await library.importPaper(SAMPLE_TEXT_PDF);
    const attached = await library.attachTranslated(imported.paper.id, SAMPLE_SCANNED_PDF);
    expect(attached.filePathTranslated).toBe(
      storageFile(oldRoot, attached.storageDir!, CUSTOM_TRANSLATED_NAME),
    );

    const result = await changeLibraryRoot(db, jobs, oldRoot, newRoot);

    expect(result).toMatchObject({ migrated: 1, unmanaged: [] });
    const moved = getPaper(db, imported.paper.id)!;
    const rebased = storageFile(newRoot, moved.storageDir!, CUSTOM_TRANSLATED_NAME);
    expect(moved.filePathTranslated).toBe(rebased);
    expect(existsSync(rebased)).toBe(true);
    // The old copy and the user's source file stay untouched.
    expect(
      existsSync(storageFile(oldRoot, moved.storageDir!, CUSTOM_TRANSLATED_NAME)),
    ).toBe(true);
    expect(existsSync(SAMPLE_SCANNED_PDF)).toBe(true);
  });

  it('托管文献的外部译本路径保持绝对路径不变且外部文件不动', async () => {
    const imported = await makeLibrary(oldRoot).importPaper(SAMPLE_TEXT_PDF);
    const external = makeExternal('external-translation.pdf', SAMPLE_SCANNED_PDF);
    updatePaper(db, imported.paper.id, { filePathTranslated: external });

    const result = await changeLibraryRoot(db, jobs, oldRoot, newRoot);

    expect(result).toMatchObject({ migrated: 1, unmanaged: [] });
    const moved = getPaper(db, imported.paper.id)!;
    expect(moved.filePathTranslated).toBe(external);
    expect(existsSync(external)).toBe(true);
    // The external file was never copied into the managed folder.
    expect(
      existsSync(storageFile(newRoot, moved.storageDir!, CUSTOM_TRANSLATED_NAME)),
    ).toBe(false);
  });

  it('标题改过的已托管文献按存储文件夹的编号后缀迁移', async () => {
    const imported = await makeLibrary(oldRoot).importPaper(SAMPLE_TEXT_PDF);
    const storageDir = imported.paper.storageDir!;
    updatePaper(db, imported.paper.id, { title: '完全不同的标题' });

    const result = await changeLibraryRoot(db, jobs, oldRoot, newRoot);

    expect(result).toMatchObject({ migrated: 1, unmanaged: [] });
    const moved = getPaper(db, imported.paper.id)!;
    expect(moved.storageDir).toBe(storageDir);
    expect(moved.filePathOriginal).toBe(
      storageFile(newRoot, storageDir, ORIGINAL_PDF_NAME),
    );
    expect(existsSync(moved.filePathOriginal)).toBe(true);
  });

  it('无效 storage_dir 在写入设置前中止', async () => {
    const invalid = createPaper(
      db,
      makeInput({
        title: '异常托管',
        filePathOriginal: makeExternal('invalid.pdf', SAMPLE_TEXT_PDF),
        storageDir: 'papers/Shared (999)',
      }),
    );

    await expect(changeLibraryRoot(db, jobs, oldRoot, newRoot)).rejects.toThrow(
      INVALID_STORAGE_DIR,
    );

    expect(getStoredAppSettings(db, documentsDir).libraryRoot).toBe(oldRoot);
    expect(getPaper(db, invalid.id)?.filePathOriginal).toBe(invalid.filePathOriginal);
    expect(jobs.getState().storageTask).toBeNull();
  });

  it('托管文献的文件夹缺失时中止且不更新任何路径', async () => {
    const imported = await makeLibrary(oldRoot).importPaper(SAMPLE_TEXT_PDF);
    rmSync(join(oldRoot, imported.paper.storageDir!), { recursive: true, force: true });

    await expect(changeLibraryRoot(db, jobs, oldRoot, newRoot)).rejects.toThrow(
      MISSING_FOLDER,
    );

    expect(getStoredAppSettings(db, documentsDir).libraryRoot).toBe(oldRoot);
    expect(getPaper(db, imported.paper.id)?.filePathOriginal).toBe(
      imported.paper.filePathOriginal,
    );
  });

  it('没有已托管文献时只写设置并创建 papers/ 与 exports/', async () => {
    const result = await changeLibraryRoot(db, jobs, oldRoot, newRoot);

    expect(result).toMatchObject({ migrated: 0, unmanaged: [], keptOldCopies: true });
    expect(getStoredAppSettings(db, documentsDir).libraryRoot).toBe(newRoot);
    expect(existsSync(join(newRoot, 'papers'))).toBe(true);
    expect(existsSync(join(newRoot, 'exports'))).toBe(true);
    expect(existsSync(join(newRoot, '.paperlens-write-test'))).toBe(false);
  });

  it('部分复制成功后才失败时，已复制的半成品保留但所有路径仍指向旧根目录', async () => {
    const invalid = createPaper(
      db,
      makeInput({
        title: '异常托管',
        filePathOriginal: makeExternal('invalid.pdf', SAMPLE_TEXT_PDF),
        storageDir: 'papers/Shared (999)',
      }),
    );
    // Newer rows sort first, so the valid paper is copied before the invalid
    // one aborts the pass.
    const imported = await makeLibrary(oldRoot).importPaper(SAMPLE_TEXT_PDF);

    await expect(changeLibraryRoot(db, jobs, oldRoot, newRoot)).rejects.toThrow(
      INVALID_STORAGE_DIR,
    );

    expect(getPaper(db, imported.paper.id)?.filePathOriginal).toBe(
      imported.paper.filePathOriginal,
    );
    expect(
      existsSync(storageFile(newRoot, imported.paper.storageDir!, ORIGINAL_PDF_NAME)),
    ).toBe(true);
    expect(getStoredAppSettings(db, documentsDir).libraryRoot).toBe(oldRoot);
    expect(getPaper(db, invalid.id)?.filePathOriginal).toBe(invalid.filePathOriginal);
  });

  it('存储任务被占用时报忙且不开始迁移', async () => {
    await makeLibrary(oldRoot).importPaper(SAMPLE_TEXT_PDF);
    jobs.tryAcquireStorage('import');

    try {
      await expect(changeLibraryRoot(db, jobs, oldRoot, newRoot)).rejects.toThrow(BUSY);
    } finally {
      jobs.releaseStorage();
    }

    expect(getStoredAppSettings(db, documentsDir).libraryRoot).toBe(oldRoot);
    expect(jobs.getState().storageTask).toBeNull();
  });

  it('工具任务进行中时报忙，设置与文献路径不变', async () => {
    const imported = await makeLibrary(oldRoot).importPaper(SAMPLE_TEXT_PDF);
    jobs.tryAcquireTool('install', 'job-x');

    try {
      await expect(changeLibraryRoot(db, jobs, oldRoot, newRoot)).rejects.toThrow(BUSY);
    } finally {
      jobs.releaseTool('job-x');
    }

    expect(getStoredAppSettings(db, documentsDir).libraryRoot).toBe(oldRoot);
    expect(getPaper(db, imported.paper.id)?.filePathOriginal).toBe(
      imported.paper.filePathOriginal,
    );
    expect(existsSync(storageFile(newRoot, imported.paper.storageDir!, ORIGINAL_PDF_NAME))).toBe(
      false,
    );
    expect(jobs.getState().storageTask).toBeNull();
  });
});
