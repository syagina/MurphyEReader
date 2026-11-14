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
      expect.arrayContaining(['papers', 'pages', 'conversations', 'messages', 'notes', 'settings']),
    );
  });

  it('将 PRAGMA user_version 设为 SCHEMA_VERSION', () => {
    expect(SCHEMA_VERSION).toBe(1);
    expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION);
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
