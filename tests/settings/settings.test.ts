import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '@main/db';
import { getApiKey, getSettings } from '@main/settings';
import {
  activateProfile,
  createProfile,
  updateProfile,
} from '@main/settings/ai-profiles';
import { createPlainTestSecretStore } from '@main/settings/secret-store';
import type { SecretStore } from '@main/settings/secret-store';
import type { AiProfileInput } from '@shared/types';

let tempDir: string;
let db: Database.Database;
let secret: SecretStore;

function inputWith(overrides: Partial<AiProfileInput> = {}): AiProfileInput {
  return {
    name: '默认配置',
    baseUrl: 'https://api.example.com/v1',
    chatModel: 'gpt-4o',
    visionModel: 'gpt-4o-mini',
    temperature: 0.5,
    tokenBudget: 50000,
    ...overrides,
  };
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

  it('读取当前生效档案，而不是任意一条', () => {
    const created = createProfile(db, secret, inputWith({ apiKey: 'sk-test' }));
    activateProfile(db, created.id);

    expect(getSettings(db, secret)).toEqual({
      baseUrl: inputWith().baseUrl,
      chatModel: inputWith().chatModel,
      visionModel: inputWith().visionModel,
      temperature: inputWith().temperature,
      tokenBudget: inputWith().tokenBudget,
      apiKeySet: true,
    });
    expect(getApiKey(db, secret)).toBe('sk-test');
  });

  it('切换档案后立即读到新档案', () => {
    const first = createProfile(
      db,
      secret,
      inputWith({ name: 'A', baseUrl: 'https://a.example.com/v1', apiKey: 'sk-a' }),
    );
    const second = createProfile(
      db,
      secret,
      inputWith({ name: 'B', baseUrl: 'https://b.example.com/v1', apiKey: 'sk-b' }),
    );
    activateProfile(db, first.id);
    expect(getSettings(db, secret).baseUrl).toBe('https://a.example.com/v1');

    activateProfile(db, second.id);

    expect(getSettings(db, secret).baseUrl).toBe('https://b.example.com/v1');
    expect(getApiKey(db, secret)).toBe('sk-b');
  });
});

describe('API key 安全边界', () => {
  it('getSettings 只暴露 apiKeySet，不含明文 key，也不触发解密', () => {
    const created = createProfile(db, secret, inputWith({ apiKey: 'sk-super-secret' }));
    activateProfile(db, created.id);
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

  it('更新 apiKey 后旧明文不再出现在读取结果中', () => {
    const created = createProfile(db, secret, inputWith({ apiKey: 'sk-old' }));
    activateProfile(db, created.id);
    updateProfile(db, secret, created.id, inputWith({ apiKey: 'sk-new' }));

    expect(getApiKey(db, secret)).toBe('sk-new');
    expect(JSON.stringify(getSettings(db, secret))).not.toContain('sk-old');
  });
});
