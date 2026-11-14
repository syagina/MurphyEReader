import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '@main/db';
import { listPapers } from '@main/db/papers';
import { getPageText, getPages } from '@main/db/pages';
import { attachTranslatedPdf, importPaper } from '@main/papers/import-service';
import {
  generateFixtures,
  SAMPLE_SCANNED_PDF,
  SAMPLE_TEXT_PDF,
} from '../fixtures/generate';

let tempDir: string;
let db: Database.Database;

beforeAll(async () => {
  await generateFixtures();
});

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'paperlens-'));
  db = openDb(join(tempDir, 'paperlens.db'));
});

afterEach(() => {
  db.close();
  rmSync(tempDir, { recursive: true, force: true });
});

describe('importPaper', () => {
  it('提取文本后写入论文与逐页记录', async () => {
    const paper = await importPaper(db, SAMPLE_TEXT_PDF);

    expect(listPapers(db)).toHaveLength(1);
    expect(paper).toMatchObject({
      title: 'sample-text',
      authors: '',
      year: null,
      filePathOriginal: SAMPLE_TEXT_PDF,
      filePathTranslated: null,
      pageCountOriginal: 2,
      pageCountTranslated: null,
      hasTextLayer: true,
      outline: [],
    });
    expect(listPapers(db)[0]).toEqual(paper);
    expect(getPages(db, paper.id)).toHaveLength(2);
    expect(getPageText(db, paper.id, 2)).toContain('PaperLens sample page 2');
  });

  it('扫描版 PDF 导入后 hasTextLayer 为 false', async () => {
    const paper = await importPaper(db, SAMPLE_SCANNED_PDF);

    expect(paper.hasTextLayer).toBe(false);
    expect(paper.pageCountOriginal).toBe(1);
    expect(getPages(db, paper.id)).toHaveLength(1);
  });
});

describe('attachTranslatedPdf', () => {
  it('只更新译本路径与页数，不触碰原文、页记录与 hasTextLayer', async () => {
    const original = await importPaper(db, SAMPLE_TEXT_PDF);
    const pagesBefore = getPages(db, original.id);

    const updated = await attachTranslatedPdf(db, original.id, SAMPLE_SCANNED_PDF);

    expect(updated.pageCountTranslated).toBe(1);
    expect(updated.filePathTranslated).toBe(SAMPLE_SCANNED_PDF);
    expect(updated.filePathTranslated).not.toBe('');
    expect(updated.filePathOriginal).toBe(SAMPLE_TEXT_PDF);
    expect(updated.hasTextLayer).toBe(true);
    expect(updated.pageCountOriginal).toBe(2);
    expect(updated.lastPageTranslated).toBe(1);
    expect(getPages(db, original.id)).toEqual(pagesBefore);
  });
});
