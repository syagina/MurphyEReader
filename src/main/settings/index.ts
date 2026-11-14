import type Database from 'better-sqlite3';
import type { AiSettings, AiSettingsInput } from '@shared/types';
import type { SecretStore } from './secret-store';

export interface SettingsKeys {
  baseUrl: string;
  chatModel: string;
  visionModel: string;
  temperature: string;
  tokenBudget: string;
  apiKey: string;
}

export const SETTINGS_KEYS: SettingsKeys = {
  baseUrl: 'ai.baseUrl',
  chatModel: 'ai.chatModel',
  visionModel: 'ai.visionModel',
  temperature: 'ai.temperature',
  tokenBudget: 'ai.tokenBudget',
  apiKey: 'ai.apiKey',
};

const DEFAULT_TEMPERATURE = 0.3;
const DEFAULT_TOKEN_BUDGET = 100000;

const UPSERT_SQL = `INSERT INTO settings (key, value) VALUES (?, ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value`;

interface SettingsRow {
  key: string;
  value: string;
}

function readAll(db: Database.Database): Map<string, string> {
  const rows = db.prepare('SELECT key, value FROM settings').all() as SettingsRow[];
  return new Map(rows.map((row) => [row.key, row.value]));
}

function readString(rows: Map<string, string>, key: string, fallback: string): string {
  return rows.get(key) ?? fallback;
}

function readNumber(rows: Map<string, string>, key: string, fallback: number): number {
  const raw = rows.get(key);
  if (raw === undefined) {
    return fallback;
  }
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

/**
 * `_secret` stays in the signature for a uniform store interface; the settings
 * view never decrypts the key, it only reports whether one is stored.
 */
export function getSettings(db: Database.Database, _secret: SecretStore): AiSettings {
  const rows = readAll(db);
  return {
    baseUrl: readString(rows, SETTINGS_KEYS.baseUrl, ''),
    chatModel: readString(rows, SETTINGS_KEYS.chatModel, ''),
    visionModel: readString(rows, SETTINGS_KEYS.visionModel, ''),
    temperature: readNumber(rows, SETTINGS_KEYS.temperature, DEFAULT_TEMPERATURE),
    tokenBudget: readNumber(rows, SETTINGS_KEYS.tokenBudget, DEFAULT_TOKEN_BUDGET),
    apiKeySet: (rows.get(SETTINGS_KEYS.apiKey) ?? '') !== '',
  };
}

export function setSettings(
  db: Database.Database,
  secret: SecretStore,
  input: AiSettingsInput,
): AiSettings {
  const upsert = db.prepare(UPSERT_SQL);
  const clearApiKey = db.prepare('DELETE FROM settings WHERE key = ?');

  db.transaction(() => {
    upsert.run(SETTINGS_KEYS.baseUrl, input.baseUrl);
    upsert.run(SETTINGS_KEYS.chatModel, input.chatModel);
    upsert.run(SETTINGS_KEYS.visionModel, input.visionModel);
    upsert.run(SETTINGS_KEYS.temperature, String(input.temperature));
    upsert.run(SETTINGS_KEYS.tokenBudget, String(input.tokenBudget));
    if (input.apiKey === '') {
      clearApiKey.run(SETTINGS_KEYS.apiKey);
    } else if (input.apiKey !== undefined) {
      upsert.run(SETTINGS_KEYS.apiKey, secret.encrypt(input.apiKey));
    }
  })();

  return getSettings(db, secret);
}

export function getApiKey(db: Database.Database, secret: SecretStore): string {
  const row = db
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get(SETTINGS_KEYS.apiKey) as { value: string } | undefined;
  if (row === undefined || row.value === '') {
    return '';
  }
  return secret.decrypt(row.value);
}
