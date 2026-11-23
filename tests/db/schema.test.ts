import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '@main/db';
import { SCHEMA_VERSION } from '@main/db/schema';

let tempDir: string;
let db: Database.Database;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'paperlens-'));
  db = openDb(join(tempDir, 'paperlens.db'));
});

afterEach(() => {
  db.close();
  rmSync(tempDir, { recursive: true, force: true });
});

describe('openDb 初始化数据库', () => {
  it('创建全部业务表', () => {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as { name: string }[];
    expect(tables.map((table) => table.name)).toEqual(
      expect.arrayContaining([
        'papers',
        'pages',
        'conversations',
        'messages',
        'notes',
        'settings',
        'folders',
        'sticky_notes',
        'ai_profiles',
      ]),
    );
  });

  it('将 PRAGMA user_version 设为 SCHEMA_VERSION', () => {
    expect(SCHEMA_VERSION).toBe(6);
    expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION);
  });

  it('papers 表包含 v2 托管字段', () => {
    const columns = db.prepare("PRAGMA table_info('papers')").all() as { name: string }[];

    expect(columns.map((column) => column.name)).toEqual(
      expect.arrayContaining(['folder_id', 'file_hash', 'storage_dir']),
    );
  });

  it('papers 表包含 v5 阅读位置字段', () => {    const columns = db.prepare("PRAGMA table_info('papers')").all() as {
      name: string;
      dflt_value: string | null;
      notnull: number;
    }[];

    expect(columns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'last_version', dflt_value: "'original'", notnull: 1 }),
        expect.objectContaining({ name: 'last_offset_original', dflt_value: '0', notnull: 1 }),
        expect.objectContaining({ name: 'last_offset_translated', dflt_value: '0', notnull: 1 }),
        expect.objectContaining({ name: 'page_count_bilingual', dflt_value: null, notnull: 0 }),
      ]),
    );
  });

  it('ai_profiles 表包含 v6 档案字段', () => {
    const columns = db.prepare("PRAGMA table_info('ai_profiles')").all() as {
      name: string;
      dflt_value: string | null;
      notnull: number;
    }[];

    expect(columns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'name', notnull: 1 }),
        expect.objectContaining({ name: 'base_url', dflt_value: "''", notnull: 1 }),
        expect.objectContaining({ name: 'chat_model', dflt_value: "''", notnull: 1 }),
        expect.objectContaining({ name: 'vision_model', dflt_value: "''", notnull: 1 }),
        expect.objectContaining({ name: 'temperature', dflt_value: '0.3', notnull: 1 }),
        expect.objectContaining({ name: 'token_budget', dflt_value: '100000', notnull: 1 }),
        expect.objectContaining({ name: 'api_key', dflt_value: "''", notnull: 1 }),
        expect.objectContaining({ name: 'sort_order', dflt_value: '0', notnull: 1 }),
        expect.objectContaining({ name: 'created_at', notnull: 1 }),
      ]),
    );
  });

  it('开启外键约束', () => {
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
  });

  it('使用 WAL 日志模式', () => {
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
  });

  it('拒绝插入引用不存在论文的会话（外键生效）', () => {
    const insert = db.prepare('INSERT INTO conversations (paper_id, title, created_at) VALUES (?, ?, ?)');
    expect(() => insert.run(999, '引用不存在论文的会话', Date.now())).toThrow(/FOREIGN KEY/i);
  });

  it('重新打开已有数据库时不会重复建表', () => {
    db.close();
    db = openDb(join(tempDir, 'paperlens.db'));
    expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION);
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
  });
});
