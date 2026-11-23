import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '@main/db';
import {
  MIGRATION_V1,
  MIGRATION_V2,
  MIGRATION_V3,
  MIGRATION_V4,
  MIGRATION_V5,
} from '@main/db/schema';

let tempDir: string;
let dbPath: string;

/** Builds a v5 database without opening it through `openDb`. */
function seedV5(settings: Array<[string, string]>): void {
  const db = new Database(dbPath);
  db.exec(MIGRATION_V1);
  db.exec(MIGRATION_V2);
  db.pragma('user_version = 2');
  db.exec(MIGRATION_V3);
  db.pragma('user_version = 3');
  db.exec(MIGRATION_V4);
  db.pragma('user_version = 4');
  db.exec(MIGRATION_V5);
  db.pragma('user_version = 5');
  const insert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
  for (const [key, value] of settings) {
    insert.run(key, value);
  }
  db.close();
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'paperlens-v6-'));
  dbPath = join(tempDir, 'paperlens.db');
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe('schema v6 旧 AI 配置迁移', () => {
  it('把旧的单套配置迁成「默认配置」并设为当前，随后删除旧键', () => {
    seedV5([
      ['ai.baseUrl', 'https://old.example.com/v1'],
      ['ai.chatModel', 'old-model'],
      ['ai.visionModel', 'old-vision'],
      ['ai.temperature', '0.7'],
      ['ai.tokenBudget', '42000'],
      ['ai.apiKey', 'ciphertext-from-safe-storage'],
    ]);

    const db = openDb(dbPath);
    try {
      const profile = db
        .prepare('SELECT * FROM ai_profiles')
        .get() as Record<string, unknown>;
      expect(profile).toMatchObject({
        name: '默认配置',
        base_url: 'https://old.example.com/v1',
        chat_model: 'old-model',
        vision_model: 'old-vision',
        temperature: 0.7,
        token_budget: 42000,
        api_key: 'ciphertext-from-safe-storage',
        sort_order: 0,
      });

      const active = db
        .prepare('SELECT value FROM settings WHERE key = ?')
        .get('ai.activeProfileId') as { value: string };
      expect(active.value).toBe(String(profile.id));

      const legacyRows = db
        .prepare("SELECT COUNT(*) AS count FROM settings WHERE key LIKE 'ai.%'")
        .get() as { count: number };
      expect(legacyRows.count).toBe(1);
      expect(db.pragma('user_version', { simple: true })).toBe(6);
    } finally {
      db.close();
    }
  });

  it('温度或预算不是有效数字时回退默认值', () => {
    seedV5([
      ['ai.baseUrl', 'https://old.example.com/v1'],
      ['ai.temperature', 'not-a-number'],
      ['ai.tokenBudget', 'Infinity'],
    ]);

    const db = openDb(dbPath);
    try {
      const profile = db
        .prepare('SELECT temperature, token_budget FROM ai_profiles')
        .get() as { temperature: number; token_budget: number };
      expect(profile.temperature).toBe(0.3);
      expect(profile.token_budget).toBe(100000);
    } finally {
      db.close();
    }
  });

  it('没有任何旧配置时不创建档案', () => {
    seedV5([]);

    const db = openDb(dbPath);
    try {
      const count = db
        .prepare('SELECT COUNT(*) AS count FROM ai_profiles')
        .get() as { count: number };
      expect(count.count).toBe(0);
      const active = db
        .prepare('SELECT value FROM settings WHERE key = ?')
        .get('ai.activeProfileId');
      expect(active).toBeUndefined();
    } finally {
      db.close();
    }
  });
});
