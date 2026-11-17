import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '@main/db';
import {
  APP_SETTINGS_KEYS,
  defaultLibraryRoot,
  ensureOnboardedForExistingLibrary,
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
  it('返回文档目录下的 MurphyEReader 文件夹', () => {
    expect(defaultLibraryRoot(docsDir)).toBe(join(docsDir, 'MurphyEReader'));
  });
});

describe('getStoredAppSettings', () => {
  it('空表时返回默认值：库根目录为默认值、BabelDOC 路径为空、宽度 360', () => {
    expect(getStoredAppSettings(db, docsDir)).toEqual({
      libraryRoot: join(docsDir, 'MurphyEReader'),
      defaultLibraryRoot: join(docsDir, 'MurphyEReader'),
      babeldocPath: '',
      aiPanelWidth: 360,
      theme: 'light',
      paperTexture: 45,
      translationQps: 128,
      translationWorkers: 128,
      translationAutoGlossary: true,
      onboarded: false,
    });
  });

  it('返回的结构不包含 babeldocDetectedPath', () => {
    expect(Object.keys(getStoredAppSettings(db, docsDir)).sort()).toEqual([
      'aiPanelWidth',
      'babeldocPath',
      'defaultLibraryRoot',
      'libraryRoot',
      'onboarded',
      'paperTexture',
      'theme',
      'translationAutoGlossary',
      'translationQps',
      'translationWorkers',
    ]);
  });

  it('已存储的库根目录优先于默认值', () => {
    setLibraryRootSetting(db, 'D:/Library');

    const settings = getStoredAppSettings(db, docsDir);

    expect(settings.libraryRoot).toBe('D:/Library');
    expect(settings.defaultLibraryRoot).toBe(join(docsDir, 'MurphyEReader'));
  });

  it('库根目录存储为空白时回退到默认值', () => {
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(
      APP_SETTINGS_KEYS.libraryRoot,
      '   ',
    );

    expect(getStoredAppSettings(db, docsDir).libraryRoot).toBe(
      join(docsDir, 'MurphyEReader'),
    );
  });

  it('已存储的 BabelDOC 路径原样返回', () => {
    setStoredAppSettings(db, { babeldocPath: 'C:/Tools/babeldoc.exe' });

    expect(getStoredAppSettings(db, docsDir).babeldocPath).toBe(
      'C:/Tools/babeldoc.exe',
    );
  });

  it('存储的主题原样返回，未知主题回退到浅色', () => {
    setStoredAppSettings(db, { theme: 'dark' });
    expect(getStoredAppSettings(db, docsDir).theme).toBe('dark');

    setStoredAppSettings(db, { theme: 'eye-care' });
    expect(getStoredAppSettings(db, docsDir).theme).toBe('eye-care');

    setStoredAppSettings(db, { theme: 'paper' });
    expect(getStoredAppSettings(db, docsDir).theme).toBe('paper');

    db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(
      'solarized',
      APP_SETTINGS_KEYS.theme,
    );
    expect(getStoredAppSettings(db, docsDir).theme).toBe('light');
  });

  it('纸纹强度缺失时使用默认值，非法值回退、超出范围时夹紧', () => {
    expect(getStoredAppSettings(db, docsDir).paperTexture).toBe(45);

    const insert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
    insert.run(APP_SETTINGS_KEYS.paperTexture, 'not-a-number');
    expect(getStoredAppSettings(db, docsDir).paperTexture).toBe(45);

    db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(
      '180',
      APP_SETTINGS_KEYS.paperTexture,
    );
    expect(getStoredAppSettings(db, docsDir).paperTexture).toBe(100);

    db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(
      '-5',
      APP_SETTINGS_KEYS.paperTexture,
    );
    expect(getStoredAppSettings(db, docsDir).paperTexture).toBe(0);
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

  it('翻译 QPS 缺失或非法时回退到默认值，超出范围时夹紧', () => {
    const insert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
    insert.run(APP_SETTINGS_KEYS.translationQps, 'not-a-number');
    expect(getStoredAppSettings(db, docsDir).translationQps).toBe(128);

    db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(
      '999',
      APP_SETTINGS_KEYS.translationQps,
    );
    expect(getStoredAppSettings(db, docsDir).translationQps).toBe(512);

    db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(
      '0',
      APP_SETTINGS_KEYS.translationQps,
    );
    expect(getStoredAppSettings(db, docsDir).translationQps).toBe(1);
  });

  it('并行线程数缺失或非法时回退到默认值，超出范围时夹紧', () => {
    expect(getStoredAppSettings(db, docsDir).translationWorkers).toBe(128);

    const insert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
    insert.run(APP_SETTINGS_KEYS.translationWorkers, 'not-a-number');
    expect(getStoredAppSettings(db, docsDir).translationWorkers).toBe(128);

    db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(
      '999',
      APP_SETTINGS_KEYS.translationWorkers,
    );
    expect(getStoredAppSettings(db, docsDir).translationWorkers).toBe(512);

    db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(
      '0',
      APP_SETTINGS_KEYS.translationWorkers,
    );
    expect(getStoredAppSettings(db, docsDir).translationWorkers).toBe(1);
  });

  it('旧版本未存独立线程数时沿用已存的 QPS 作为并发数', () => {
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(
      APP_SETTINGS_KEYS.translationQps,
      '32',
    );

    expect(getStoredAppSettings(db, docsDir).translationWorkers).toBe(32);

    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(
      APP_SETTINGS_KEYS.translationWorkers,
      'not-a-number',
    );
    expect(getStoredAppSettings(db, docsDir).translationWorkers).toBe(32);
  });

  it('全新安装或 QPS 不可读时线程数仍使用自己的默认值', () => {
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(
      APP_SETTINGS_KEYS.translationQps,
      'not-a-number',
    );

    const settings = getStoredAppSettings(db, docsDir);
    expect(settings.translationQps).toBe(128);
    expect(settings.translationWorkers).toBe(128);
  });

  it('自动术语提取默认开启，只有显式 false 才关闭', () => {
    expect(getStoredAppSettings(db, docsDir).translationAutoGlossary).toBe(true);

    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(
      APP_SETTINGS_KEYS.translationAutoGlossary,
      'unexpected',
    );
    expect(getStoredAppSettings(db, docsDir).translationAutoGlossary).toBe(true);
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

  it('主题以原始字符串落库，并在读取时规范化', () => {
    setStoredAppSettings(db, { theme: 'eye-care' });

    expect(storedValue(APP_SETTINGS_KEYS.theme)).toBe('eye-care');
    expect(getStoredAppSettings(db, docsDir).theme).toBe('eye-care');
  });

  it('纸纹强度以规范化后的整数落库', () => {
    setStoredAppSettings(db, { paperTexture: 72.6 });

    expect(storedValue(APP_SETTINGS_KEYS.paperTexture)).toBe('73');
    expect(getStoredAppSettings(db, docsDir).paperTexture).toBe(73);

    setStoredAppSettings(db, { paperTexture: 140 });

    expect(storedValue(APP_SETTINGS_KEYS.paperTexture)).toBe('100');
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

  it('翻译性能设置以规范化后的字符串落库', () => {
    setStoredAppSettings(db, {
      translationQps: 999,
      translationWorkers: 999,
      translationAutoGlossary: false,
    });

    expect(getStoredAppSettings(db, docsDir)).toMatchObject({
      translationQps: 512,
      translationWorkers: 512,
      translationAutoGlossary: false,
    });
    expect(storedValue(APP_SETTINGS_KEYS.translationQps)).toBe('512');
    expect(storedValue(APP_SETTINGS_KEYS.translationWorkers)).toBe('512');
    expect(storedValue(APP_SETTINGS_KEYS.translationAutoGlossary)).toBe('false');
  });

  it('只更新翻译性能设置时不影响其他设置', () => {
    setStoredAppSettings(db, {
      babeldocPath: 'C:/Tools/babeldoc.exe',
      translationQps: 12,
      translationWorkers: 20,
    });

    setStoredAppSettings(db, { translationAutoGlossary: false });

    expect(getStoredAppSettings(db, docsDir)).toMatchObject({
      babeldocPath: 'C:/Tools/babeldoc.exe',
      translationQps: 12,
      translationWorkers: 20,
      translationAutoGlossary: false,
    });
  });

  it('写入 onboarded 后可读回', () => {
    setStoredAppSettings(db, { onboarded: true });

    expect(getStoredAppSettings(db, docsDir).onboarded).toBe(true);
    expect(storedValue(APP_SETTINGS_KEYS.onboarded)).toBe('true');
  });
});

describe('ensureOnboardedForExistingLibrary', () => {
  function insertPaper(): void {
    db.prepare(
      `INSERT INTO papers (title, file_path_original, page_count_original, added_at)
       VALUES ('p', 'p.pdf', 1, 0)`,
    ).run();
  }

  it('已有文献且缺标记时补写为已看过', () => {
    insertPaper();

    expect(ensureOnboardedForExistingLibrary(db)).toBe(true);
    expect(storedValue(APP_SETTINGS_KEYS.onboarded)).toBe('true');
  });

  it('空库不补写并返回 false', () => {
    expect(ensureOnboardedForExistingLibrary(db)).toBe(false);
    expect(storedValue(APP_SETTINGS_KEYS.onboarded)).toBeUndefined();
  });

  it('显式记录 false 时尊重存储值', () => {
    setStoredAppSettings(db, { onboarded: false });
    insertPaper();

    expect(ensureOnboardedForExistingLibrary(db)).toBe(false);
    expect(storedValue(APP_SETTINGS_KEYS.onboarded)).toBe('false');
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
