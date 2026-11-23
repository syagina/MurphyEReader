import type Database from 'better-sqlite3';
import type { AiConfig } from '../ai/client';
import type { AiProfile, AiProfileInput, AiSettings } from '@shared/types';
import type { SecretStore } from './secret-store';

export const ACTIVE_PROFILE_KEY = 'ai.activeProfileId';
export const PROFILE_NAME_MAX_LENGTH = 60;

const DEFAULT_TEMPERATURE = 0.3;
const DEFAULT_TOKEN_BUDGET = 100000;

const PROFILE_COLUMNS = `id, name, base_url, chat_model, vision_model, temperature,
  token_budget, api_key, sort_order, created_at`;

interface ProfileRow {
  id: number;
  name: string;
  base_url: string;
  chat_model: string;
  vision_model: string;
  temperature: number;
  token_budget: number;
  api_key: string;
  sort_order: number;
  created_at: number;
}

interface NormalizedProfileInput {
  name: string;
  baseUrl: string;
  chatModel: string;
  visionModel: string;
  temperature: number;
  tokenBudget: number;
  apiKey: string | undefined;
}

function readActiveProfileId(db: Database.Database): number | null {
  const row = db
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get(ACTIVE_PROFILE_KEY) as { value: string } | undefined;
  if (row === undefined || row.value === '') {
    return null;
  }
  const id = Number(row.value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function readRow(db: Database.Database, id: number): ProfileRow | null {
  const row = db
    .prepare(`SELECT ${PROFILE_COLUMNS} FROM ai_profiles WHERE id = ?`)
    .get(id) as ProfileRow | undefined;
  return row ?? null;
}

function readActiveRow(db: Database.Database): ProfileRow | null {
  const id = readActiveProfileId(db);
  return id === null ? null : readRow(db, id);
}

function toProfile(row: ProfileRow, activeId: number | null): AiProfile {
  return {
    id: row.id,
    name: row.name,
    baseUrl: row.base_url,
    chatModel: row.chat_model,
    visionModel: row.vision_model,
    temperature: row.temperature,
    tokenBudget: row.token_budget,
    apiKeySet: row.api_key !== '',
    active: row.id === activeId,
    createdAt: row.created_at,
  };
}

function setActiveProfileId(db: Database.Database, id: number | null): void {
  if (id === null) {
    db.prepare('DELETE FROM settings WHERE key = ?').run(ACTIVE_PROFILE_KEY);
    return;
  }
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(ACTIVE_PROFILE_KEY, String(id));
}

function normalizeInput(input: AiProfileInput): NormalizedProfileInput {
  const name = input.name.trim();
  if (name === '') {
    throw new Error('配置名称不能为空');
  }
  if (name.length > PROFILE_NAME_MAX_LENGTH) {
    throw new Error(`配置名称不能超过 ${PROFILE_NAME_MAX_LENGTH} 个字符`);
  }
  return {
    name,
    baseUrl: input.baseUrl.trim(),
    chatModel: input.chatModel.trim(),
    visionModel: input.visionModel.trim(),
    temperature: Number.isFinite(input.temperature)
      ? input.temperature
      : DEFAULT_TEMPERATURE,
    tokenBudget: Number.isFinite(input.tokenBudget)
      ? input.tokenBudget
      : DEFAULT_TOKEN_BUDGET,
    apiKey: input.apiKey,
  };
}

function encryptKey(secret: SecretStore, apiKey: string): string {
  return apiKey === '' ? '' : secret.encrypt(apiKey);
}

export function listProfiles(db: Database.Database): AiProfile[] {
  const rows = db
    .prepare(`SELECT ${PROFILE_COLUMNS} FROM ai_profiles ORDER BY sort_order, id`)
    .all() as ProfileRow[];
  const activeId = readActiveProfileId(db);
  return rows.map((row) => toProfile(row, activeId));
}

export function createProfile(
  db: Database.Database,
  secret: SecretStore,
  input: AiProfileInput,
): AiProfile {
  const values = normalizeInput(input);
  return db.transaction(() => {
    const nextSort = db
      .prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS value FROM ai_profiles')
      .get() as { value: number };
    const inserted = db
      .prepare(
        `INSERT INTO ai_profiles
          (name, base_url, chat_model, vision_model, temperature, token_budget, api_key, sort_order, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        values.name,
        values.baseUrl,
        values.chatModel,
        values.visionModel,
        values.temperature,
        values.tokenBudget,
        values.apiKey === undefined ? '' : encryptKey(secret, values.apiKey),
        nextSort.value,
        Date.now(),
      );
    const row = readRow(db, Number(inserted.lastInsertRowid));
    if (row === null) {
      throw new Error('配置创建失败');
    }
    // The first saved profile becomes active so a fresh install is usable
    // without a second click.
    if (readActiveProfileId(db) === null) {
      setActiveProfileId(db, row.id);
    }
    return toProfile(row, readActiveProfileId(db));
  })();
}

export function updateProfile(
  db: Database.Database,
  secret: SecretStore,
  id: number,
  input: AiProfileInput,
): AiProfile {
  const values = normalizeInput(input);
  return db.transaction(() => {
    const existing = readRow(db, id);
    if (existing === null) {
      throw new Error('配置不存在');
    }
    const apiKey =
      values.apiKey === undefined
        ? existing.api_key
        : encryptKey(secret, values.apiKey);
    db.prepare(
      `UPDATE ai_profiles
          SET name = ?, base_url = ?, chat_model = ?, vision_model = ?,
              temperature = ?, token_budget = ?, api_key = ?
        WHERE id = ?`,
    ).run(
      values.name,
      values.baseUrl,
      values.chatModel,
      values.visionModel,
      values.temperature,
      values.tokenBudget,
      apiKey,
      id,
    );
    const row = readRow(db, id);
    if (row === null) {
      throw new Error('配置不存在');
    }
    return toProfile(row, readActiveProfileId(db));
  })();
}

export function deleteProfile(db: Database.Database, id: number): void {
  db.transaction(() => {
    if (readRow(db, id) === null) {
      throw new Error('配置不存在');
    }
    db.prepare('DELETE FROM ai_profiles WHERE id = ?').run(id);
    if (readActiveProfileId(db) !== id) {
      return;
    }
    const next = db
      .prepare('SELECT id FROM ai_profiles ORDER BY sort_order, id LIMIT 1')
      .get() as { id: number } | undefined;
    setActiveProfileId(db, next?.id ?? null);
  })();
}

export function activateProfile(db: Database.Database, id: number): void {
  if (readRow(db, id) === null) {
    throw new Error('配置不存在');
  }
  setActiveProfileId(db, id);
}

export function getProfileApiKey(
  db: Database.Database,
  secret: SecretStore,
  id: number,
): string {
  const row = readRow(db, id);
  if (row === null || row.api_key === '') {
    return '';
  }
  return secret.decrypt(row.api_key);
}

/** Decrypted configs for speed testing; main-process only. */
export function listProfileConfigs(
  db: Database.Database,
  secret: SecretStore,
): Array<{ id: number; config: AiConfig }> {
  const rows = db
    .prepare(`SELECT ${PROFILE_COLUMNS} FROM ai_profiles ORDER BY sort_order, id`)
    .all() as ProfileRow[];
  return rows.map((row) => ({
    id: row.id,
    config: {
      baseUrl: row.base_url,
      apiKey: row.api_key === '' ? '' : secret.decrypt(row.api_key),
      chatModel: row.chat_model,
      visionModel: row.vision_model,
      temperature: row.temperature,
    },
  }));
}

export function getActiveSettings(
  db: Database.Database,
  _secret: SecretStore,
): AiSettings {
  const row = readActiveRow(db);
  if (row === null) {
    return {
      baseUrl: '',
      chatModel: '',
      visionModel: '',
      temperature: DEFAULT_TEMPERATURE,
      tokenBudget: DEFAULT_TOKEN_BUDGET,
      apiKeySet: false,
    };
  }
  return {
    baseUrl: row.base_url,
    chatModel: row.chat_model,
    visionModel: row.vision_model,
    temperature: row.temperature,
    tokenBudget: row.token_budget,
    apiKeySet: row.api_key !== '',
  };
}

export function getActiveApiKey(db: Database.Database, secret: SecretStore): string {
  const row = readActiveRow(db);
  if (row === null || row.api_key === '') {
    return '';
  }
  return secret.decrypt(row.api_key);
}
