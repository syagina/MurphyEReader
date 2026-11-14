import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '@main/db';
import { getApiKey, getSettings, SETTINGS_KEYS, setSettings } from '@main/settings';
import { createPlainTestSecretStore } from '@main/settings/secret-store';
import type { SecretStore } from '@main/settings/secret-store';
import type { AiSettingsInput } from '@shared/types';

let tempDir: string;
let db: Database.Database;
let secret: SecretStore;

function inputWith(overrides: Partial<AiSettingsInput> = {}): AiSettingsInput {
  return {
    baseUrl: 'https://api.example.com/v1',
    chatModel: 'gpt-4o',
    visionModel: 'gpt-4o-mini',
    temperature: 0.5,
    tokenBudget: 50000,
    ...overrides,
  };
}

function storedValue(key: string): string | undefined {
  const row = db
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get(key) as { value: string } | undefined;
  return row?.value;
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'paperlens-'));
  db = openDb(join(tempDir, 'paperlens.db'));
  secret = createPlainTestSecretStore();
});

afterEach(() => {
  db.close();
  rmSync(tempDir, { recursive: true, force: true });
});

describe('createPlainTestSecretStore', () => {
  it('encrypt 加上 plain: 前缀，decrypt 去掉前缀还原明文', () => {
    expect(secret.encrypt('sk-test')).toBe('plain:sk-test');
    expect(secret.decrypt('plain:sk-test')).toBe('sk-test');
  });

  it('decrypt 遇到缺少 plain: 前缀的密文时抛错', () => {
    expect(() => secret.decrypt('sk-test')).toThrow();
    expect(() => secret.decrypt('')).toThrow();
  });
});

describe('getSettings', () => {
  it('空表时返回默认值且 apiKeySet 为 false', () => {
    expect(getSettings(db, secret)).toEqual({
      baseUrl: '',
      chatModel: '',
      visionModel: '',
      temperature: 0.3,
      tokenBudget: 100000,
      apiKeySet: false,
    });
  });

  it('存储的数值不是有限数字时回退到默认值，其余字段照常读取', () => {
    const insert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
    insert.run(SETTINGS_KEYS.temperature, 'not-a-number');
    insert.run(SETTINGS_KEYS.tokenBudget, 'Infinity');
    insert.run(SETTINGS_KEYS.baseUrl, 'https://kept.example.com');

    const settings = getSettings(db, secret);

    expect(settings.temperature).toBe(0.3);
    expect(settings.tokenBudget).toBe(100000);
    expect(settings.baseUrl).toBe('https://kept.example.com');
  });

  it('apiKey 行是空字符串时视为未设置', () => {
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(
      SETTINGS_KEYS.apiKey,
      '',
    );

    expect(getSettings(db, secret).apiKeySet).toBe(false);
    expect(getApiKey(db, secret)).toBe('');
  });
});

describe('setSettings', () => {
  it('写入后读取返回同样的设置，apiKey 以密文落库且 apiKeySet 为 true', () => {
    const input = inputWith({ apiKey: 'sk-test' });

    const returned = setSettings(db, secret, input);

    const expected = {
      baseUrl: input.baseUrl,
      chatModel: input.chatModel,
      visionModel: input.visionModel,
      temperature: input.temperature,
      tokenBudget: input.tokenBudget,
      apiKeySet: true,
    };
    expect(returned).toEqual(expected);
    expect(getSettings(db, secret)).toEqual(expected);
    expect(storedValue(SETTINGS_KEYS.apiKey)).toBe('plain:sk-test');
  });

  it('input.apiKey 为 undefined 时保留旧 key', () => {
    setSettings(db, secret, inputWith({ apiKey: 'sk-old' }));

    const returned = setSettings(db, secret, inputWith({ chatModel: 'gpt-4.1' }));

    expect(returned.apiKeySet).toBe(true);
    expect(getApiKey(db, secret)).toBe('sk-old');
    expect(storedValue(SETTINGS_KEYS.apiKey)).toBe('plain:sk-old');
  });

  it("input.apiKey 为 '' 时删除 key 行并将 apiKeySet 置为 false", () => {
    setSettings(db, secret, inputWith({ apiKey: 'sk-old' }));

    const returned = setSettings(db, secret, inputWith({ apiKey: '' }));

    expect(returned.apiKeySet).toBe(false);
    expect(getApiKey(db, secret)).toBe('');
    expect(storedValue(SETTINGS_KEYS.apiKey)).toBeUndefined();
  });
});

describe('getApiKey', () => {
  it('解密已存储的 key 返回明文', () => {
    setSettings(db, secret, inputWith({ apiKey: 'sk-decrypt-me' }));

    expect(getApiKey(db, secret)).toBe('sk-decrypt-me');
  });

  it('未存储 key 时返回空字符串', () => {
    expect(getApiKey(db, secret)).toBe('');
  });
});

describe('API key 安全边界', () => {
  it('getSettings 只暴露 apiKeySet，不含明文 key，也不触发解密', () => {
    setSettings(db, secret, inputWith({ apiKey: 'sk-super-secret' }));
    const decryptGuard: SecretStore = {
      encrypt: (plain) => secret.encrypt(plain),
      decrypt: () => {
        throw new Error('getSettings 不应解密 API key');
      },
    };

    const settings = getSettings(db, decryptGuard);

    expect(settings.apiKeySet).toBe(true);
    expect(settings).not.toHaveProperty('apiKey');
    expect(Object.keys(settings).sort()).toEqual([
      'apiKeySet',
      'baseUrl',
      'chatModel',
      'temperature',
      'tokenBudget',
      'visionModel',
    ]);
    expect(JSON.stringify(settings)).not.toContain('sk-super-secret');
  });
});
