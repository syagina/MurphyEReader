import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '@main/db';
import { getPaper, listPapers } from '@main/db/papers';
import { MIGRATION_V1 } from '@main/db/schema';

let tempDir: string;
let dbPath: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'paperlens-v2-'));
  dbPath = join(tempDir, 'paperlens.db');
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function createV1Database(): void {
  const raw = new Database(dbPath);
  raw.exec(MIGRATION_V1);
  raw
    .prepare(
      `INSERT INTO papers
        (title, authors, year, file_path_original, page_count_original, has_text_layer,
         outline_json, tags_json, added_at)
        VALUES ('旧文献', '', 2020, 'C:/old.pdf', 3, 1, '[]', '[]', 123)`,
    )
    .run();
  raw.close();
}

function tableNames(db: Database.Database): string[] {
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all() as { name: string }[];
  return rows.map((row) => row.name);
}

describe('v1 → v2 迁移', () => {
  it('将已有 v1 数据库原地升级到当前版本，原有数据逐字段不变', () => {
    createV1Database();

    const db = openDb(dbPath);

    expect(db.pragma('user_version', { simple: true })).toBe(6);
    expect(getPaper(db, 1)).toMatchObject({
      id: 1,
      title: '旧文献',
      authors: '',
      year: 2020,
      filePathOriginal: 'C:/old.pdf',
      pageCountOriginal: 3,
      hasTextLayer: true,
      addedAt: 123,
      folderId: null,
      storageDir: null,
      fileHash: null,
    });
    db.close();
  });

  it('重复打开数据库保持幂等，数据不重复也不丢失', () => {
    createV1Database();

    const first = openDb(dbPath);
    first.close();

    const second = openDb(dbPath);

    expect(second.pragma('user_version', { simple: true })).toBe(6);
    expect(listPapers(second)).toHaveLength(1);
    expect(getPaper(second, 1)?.title).toBe('旧文献');
    second.close();
  });

  it('升级后 papers 含新的托管字段与索引，且创建 folders 表', () => {
    createV1Database();

    const db = openDb(dbPath);
    const columns = db
      .prepare("PRAGMA table_info('papers')")
      .all() as { name: string }[];
    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
      .all() as { name: string }[];

    expect(columns.map((column) => column.name)).toEqual(
      expect.arrayContaining(['folder_id', 'file_hash', 'storage_dir']),
    );
    expect(indexes.map((index) => index.name)).toEqual(
      expect.arrayContaining(['idx_papers_folder', 'idx_papers_hash']),
    );
    expect(tableNames(db)).toContain('folders');
    db.close();
  });

  it('folders 表名称大小写不敏感唯一', () => {
    const db = openDb(dbPath);
    db.prepare("INSERT INTO folders (name, created_at) VALUES ('Research', '2026-01-01')").run();

    expect(() =>
      db.prepare("INSERT INTO folders (name, created_at) VALUES ('research', '2026-01-02')").run(),
    ).toThrow(/UNIQUE/i);
    db.close();
  });

  it('删除文件夹后文献 folder_id 置空（ON DELETE SET NULL）', () => {
    createV1Database();

    const db = openDb(dbPath);
    const folderId = Number(
      db
        .prepare("INSERT INTO folders (name, created_at) VALUES ('毕业论文', '2026-01-01')")
        .run().lastInsertRowid,
    );
    db.prepare('UPDATE papers SET folder_id = ? WHERE id = 1').run(folderId);

    db.prepare('DELETE FROM folders WHERE id = ?').run(folderId);

    expect(getPaper(db, 1)?.folderId).toBeNull();
    db.close();
  });

  it('全新数据库直接以当前版本初始化', () => {
    const db = openDb(dbPath);

    expect(db.pragma('user_version', { simple: true })).toBe(6);
    expect(tableNames(db)).toEqual(expect.arrayContaining(['papers', 'folders', 'settings']));
    db.close();
  });
});
