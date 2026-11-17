import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb } from '@main/db';
import { createPaper, getPaper } from '@main/db/papers';
import { replacePages } from '@main/db/pages';
import type { ExtractedPdf } from '@main/pdf/extract';
import { extractPdf } from '@main/pdf/extract';
import { BABELDOC_DUAL_NAME, BABELDOC_MONO_NAME, storageFile } from '@main/storage/paths';
import { repairManagedTranslation } from '@main/translation/repair-binding';
import type { Paper, PageText } from '@shared/types';

vi.mock('@main/pdf/extract', () => ({
  extractPdf: vi.fn(),
}));

const mockedExtract = vi.mocked(extractPdf);

const STORAGE_DIR = 'papers/Repair Test (1)';
const ORIGINAL = 'A'.repeat(600);
const TRANSLATED = '译'.repeat(200);

function page(pageNo: number, text: string): PageText {
  return { pageNo, text };
}

function output(pages: PageText[], pageCount = pages.length): ExtractedPdf {
  return {
    pageCount,
    pages,
    hasTextLayer: true,
    outline: [],
    title: null,
    authors: '',
  };
}

let tempDir: string;
let root: string;
let db: Database.Database;
let paper: Paper;
let monoPath: string;
let dualPath: string;

const originalPages = [1, 2, 3].map((pageNo) => page(pageNo, ORIGINAL));
const completeMono = [1, 2, 3].map((pageNo) => page(pageNo, TRANSLATED));
const incompleteMono = [page(1, TRANSLATED), page(2, TRANSLATED)];
const completeDual = [1, 2, 3].map((pageNo) =>
  page(pageNo, `${ORIGINAL}${TRANSLATED}`),
);

function writePaper(overrides: Partial<Parameters<typeof createPaper>[1]> = {}): Paper {
  return createPaper(db, {
    title: 'Repair Test',
    authors: '',
    year: null,
    filePathOriginal: join(root, STORAGE_DIR, 'original.pdf'),
    filePathTranslated: monoPath,
    pageCountOriginal: originalPages.length,
    pageCountTranslated: originalPages.length,
    hasTextLayer: true,
    outline: [],
    folderId: null,
    storageDir: STORAGE_DIR,
    fileHash: null,
    ...overrides,
  });
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'paperlens-repair-'));
  root = join(tempDir, 'library');
  mkdirSync(join(root, STORAGE_DIR), { recursive: true });
  db = openDb(':memory:');
  monoPath = storageFile(root, STORAGE_DIR, BABELDOC_MONO_NAME);
  dualPath = storageFile(root, STORAGE_DIR, BABELDOC_DUAL_NAME);
  writeFileSync(monoPath, 'mono');
  writeFileSync(dualPath, 'dual');
  paper = writePaper();
  replacePages(db, paper.id, originalPages);
  mockedExtract.mockReset();
});

afterEach(() => {
  db.close();
  rmSync(tempDir, { recursive: true, force: true });
});

describe('repairManagedTranslation', () => {
  it('旧 mono 译本缺页时改绑完整 dual，并记录双语的页数', async () => {
    mockedExtract.mockImplementation(async (filePath) =>
      filePath === monoPath ? output(incompleteMono) : output(completeDual, 7),
    );

    await expect(repairManagedTranslation(db, paper.id, root)).resolves.toBe(true);

    const updated = getPaper(db, paper.id)!;
    expect(updated.filePathTranslated).toBe(dualPath);
    expect(updated.pageCountTranslated).toBe(7);
  });

  it('mono 输出完整时保持原绑定', async () => {
    mockedExtract.mockResolvedValue(output(completeMono));

    await expect(repairManagedTranslation(db, paper.id, root)).resolves.toBe(false);

    expect(getPaper(db, paper.id)!.filePathTranslated).toBe(monoPath);
    expect(mockedExtract).toHaveBeenCalledTimes(1);
  });

  it('dual 也缺页时不改绑，避免换成一个同样残缺的译本', async () => {
    mockedExtract.mockImplementation(async (filePath) =>
      filePath === monoPath
        ? output(incompleteMono)
        : output([page(1, ORIGINAL)]),
    );

    await expect(repairManagedTranslation(db, paper.id, root)).resolves.toBe(false);

    expect(getPaper(db, paper.id)!.filePathTranslated).toBe(monoPath);
  });

  it('用户自行绑定的译本不会被自动替换', async () => {
    const customPath = join(root, STORAGE_DIR, 'translated.custom.pdf');
    writeFileSync(customPath, 'custom');
    const custom = writePaper({ filePathTranslated: customPath });

    await expect(repairManagedTranslation(db, custom.id, root)).resolves.toBe(false);

    expect(getPaper(db, custom.id)!.filePathTranslated).toBe(customPath);
    expect(mockedExtract).not.toHaveBeenCalled();
  });

  it('缺少 dual 文件时不改绑', async () => {
    rmSync(dualPath);

    await expect(repairManagedTranslation(db, paper.id, root)).resolves.toBe(false);

    expect(getPaper(db, paper.id)!.filePathTranslated).toBe(monoPath);
    expect(mockedExtract).not.toHaveBeenCalled();
  });

  it('输出无法解析时保留原绑定，且同一对文件只检查一次', async () => {
    mockedExtract.mockRejectedValue(new Error('broken pdf'));

    await expect(repairManagedTranslation(db, paper.id, root)).resolves.toBe(false);
    await expect(repairManagedTranslation(db, paper.id, root)).resolves.toBe(false);

    expect(getPaper(db, paper.id)!.filePathTranslated).toBe(monoPath);
    expect(mockedExtract).toHaveBeenCalledTimes(1);
  });
});
