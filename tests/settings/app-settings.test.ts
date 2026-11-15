import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '@main/db';
import {
  APP_SETTINGS_KEYS,
  defaultLibraryRoot,
  getStoredAppSettings,
  normalizePanelWidth,
  setLibraryRootSetting,
  setStoredAppSettings,
} from '@main/settings/app-settings';

let tempDir: string;
let docsDir: string;
let db: Database.Database;

function storedValue(key: string): string | undefined {
  const row = db
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get(key) as { value: string } | undefined;
  return row?.value;
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'paperlens-app-settings-'));
  docsDir = join(tempDir, 'Documents');
  db = openDb(join(tempDir, 'paperlens.db'));
});

afterEach(() => {
  db.close();
  rmSync(tempDir, { recursive: true, force: true });
});

describe('defaultLibraryRoot', () => {
  it('返回文档目录下的 PaperLens 文件夹', () => {
    expect(defaultLibraryRoot(docsDir)).toBe(join(docsDir, 'PaperLens'));
  });
});

describe('getStoredAppSettings', () => {
  it('空表时返回默认值：库根目录为默认值、BabelDOC 路径为空、宽度 360', () => {
    expect(getStoredAppSettings(db, docsDir)).toEqual({
      libraryRoot: join(docsDir, 'PaperLens'),
      defaultLibraryRoot: join(docsDir, 'PaperLens'),
      babeldocPath: '',
      aiPanelWidth: 360,
    });
  });

  it('返回的结构不包含 babeldocDetectedPath', () => {
    expect(Object.keys(getStoredAppSettings(db, docsDir)).sort()).toEqual([
      'aiPanelWidth',
      'babeldocPath',
      'defaultLibraryRoot',
      'libraryRoot',
    ]);
  });

  it('已存储的库根目录优先于默认值', () => {
    setLibraryRootSetting(db, 'D:/Library');

    const settings = getStoredAppSettings(db, docsDir);

    expect(settings.libraryRoot).toBe('D:/Library');
    expect(settings.defaultLibraryRoot).toBe(join(docsDir, 'PaperLens'));
  });

  it('库根目录存储为空白时回退到默认值', () => {
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(
      APP_SETTINGS_KEYS.libraryRoot,
      '   ',
    );

    expect(getStoredAppSettings(db, docsDir).libraryRoot).toBe(
      join(docsDir, 'PaperLens'),
    );
  });

  it('已存储的 BabelDOC 路径原样返回', () => {
    setStoredAppSettings(db, { babeldocPath: 'C:/Tools/babeldoc.exe' });

    expect(getStoredAppSettings(db, docsDir).babeldocPath).toBe(
      'C:/Tools/babeldoc.exe',
    );
  });

  it('存储的宽度不是有限数字时回退到默认宽度', () => {
    const insert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
    insert.run(APP_SETTINGS_KEYS.aiPanelWidth, 'not-a-number');
    expect(getStoredAppSettings(db, docsDir).aiPanelWidth).toBe(360);

    db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(
      'Infinity',
      APP_SETTINGS_KEYS.aiPanelWidth,
    );
    expect(getStoredAppSettings(db, docsDir).aiPanelWidth).toBe(360);
  });

  it('存储的宽度超出范围时夹紧', () => {
    const insert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
    insert.run(APP_SETTINGS_KEYS.aiPanelWidth, '1200');
    expect(getStoredAppSettings(db, docsDir).aiPanelWidth).toBe(900);

    db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(
      '10',
      APP_SETTINGS_KEYS.aiPanelWidth,
    );
    expect(getStoredAppSettings(db, docsDir).aiPanelWidth).toBe(320);
  });
});

describe('setStoredAppSettings', () => {
  it('写入后读取返回夹紧后的宽度，宽度以数字字符串落库', () => {
    setStoredAppSettings(db, {
      babeldocPath: 'C:/Tools/babeldoc.exe',
      aiPanelWidth: 1200,
    });

    expect(getStoredAppSettings(db, docsDir)).toMatchObject({
      babeldocPath: 'C:/Tools/babeldoc.exe',
      aiPanelWidth: 900,
    });
    expect(storedValue(APP_SETTINGS_KEYS.babeldocPath)).toBe(
      'C:/Tools/babeldoc.exe',
    );
    expect(storedValue(APP_SETTINGS_KEYS.aiPanelWidth)).toBe('900');
  });

  it('BabelDOC 路径为空白字符串时清除存储', () => {
    setStoredAppSettings(db, { babeldocPath: 'C:/Tools/babeldoc.exe' });

    setStoredAppSettings(db, { babeldocPath: '' });

    expect(getStoredAppSettings(db, docsDir).babeldocPath).toBe('');
    expect(storedValue(APP_SETTINGS_KEYS.babeldocPath)).toBeUndefined();
  });

  it('BabelDOC 路径为 null 时清除存储', () => {
    setStoredAppSettings(db, { babeldocPath: 'C:/Tools/babeldoc.exe' });

    setStoredAppSettings(db, { babeldocPath: null });

    expect(getStoredAppSettings(db, docsDir).babeldocPath).toBe('');
    expect(storedValue(APP_SETTINGS_KEYS.babeldocPath)).toBeUndefined();
  });

  it('仅含空白的 BabelDOC 路径视为清除', () => {
    setStoredAppSettings(db, { babeldocPath: '   ' });

    expect(getStoredAppSettings(db, docsDir).babeldocPath).toBe('');
    expect(storedValue(APP_SETTINGS_KEYS.babeldocPath)).toBeUndefined();
  });

  it('保存前去除 BabelDOC 路径首尾空白', () => {
    setStoredAppSettings(db, { babeldocPath: '  C:/Tools/babeldoc.exe  ' });

    expect(getStoredAppSettings(db, docsDir).babeldocPath).toBe(
      'C:/Tools/babeldoc.exe',
    );
  });

  it('只更新提供的键，未提供的键保持原值', () => {
    setLibraryRootSetting(db, 'D:/Library');
    setStoredAppSettings(db, {
      babeldocPath: 'C:/Tools/babeldoc.exe',
      aiPanelWidth: 500,
    });

    setStoredAppSettings(db, { aiPanelWidth: 600 });

    expect(getStoredAppSettings(db, docsDir)).toMatchObject({
      libraryRoot: 'D:/Library',
      babeldocPath: 'C:/Tools/babeldoc.exe',
      aiPanelWidth: 600,
    });
  });

  it('空补丁不写入任何设置行', () => {
    setStoredAppSettings(db, {});

    const row = db.prepare('SELECT COUNT(*) AS count FROM settings').get() as {
      count: number;
    };
    expect(row.count).toBe(0);
  });

  it('宽度低于最小值和高于最大值时夹紧后存储', () => {
    setStoredAppSettings(db, { aiPanelWidth: 10 });
    expect(getStoredAppSettings(db, docsDir).aiPanelWidth).toBe(320);
    expect(storedValue(APP_SETTINGS_KEYS.aiPanelWidth)).toBe('320');
  });
});

describe('setLibraryRootSetting', () => {
  it('写入并覆盖库根目录，保存前去除首尾空白', () => {
    setLibraryRootSetting(db, '  D:/Library  ');
    expect(getStoredAppSettings(db, docsDir).libraryRoot).toBe('D:/Library');

    setLibraryRootSetting(db, 'E:/Papers');
    expect(getStoredAppSettings(db, docsDir).libraryRoot).toBe('E:/Papers');
  });
});

describe('normalizePanelWidth', () => {
  it('把宽度夹紧到 [320, 900] 并四舍五入', () => {
    expect(normalizePanelWidth(360)).toBe(360);
    expect(normalizePanelWidth(10)).toBe(320);
    expect(normalizePanelWidth(1200)).toBe(900);
    expect(normalizePanelWidth(400.6)).toBe(401);
  });

  it('非有限值回退到默认宽度', () => {
    expect(normalizePanelWidth(Number.NaN)).toBe(360);
    expect(normalizePanelWidth(Number.POSITIVE_INFINITY)).toBe(360);
    expect(normalizePanelWidth(Number.NEGATIVE_INFINITY)).toBe(360);
  });
});
