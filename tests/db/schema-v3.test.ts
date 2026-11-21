import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import {
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
} from 'pdf-lib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '@main/db';
import { listNotes } from '@main/db/notes';
import { getPaper } from '@main/db/papers';
import { MIGRATION_V1, MIGRATION_V2, MIGRATION_V3 } from '@main/db/schema';
import { listStickyNotes } from '@main/db/sticky-notes';
import { buildAnnotatedPdf } from '@main/export/sticky-notes-pdf';

let tempDir: string;
let dbPath: string;

const V4_STICKY_NOTE_COLUMNS = [
  'id',
  'paper_id',
  'pdf_version',
  'page_no',
  'quote',
  'content_md',
  'anchor_json',
  'source',
  'created_at',
  'updated_at',
  'kind',
  'mark_style',
  'color',
  'pin_json',
  'popup_json',
  'drawing_json',
];

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'paperlens-v3-'));
  dbPath = join(tempDir, 'paperlens.db');
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function createV2Database(): void {
  const raw = new Database(dbPath);
  raw.exec(MIGRATION_V1);
  raw.exec(MIGRATION_V2);
  raw.pragma('user_version = 2');
  raw
    .prepare(
      `INSERT INTO papers
        (title, authors, year, file_path_original, page_count_original, has_text_layer,
         outline_json, tags_json, added_at)
        VALUES ('v2 文献', '李四', 2021, 'C:/v2.pdf', 5, 1, '[]', '["旧标签"]', 456)`,
    )
    .run();
  raw
    .prepare("INSERT INTO folders (name, created_at) VALUES ('旧文件夹', '2025-01-01')")
    .run();
  raw.prepare('UPDATE papers SET folder_id = 1 WHERE id = 1').run();
  raw
    .prepare(
      `INSERT INTO notes (paper_id, type, title, content_md, tags_json, created_at, updated_at)
       VALUES (1, 'manual', '旧笔记', '# 旧内容', '["n"]', 100, 200)`,
    )
    .run();
  raw.close();
}

function createV3Database(notePageNo = 2): void {
  const raw = new Database(dbPath);
  raw.exec(MIGRATION_V1);
  raw.exec(MIGRATION_V2);
  raw.exec(MIGRATION_V3);
  raw.pragma('user_version = 3');
  raw
    .prepare(
      `INSERT INTO papers
        (title, authors, year, file_path_original, page_count_original, has_text_layer,
         outline_json, tags_json, added_at)
        VALUES ('v3 文献', '王五', 2022, 'C:/v3.pdf', 8, 1, '[]', '[]', 789)`,
    )
    .run();
  raw
    .prepare(
      `INSERT INTO sticky_notes
        (paper_id, pdf_version, page_no, quote, content_md, anchor_json,
         source, created_at, updated_at)
       VALUES (1, 'original', ?, '旧便签', '旧内容', '{"kind":"page"}', 'manual', 111, 222)`,
    )
    .run(notePageNo);
  raw.close();
}

function objectNames(db: Database.Database, type: 'table' | 'index'): string[] {
  const rows = db
    .prepare('SELECT name FROM sqlite_master WHERE type = ?')
    .all(type) as { name: string }[];
  return rows.map((row) => row.name);
}

/** A one-page PDF created in memory; never touches a real user document. */
async function syntheticPdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.addPage([600, 800]);
  return pdf.save();
}

function firstAnnotation(pdf: PDFDocument): {
  subtype: string;
  contents: string;
} {
  const annots = pdf.getPage(0).node.Annots();
  if (annots === undefined || annots.size() !== 1) {
    throw new Error(`expected exactly one annotation, got ${annots?.size() ?? 0}`);
  }
  const dict = pdf.context.lookup(annots.get(0));
  if (!(dict instanceof PDFDict)) {
    throw new Error('annotation is not a dictionary');
  }
  const subtype = dict.get(PDFName.of('Subtype'));
  const contents = dict.get(PDFName.of('Contents'));
  return {
    subtype: subtype instanceof PDFName ? subtype.asString().slice(1) : '',
    contents: contents instanceof PDFHexString ? contents.decodeText() : '',
  };
}

describe('v2 → v4 迁移', () => {
  it('原地升级到 v4，原有论文、文件夹、笔记数据不变', () => {
    createV2Database();

    const db = openDb(dbPath);

    expect(db.pragma('user_version', { simple: true })).toBe(5);
    expect(getPaper(db, 1)).toMatchObject({
      title: 'v2 文献',
      authors: '李四',
      year: 2021,
      filePathOriginal: 'C:/v2.pdf',
      folderId: 1,
      tags: ['旧标签'],
      addedAt: 456,
    });
    expect(listNotes(db, 1)).toMatchObject([
      { title: '旧笔记', contentMd: '# 旧内容', tags: ['n'], createdAt: 100, updatedAt: 200 },
    ]);
    expect(db.prepare('SELECT name FROM folders WHERE id = 1').get()).toEqual({
      name: '旧文件夹',
    });
    db.close();
  });

  it('创建 sticky_notes 表、复合索引与 v4 列', () => {
    const db = openDb(dbPath);

    expect(objectNames(db, 'table')).toContain('sticky_notes');
    expect(objectNames(db, 'index')).toContain('idx_sticky_notes_paper_version_page');
    const columns = db
      .prepare("PRAGMA table_info('sticky_notes')")
      .all() as { name: string }[];
    expect(columns.map((column) => column.name)).toEqual(V4_STICKY_NOTE_COLUMNS);
    db.close();
  });

  it('重复打开幂等，不重复迁移也不丢数据', () => {
    createV2Database();
    openDb(dbPath).close();

    const second = openDb(dbPath);

    expect(second.pragma('user_version', { simple: true })).toBe(5);
    expect(getPaper(second, 1)?.title).toBe('v2 文献');
    expect(listNotes(second, 1)).toHaveLength(1);
    expect(
      second
        .prepare(
          "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'sticky_notes'",
        )
        .get(),
    ).toEqual({ count: 1 });
    second.close();
  });

  it('全新数据库直接以 v4 初始化', () => {
    const db = openDb(dbPath);

    expect(db.pragma('user_version', { simple: true })).toBe(5);
    expect(objectNames(db, 'table')).toContain('sticky_notes');
    db.close();
  });
});

describe('v3 → v4 迁移', () => {
  it('保留旧便签数据，新列使用默认值', () => {
    createV3Database();

    const db = openDb(dbPath);

    expect(db.pragma('user_version', { simple: true })).toBe(5);

    const columns = db
      .prepare("PRAGMA table_info('sticky_notes')")
      .all() as { name: string }[];
    expect(columns.map((column) => column.name)).toEqual(V4_STICKY_NOTE_COLUMNS);

    expect(listStickyNotes(db, 1, 'original')[0]).toMatchObject({
      quote: '旧便签',
      contentMd: '旧内容',
      kind: 'note',
      markStyle: 'none',
      color: null,
      pin: null,
      popup: null,
      drawing: null,
    });
    db.close();
  });

  it('迁移后的整页便签以 Text 批注导出并保留内容', async () => {
    createV3Database(1);
    const db = openDb(dbPath);
    try {
      const listed = listStickyNotes(db, 1, 'original');
      expect(listed).toHaveLength(1);
      expect(listed[0]).toMatchObject({
        anchor: { kind: 'page' },
        kind: 'note',
        markStyle: 'none',
        color: null,
      });

      const result = await buildAnnotatedPdf(await syntheticPdf(), listed);

      expect(result.exported).toBe(1);
      expect(result.skipped).toBe(0);
      const output = await PDFDocument.load(result.bytes);
      const annotation = firstAnnotation(output);
      expect(annotation.subtype).toBe('Text');
      expect(annotation.contents).toContain('【原文】');
      expect(annotation.contents).toContain('旧便签');
      expect(annotation.contents).toContain('【标注】');
      expect(annotation.contents).toContain('旧内容');
    } finally {
      db.close();
    }
  });
});
