import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '@main/db';
import {
  FOLDER_NAME_MAX,
  createFolder,
  getFolder,
  listFolders,
  normalizeFolderName,
  removeFolder,
  renameFolder,
} from '@main/db/folders';
import { createPaper, getPaper, listPapers } from '@main/db/papers';
import type { NewPaperInput } from '@main/db/papers';

let tempDir: string;
let db: Database.Database;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'paperlens-folders-'));
  db = openDb(join(tempDir, 'paperlens.db'));
});

afterEach(() => {
  db.close();
  rmSync(tempDir, { recursive: true, force: true });
});

function makeInput(overrides: Partial<NewPaperInput> = {}): NewPaperInput {
  return {
    title: '有限元方法导论',
    authors: '张三, 李四',
    year: 2020,
    filePathOriginal: 'C:/papers/fem-intro.pdf',
    filePathTranslated: null,
    pageCountOriginal: 120,
    pageCountTranslated: null,
    hasTextLayer: true,
    outline: [],
    folderId: null,
    storageDir: null,
    fileHash: null,
    ...overrides,
  };
}

describe('normalizeFolderName', () => {
  it('去除首尾空白并折叠内部空白', () => {
    expect(normalizeFolderName('  毕业论文  ')).toBe('毕业论文');
    expect(normalizeFolderName('方法 \n\t 参考')).toBe('方法 参考');
  });

  it('不改变合法名称', () => {
    expect(normalizeFolderName('Research 2024')).toBe('Research 2024');
  });
});

describe('createFolder', () => {
  it('保存规范化后的名称与创建时间', () => {
    const folder = createFolder(db, '  毕业论文  ', () => '2026-11-15T00:00:00.000Z');

    expect(folder).toEqual({
      id: expect.any(Number),
      name: '毕业论文',
      createdAt: '2026-11-15T00:00:00.000Z',
    });
    expect(getFolder(db, folder.id)).toEqual(folder);
  });

  it('将名称上限导出为 40', () => {
    expect(FOLDER_NAME_MAX).toBe(40);
  });

  it('空白名称被拒绝', () => {
    expect(() => createFolder(db, '')).toThrow('文件夹名称不能为空');
    expect(() => createFolder(db, '   ')).toThrow('文件夹名称不能为空');
    expect(() => createFolder(db, ' \n\t ')).toThrow('文件夹名称不能为空');
  });

  it('超过 40 个字符的名称被拒绝', () => {
    expect(() => createFolder(db, 'a'.repeat(41))).toThrow('文件夹名称不能超过 40 个字符');
    expect(() => createFolder(db, 'a'.repeat(40))).not.toThrow();
  });

  it('按 Unicode 码点计数而不是 UTF-16 单元', () => {
    expect(() => createFolder(db, '😀'.repeat(41))).toThrow('文件夹名称不能超过 40 个字符');
    expect(createFolder(db, '😀'.repeat(40)).name).toBe('😀'.repeat(40));
  });

  it('名称大小写不敏感唯一', () => {
    createFolder(db, 'Research');

    expect(() => createFolder(db, 'research')).toThrow('已有同名文件夹');
    expect(() => createFolder(db, '  RESEARCH  ')).toThrow('已有同名文件夹');
    expect(listFolders(db)).toHaveLength(1);
  });
});

describe('getFolder', () => {
  it('不存在的 id 返回 null', () => {
    expect(getFolder(db, 999)).toBeNull();
  });
});

describe('listFolders', () => {
  it('按创建时间升序返回，同一时间按 id 升序', () => {
    const later = createFolder(db, '后建', () => '2026-02-01T00:00:00.000Z');
    const sameTimeFirst = createFolder(db, '同刻甲', () => '2026-01-01T00:00:00.000Z');
    const sameTimeSecond = createFolder(db, '同刻乙', () => '2026-01-01T00:00:00.000Z');

    expect(listFolders(db).map((folder) => folder.id)).toEqual([
      sameTimeFirst.id,
      sameTimeSecond.id,
      later.id,
    ]);
  });

  it('没有文件夹时返回空数组', () => {
    expect(listFolders(db)).toEqual([]);
  });
});

describe('renameFolder', () => {
  it('重命名并返回更新后的文件夹', () => {
    const folder = createFolder(db, '旧名称');

    const renamed = renameFolder(db, folder.id, '  新名称  ');

    expect(renamed).toEqual({ id: folder.id, name: '新名称', createdAt: folder.createdAt });
    expect(getFolder(db, folder.id)).toEqual(renamed);
  });

  it('与其他文件夹重名时拒绝（大小写不敏感）', () => {
    createFolder(db, 'Research');
    const target = createFolder(db, '待改名');

    expect(() => renameFolder(db, target.id, 'research')).toThrow('已有同名文件夹');
    expect(getFolder(db, target.id)?.name).toBe('待改名');
  });

  it('允许改成仅大小写不同的自身名称', () => {
    const folder = createFolder(db, 'research');

    expect(renameFolder(db, folder.id, 'Research').name).toBe('Research');
  });

  it('拒绝空白与超长名称', () => {
    const folder = createFolder(db, '合法名称');

    expect(() => renameFolder(db, folder.id, '   ')).toThrow('文件夹名称不能为空');
    expect(() => renameFolder(db, folder.id, 'a'.repeat(41))).toThrow(
      '文件夹名称不能超过 40 个字符',
    );
    expect(getFolder(db, folder.id)?.name).toBe('合法名称');
  });

  it('不存在的 id 抛出中文错误', () => {
    expect(() => renameFolder(db, 999, '新名称')).toThrow(/文件夹不存在/);
  });
});

describe('removeFolder', () => {
  it('删除文件夹后文献回到未分类，文献本身保留', () => {
    const folder = createFolder(db, '毕业论文');
    const paper = createPaper(db, makeInput({ folderId: folder.id, fileHash: 'abc' }));

    removeFolder(db, folder.id);

    expect(getFolder(db, folder.id)).toBeNull();
    expect(getPaper(db, paper.id)).toMatchObject({
      id: paper.id,
      title: '有限元方法导论',
      folderId: null,
      fileHash: 'abc',
    });
    expect(listPapers(db)).toHaveLength(1);
  });

  it('不存在的 id 不抛错', () => {
    expect(() => removeFolder(db, 999)).not.toThrow();
  });
});
