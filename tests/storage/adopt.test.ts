import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
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
import { adoptUnmanagedPaper } from '@main/storage/adopt';
import {
  CUSTOM_TRANSLATED_NAME,
  ORIGINAL_PDF_NAME,
  canonicalStorageDir,
  isPathInside,
  storageFile,
} from '@main/storage/paths';
import { generateFixtures, SAMPLE_SCANNED_PDF, SAMPLE_TEXT_PDF } from '../fixtures/generate';

let tempDir: string;
let root: string;
let db: Database.Database;

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
  tempDir = mkdtempSync(join(tmpdir(), 'paperlens-adopt-'));
  root = join(tempDir, 'library');
  db = openDb(':memory:');
});

afterEach(() => {
  db.close();
  rmSync(tempDir, { recursive: true, force: true });
});

describe('adoptUnmanagedPaper', () => {
  it('共享目录中的原文被复制进规范文件夹，源文件与共享目录不受影响', async () => {
    const shared = join(tempDir, 'shared');
    mkdirSync(shared);
    const source = join(shared, 'legacy.pdf');
    copyFileSync(SAMPLE_TEXT_PDF, source);
    const paper = createPaper(db, { ...makeInput(), title: 'Legacy', filePathOriginal: source });

    const adopted = await adoptUnmanagedPaper(db, root, paper);

    expect(adopted.storageDir).toBe(canonicalStorageDir(paper.id, 'Legacy'));
    expect(adopted.filePathOriginal).toBe(
      storageFile(root, adopted.storageDir!, ORIGINAL_PDF_NAME),
    );
    expect(existsSync(source)).toBe(true);
    expect(isPathInside(shared, adopted.filePathOriginal, 'win32')).toBe(false);
    expect(readdirSync(join(root, adopted.storageDir!)).sort()).toEqual([
      'notes',
      'original.pdf',
    ]);
    expect(getPaper(db, paper.id)?.storageDir).toBe(adopted.storageDir);
    expect(adopted.fileHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('原文已在规范 original.pdf 时不再复制，仍补建 notes/', async () => {
    const paper = createPaper(db, makeInput({ title: '原地文献' }));
    const storageDir = canonicalStorageDir(paper.id, '原地文献');
    const folder = join(root, storageDir);
    mkdirSync(folder, { recursive: true });
    const original = join(folder, ORIGINAL_PDF_NAME);
    copyFileSync(SAMPLE_TEXT_PDF, original);
    updatePaper(db, paper.id, { filePathOriginal: original });

    const adopted = await adoptUnmanagedPaper(db, root, getPaper(db, paper.id)!);

    expect(adopted.storageDir).toBe(storageDir);
    expect(adopted.filePathOriginal).toBe(original);
    expect(readdirSync(join(folder, 'notes'))).toEqual([]);
    expect(existsSync(original)).toBe(true);
  });

  it('已绑定译本会复制为 translated.custom.pdf，外部文件保留', async () => {
    const original = makeExternal('legacy.pdf', SAMPLE_TEXT_PDF);
    const translation = makeExternal('legacy-zh.pdf', SAMPLE_SCANNED_PDF);
    const paper = createPaper(
      db,
      makeInput({ filePathOriginal: original, filePathTranslated: translation }),
    );

    const adopted = await adoptUnmanagedPaper(db, root, paper);

    expect(adopted.filePathTranslated).toBe(
      storageFile(root, adopted.storageDir!, CUSTOM_TRANSLATED_NAME),
    );
    expect(existsSync(adopted.filePathTranslated!)).toBe(true);
    expect(existsSync(original)).toBe(true);
    expect(existsSync(translation)).toBe(true);
  });

  it('译本绑定但文件缺失时报译本文件缺失且不改变行', async () => {
    const original = makeExternal('legacy.pdf', SAMPLE_TEXT_PDF);
    const missingTranslation = join(tempDir, 'gone.pdf');
    const paper = createPaper(
      db,
      makeInput({ filePathOriginal: original, filePathTranslated: missingTranslation }),
    );

    await expect(adoptUnmanagedPaper(db, root, paper)).rejects.toThrow('译本文件缺失');

    const unchanged = getPaper(db, paper.id);
    expect(unchanged?.storageDir).toBeNull();
    expect(unchanged?.filePathOriginal).toBe(original);
    expect(existsSync(join(root, canonicalStorageDir(paper.id, paper.title)))).toBe(false);
  });

  it('原文缺失时报原文文件不存在且不改变行', async () => {
    const paper = createPaper(db, makeInput({ filePathOriginal: join(tempDir, 'gone.pdf') }));

    await expect(adoptUnmanagedPaper(db, root, paper)).rejects.toThrow('原文文件不存在');

    expect(getPaper(db, paper.id)?.storageDir).toBeNull();
  });

  it('已托管文献再次收养会被拒绝', async () => {
    const paper = createPaper(db, makeInput({ filePathOriginal: SAMPLE_TEXT_PDF }));
    updatePaper(db, paper.id, { storageDir: canonicalStorageDir(paper.id, paper.title) });

    await expect(
      adoptUnmanagedPaper(db, root, getPaper(db, paper.id)!),
    ).rejects.toThrow('文献已托管');
  });

  it('提供 options.hash 时直接使用该哈希而不重新计算', async () => {
    const original = makeExternal('legacy.pdf', SAMPLE_TEXT_PDF);
    const paper = createPaper(db, makeInput({ filePathOriginal: original }));
    const hash = 'a'.repeat(64);

    const adopted = await adoptUnmanagedPaper(db, root, paper, { hash });

    expect(adopted.fileHash).toBe(hash);
  });

  it('创建文件夹失败时包装为无法整理文献文件', async () => {
    const original = makeExternal('legacy.pdf', SAMPLE_TEXT_PDF);
    const paper = createPaper(db, makeInput({ filePathOriginal: original }));
    mkdirSync(join(root, 'papers'), { recursive: true });
    writeFileSync(join(root, canonicalStorageDir(paper.id, paper.title)), 'blocked');

    await expect(adoptUnmanagedPaper(db, root, paper)).rejects.toThrow(
      '无法整理文献文件：',
    );

    expect(getPaper(db, paper.id)?.storageDir).toBeNull();
  });
});
