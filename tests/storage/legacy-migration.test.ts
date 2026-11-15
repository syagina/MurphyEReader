import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb } from '@main/db';
import { createPaper, getPaper, updatePaper } from '@main/db/papers';
import type { NewPaperInput } from '@main/db/papers';
import { JobRegistry } from '@main/jobs/job-registry';
import { migrateLegacyPapers } from '@main/storage/legacy-migration';
import { ORIGINAL_PDF_NAME, canonicalStorageDir, storageFile } from '@main/storage/paths';
import { generateFixtures, SAMPLE_TEXT_PDF } from '../fixtures/generate';

// Adoption hashes each legacy file after the schema migration; a hashing
// failure must not block adoption (the row keeps `file_hash = NULL`).
const hashControl = vi.hoisted(() => ({ fail: false }));

vi.mock('@main/storage/hash', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@main/storage/hash')>();
  return {
    sha256File: async (path: string): Promise<string> => {
      if (hashControl.fail) {
        throw new Error('哈希计算失败');
      }
      return actual.sha256File(path);
    },
  };
});

let tempDir: string;
let root: string;
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

beforeAll(async () => {
  await generateFixtures();
});

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'paperlens-migrate-'));
  root = join(tempDir, 'library');
  db = openDb(':memory:');
  jobs = new JobRegistry();
  hashControl.fail = false;
});

afterEach(() => {
  db.close();
  rmSync(tempDir, { recursive: true, force: true });
});

describe('migrateLegacyPapers', () => {
  it('收养未托管文献、跳过原文缺失项并在完成后发送摘要', async () => {
    const shared = join(tempDir, 'shared');
    mkdirSync(shared);
    const sharedPdf = join(shared, 'legacy.pdf');
    copyFileSync(SAMPLE_TEXT_PDF, sharedPdf);

    const present = createPaper(db, {
      ...makeInput(),
      title: '存在',
      filePathOriginal: sharedPdf,
    });
    const missing = createPaper(db, {
      ...makeInput(),
      title: '缺失',
      filePathOriginal: join(tempDir, 'gone.pdf'),
    });
    const emit = vi.fn();

    const summary = await migrateLegacyPapers(db, jobs, root, emit);

    expect(summary.adopted).toBe(1);
    expect(summary.skipped).toEqual([
      { paperId: missing.id, title: '缺失', reason: '原文文件不存在' },
    ]);
    expect(getPaper(db, present.id)).toMatchObject({
      storageDir: canonicalStorageDir(present.id, '存在'),
      fileHash: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    const adopted = getPaper(db, present.id)!;
    expect(adopted.filePathOriginal).toBe(
      storageFile(root, adopted.storageDir!, ORIGINAL_PDF_NAME),
    );
    expect(existsSync(adopted.filePathOriginal)).toBe(true);
    // The shared source is copied, never moved.
    expect(existsSync(sharedPdf)).toBe(true);
    expect(getPaper(db, missing.id)?.storageDir).toBeNull();
    expect(emit).toHaveBeenCalledWith('storage:migrated', summary);
    expect(jobs.getState().storageTask).toBeNull();
  });

  it('再次运行是幂等的：已收养行不再匹配，缺失项仍被记录', async () => {
    const present = createPaper(db, {
      ...makeInput(),
      title: '存在',
      filePathOriginal: makeExternal('legacy.pdf', SAMPLE_TEXT_PDF),
    });
    const missing = createPaper(db, {
      ...makeInput(),
      title: '缺失',
      filePathOriginal: join(tempDir, 'gone.pdf'),
    });

    const first = await migrateLegacyPapers(db, jobs, root, () => undefined);
    const again = await migrateLegacyPapers(db, jobs, root, () => undefined);

    expect(first.adopted).toBe(1);
    expect(again.adopted).toBe(0);
    expect(again.skipped).toEqual([
      { paperId: missing.id, title: '缺失', reason: '原文文件不存在' },
    ]);
    expect(getPaper(db, present.id)?.storageDir).toBe(
      canonicalStorageDir(present.id, '存在'),
    );
  });

  it('迁移进行中再次迁移报请先等待当前任务完成，结束后释放锁', async () => {
    createPaper(db, {
      ...makeInput(),
      filePathOriginal: makeExternal('legacy.pdf', SAMPLE_TEXT_PDF),
    });

    const running = migrateLegacyPapers(db, jobs, root, () => undefined);
    await expect(
      migrateLegacyPapers(db, jobs, root, () => undefined),
    ).rejects.toThrow(new Error('请先等待当前任务完成'));

    const summary = await running;
    expect(summary.adopted).toBe(1);
    expect(jobs.getState().storageTask).toBeNull();
  });

  it('已绑定译本缺失的文献被跳过且记录中文原因', async () => {
    const paper = createPaper(db, {
      ...makeInput(),
      title: '缺译本',
      filePathOriginal: makeExternal('legacy.pdf', SAMPLE_TEXT_PDF),
      filePathTranslated: join(tempDir, 'gone-translation.pdf'),
    });

    const summary = await migrateLegacyPapers(db, jobs, root, () => undefined);

    expect(summary.adopted).toBe(0);
    expect(summary.skipped).toEqual([
      { paperId: paper.id, title: '缺译本', reason: '译本文件缺失' },
    ]);
    expect(getPaper(db, paper.id)?.storageDir).toBeNull();
  });

  it('收养失败（规范文件夹被文件占用）被跳过并保留其他文献的迁移结果', async () => {
    const blocked = createPaper(db, {
      ...makeInput(),
      title: '被占用',
      filePathOriginal: makeExternal('blocked.pdf', SAMPLE_TEXT_PDF),
    });
    const ok = createPaper(db, {
      ...makeInput(),
      title: '正常',
      filePathOriginal: makeExternal('ok.pdf', SAMPLE_TEXT_PDF),
    });
    mkdirSync(join(root, 'papers'), { recursive: true });
    writeFileSync(join(root, canonicalStorageDir(blocked.id, '被占用')), 'blocked');

    const summary = await migrateLegacyPapers(db, jobs, root, () => undefined);

    expect(summary.adopted).toBe(1);
    expect(summary.skipped).toHaveLength(1);
    expect(summary.skipped[0]).toMatchObject({
      paperId: blocked.id,
      title: '被占用',
      reason: expect.stringContaining('无法整理文献文件：'),
    });
    expect(getPaper(db, blocked.id)?.storageDir).toBeNull();
    expect(getPaper(db, ok.id)?.storageDir).toBe(canonicalStorageDir(ok.id, '正常'));
  });

  it('哈希计算失败时仍完成收养并保留 fileHash 为 null', async () => {
    const paper = createPaper(db, {
      ...makeInput(),
      title: '哈希失败',
      filePathOriginal: makeExternal('legacy.pdf', SAMPLE_TEXT_PDF),
    });
    hashControl.fail = true;

    const summary = await migrateLegacyPapers(db, jobs, root, () => undefined);

    expect(summary.adopted).toBe(1);
    expect(summary.skipped).toEqual([]);
    const adopted = getPaper(db, paper.id)!;
    expect(adopted.storageDir).toBe(canonicalStorageDir(paper.id, '哈希失败'));
    expect(adopted.fileHash).toBeNull();
    expect(existsSync(adopted.filePathOriginal)).toBe(true);
  });

  it('已托管文献不参与迁移，即使其文件缺失', async () => {
    const managed = createPaper(db, {
      ...makeInput(),
      title: '已托管',
      filePathOriginal: join(tempDir, 'gone.pdf'),
    });
    updatePaper(db, managed.id, {
      storageDir: canonicalStorageDir(managed.id, '已托管'),
    });

    const summary = await migrateLegacyPapers(db, jobs, root, () => undefined);

    expect(summary).toEqual({ adopted: 0, skipped: [] });
  });

  it('文献库根目录不可写时报中文错误并释放锁', async () => {
    writeFileSync(root, 'not a directory');

    await expect(
      migrateLegacyPapers(db, jobs, root, () => undefined),
    ).rejects.toThrow(/^文献库目录不可写：/);
    expect(jobs.getState().storageTask).toBeNull();
  });
});
