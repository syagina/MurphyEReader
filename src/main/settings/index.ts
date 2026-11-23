import type Database from 'better-sqlite3';
import type { AiSettings } from '@shared/types';
import { getActiveApiKey, getActiveSettings } from './ai-profiles';
import type { SecretStore } from './secret-store';

/**
 * Compatibility view over the active AI profile. The rest of the main process
 * keeps calling these two functions, so switching profiles applies to the next
 * request without touching chat/translation services.
 */
export function getSettings(db: Database.Database, secret: SecretStore): AiSettings {
  return getActiveSettings(db, secret);
}

export function getApiKey(db: Database.Database, secret: SecretStore): string {
  return getActiveApiKey(db, secret);
}
