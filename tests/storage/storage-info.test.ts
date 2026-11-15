import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '@main/db';
import { setLibraryRootSetting } from '@main/settings/app-settings';
import { readStorageInfo } from '@main/storage/storage-info';

let tempDir: string;
let db: Database.Database;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'paperlens-storage-info-'));
  db = openDb(':memory:');
});

afterEach(() => {
  db.close();
  rmSync(tempDir, { recursive: true, force: true });
});

describe('readStorageInfo', () => {
  it('根目录可写时返回根路径、默认路径并创建目录结构', async () => {
    const info = await readStorageInfo(db, tempDir, null, null);
    const expectedRoot = join(tempDir, 'PaperLens');

    expect(info).toEqual({
      root: expectedRoot,
      defaultRoot: expectedRoot,
      writable: true,
      migration: null,
      error: null,
    });
    expect(existsSync(join(expectedRoot, 'papers'))).toBe(true);
    expect(existsSync(join(expectedRoot, 'exports'))).toBe(true);
  });

  it('优先返回设置中保存的文献库根目录', async () => {
    const custom = join(tempDir, 'custom-library');
    mkdirSync(custom);
    setLibraryRootSetting(db, custom);

    const info = await readStorageInfo(db, tempDir, null, null);

    expect(info.root).toBe(custom);
    expect(info.defaultRoot).toBe(join(tempDir, 'PaperLens'));
    expect(info.writable).toBe(true);
    expect(info.error).toBeNull();
  });

  it('根目录被同名文件占据时返回 writable:false 与中文错误且不抛出', async () => {
    const blocked = join(tempDir, 'PaperLens');
    writeFileSync(blocked, 'not a directory');

    const info = await readStorageInfo(db, tempDir, null, null);

    expect(info.root).toBe(blocked);
    expect(info.writable).toBe(false);
    expect(info.error).toMatch(/^文献库目录不可写：/);
  });

  it('透传迁移摘要与已记录的错误', async () => {
    const migration = {
      adopted: 2,
      skipped: [{ paperId: 3, title: '缺失', reason: '原文文件不存在' }],
    };

    const info = await readStorageInfo(db, tempDir, migration, '上次迁移失败');

    expect(info.migration).toEqual(migration);
    expect(info.error).toBe('上次迁移失败');
    expect(info.writable).toBe(true);
  });
});
