import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '@main/db';
import {
  ACTIVE_PROFILE_KEY,
  activateProfile,
  createProfile,
  deleteProfile,
  getActiveApiKey,
  getActiveSettings,
  getProfileApiKey,
  listProfileConfigs,
  listProfiles,
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
    name: 'DeepSeek 官方',
    baseUrl: 'https://api.example.com/v1',
    chatModel: 'gpt-4o',
    visionModel: 'gpt-4o-mini',
    temperature: 0.5,
    tokenBudget: 50000,
    ...overrides,
  };
}

function activeId(): number | null {
  const row = db
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get(ACTIVE_PROFILE_KEY) as { value: string } | undefined;
  return row === undefined ? null : Number(row.value);
}

function storedKey(profileId: number): string | undefined {
  const row = db
    .prepare('SELECT api_key FROM ai_profiles WHERE id = ?')
    .get(profileId) as { api_key: string } | undefined;
  return row?.api_key;
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'paperlens-profiles-'));
  db = openDb(join(tempDir, 'paperlens.db'));
  secret = createPlainTestSecretStore();
});

afterEach(() => {
  db.close();
  rmSync(tempDir, { recursive: true, force: true });
});

describe('createProfile', () => {
  it('保存配置并加密 API Key，列表不含密文或明文', () => {
    const created = createProfile(db, secret, inputWith({ apiKey: 'sk-secret' }));

    expect(created).toEqual({
      id: created.id,
      name: 'DeepSeek 官方',
      baseUrl: 'https://api.example.com/v1',
      chatModel: 'gpt-4o',
      visionModel: 'gpt-4o-mini',
      temperature: 0.5,
      tokenBudget: 50000,
      apiKeySet: true,
      active: true,
      createdAt: created.createdAt,
    });
    expect(storedKey(created.id)).toBe('plain:sk-secret');
    expect(JSON.stringify(listProfiles(db))).not.toContain('sk-secret');
    expect(listProfiles(db)[0]).not.toHaveProperty('apiKey');
  });

  it('按创建顺序递增 sort_order', () => {
    const first = createProfile(db, secret, inputWith({ name: 'A' }));
    const second = createProfile(db, secret, inputWith({ name: 'B' }));

    expect(listProfiles(db).map((profile) => profile.name)).toEqual(['A', 'B']);
    expect(second.createdAt).toBeGreaterThanOrEqual(first.createdAt);
  });

  it('第一条档案自动成为当前，后续新建不抢占', () => {
    const first = createProfile(db, secret, inputWith({ name: 'A' }));
    expect(first.active).toBe(true);
    expect(activeId()).toBe(first.id);

    const second = createProfile(db, secret, inputWith({ name: 'B' }));

    expect(second.active).toBe(false);
    expect(activeId()).toBe(first.id);
  });

  it('名称为空或过长时拒绝保存', () => {
    expect(() => createProfile(db, secret, inputWith({ name: '   ' }))).toThrow(
      '配置名称不能为空',
    );
    expect(() =>
      createProfile(db, secret, inputWith({ name: 'x'.repeat(61) })),
    ).toThrow('配置名称不能超过 60 个字符');
    expect(listProfiles(db)).toEqual([]);
  });
});

describe('activateProfile', () => {
  it('切换当前档案并反映在列表中', () => {
    const first = createProfile(db, secret, inputWith({ name: 'A' }));
    const second = createProfile(db, secret, inputWith({ name: 'B' }));

    activateProfile(db, second.id);

    expect(activeId()).toBe(second.id);
    expect(listProfiles(db).map((profile) => [profile.name, profile.active])).toEqual([
      ['A', false],
      ['B', true],
    ]);

    activateProfile(db, first.id);
    expect(activeId()).toBe(first.id);
  });

  it('不存在的档案抛错且不改当前指针', () => {
    expect(() => activateProfile(db, 999)).toThrow('配置不存在');
    expect(activeId()).toBeNull();
  });
});

describe('updateProfile', () => {
  it('apiKey 为 undefined 时保留旧 key', () => {
    const created = createProfile(db, secret, inputWith({ apiKey: 'sk-old' }));

    const updated = updateProfile(db, secret, created.id, inputWith({ chatModel: 'gpt-4.1' }));

    expect(updated.chatModel).toBe('gpt-4.1');
    expect(updated.apiKeySet).toBe(true);
    expect(getProfileApiKey(db, secret, created.id)).toBe('sk-old');
  });

  it("apiKey 为 '' 时清除 key", () => {
    const created = createProfile(db, secret, inputWith({ apiKey: 'sk-old' }));

    const updated = updateProfile(db, secret, created.id, inputWith({ apiKey: '' }));

    expect(updated.apiKeySet).toBe(false);
    expect(storedKey(created.id)).toBe('');
    expect(getProfileApiKey(db, secret, created.id)).toBe('');
  });

  it('新 key 覆盖旧密文', () => {
    const created = createProfile(db, secret, inputWith({ apiKey: 'sk-old' }));

    updateProfile(db, secret, created.id, inputWith({ apiKey: 'sk-new' }));

    expect(storedKey(created.id)).toBe('plain:sk-new');
    expect(getProfileApiKey(db, secret, created.id)).toBe('sk-new');
  });

  it('不存在的档案抛错', () => {
    expect(() => updateProfile(db, secret, 999, inputWith())).toThrow('配置不存在');
  });
});

describe('deleteProfile', () => {
  it('删除当前档案后自动切到剩余的第一条', () => {
    const first = createProfile(db, secret, inputWith({ name: 'A' }));
    const second = createProfile(db, secret, inputWith({ name: 'B' }));
    activateProfile(db, first.id);

    deleteProfile(db, first.id);

    expect(activeId()).toBe(second.id);
    expect(listProfiles(db).map((profile) => profile.name)).toEqual(['B']);
  });

  it('删除最后一个档案后清空当前指针', () => {
    const only = createProfile(db, secret, inputWith({ name: 'A' }));
    activateProfile(db, only.id);

    deleteProfile(db, only.id);

    expect(activeId()).toBeNull();
    expect(listProfiles(db)).toEqual([]);
  });

  it('删除非当前档案不影响当前指针', () => {
    const first = createProfile(db, secret, inputWith({ name: 'A' }));
    const second = createProfile(db, secret, inputWith({ name: 'B' }));
    activateProfile(db, first.id);

    deleteProfile(db, second.id);

    expect(activeId()).toBe(first.id);
  });
});

describe('活动档案读取', () => {
  it('没有当前档案时返回默认空设置', () => {
    expect(getActiveSettings(db, secret)).toEqual({
      baseUrl: '',
      chatModel: '',
      visionModel: '',
      temperature: 0.3,
      tokenBudget: 100000,
      apiKeySet: false,
    });
    expect(getActiveApiKey(db, secret)).toBe('');
  });

  it('getActiveSettings 只暴露 apiKeySet，不触发解密', () => {
    const created = createProfile(db, secret, inputWith({ apiKey: 'sk-super-secret' }));
    activateProfile(db, created.id);
    const decryptGuard: SecretStore = {
      encrypt: (plain) => secret.encrypt(plain),
      decrypt: () => {
        throw new Error('getActiveSettings 不应解密 API key');
      },
    };

    const settings = getActiveSettings(db, decryptGuard);

    expect(settings.apiKeySet).toBe(true);
    expect(settings).not.toHaveProperty('apiKey');
    expect(JSON.stringify(settings)).not.toContain('sk-super-secret');
  });

  it('getActiveApiKey 解密当前档案的 key', () => {
    const first = createProfile(db, secret, inputWith({ name: 'A', apiKey: 'sk-first' }));
    const second = createProfile(db, secret, inputWith({ name: 'B', apiKey: 'sk-second' }));
    activateProfile(db, second.id);

    expect(getActiveApiKey(db, secret)).toBe('sk-second');

    activateProfile(db, first.id);
    expect(getActiveApiKey(db, secret)).toBe('sk-first');
  });

  it('listProfileConfigs 返回每条档案的解密配置', () => {
    const first = createProfile(db, secret, inputWith({ name: 'A', apiKey: 'sk-first' }));
    const second = createProfile(db, secret, inputWith({ name: 'B', apiKey: 'sk-second' }));

    const configs = listProfileConfigs(db, secret);

    expect(configs.map((entry) => entry.id)).toEqual([first.id, second.id]);
    expect(configs.map((entry) => entry.config.apiKey)).toEqual(['sk-first', 'sk-second']);
    expect(configs[0].config.baseUrl).toBe('https://api.example.com/v1');
  });
});
