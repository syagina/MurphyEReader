import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import type Database from 'better-sqlite3';
import type { LegacyMigrationSummary, StorageInfo } from '@shared/types';
import { defaultLibraryRoot, getStoredAppSettings } from '../settings/app-settings';
import { ensureLibraryLayout } from './paths';

const UNWRITABLE_PREFIX = '文献库目录不可写：';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Read-only storage status for the library and settings pages. Resolves the
 * configured root and the default root, proves the root is writable (creating
 * `papers/` and `exports/` when possible) and reports the last migration plus
 * the last recorded storage error. Never throws: an unavailable root becomes
 * `writable: false` with a Chinese message.
 */
export async function readStorageInfo(
  db: Database.Database,
  documentsDir: string,
  migration: LegacyMigrationSummary | null,
  error: string | null,
): Promise<StorageInfo> {
  let root: string;
  let defaultRoot: string;
  try {
    const settings = getStoredAppSettings(db, documentsDir);
    root = settings.libraryRoot;
    defaultRoot = settings.defaultLibraryRoot;
  } catch (settingsError) {
    const fallback = defaultLibraryRoot(documentsDir);
    return {
      root: fallback,
      defaultRoot: fallback,
      writable: false,
      migration,
      error: `${UNWRITABLE_PREFIX}${errorMessage(settingsError)}`,
    };
  }

  try {
    await ensureLibraryLayout(root);
    await access(root, constants.W_OK);
    return { root, defaultRoot, writable: true, migration, error };
  } catch (rootError) {
    return {
      root,
      defaultRoot,
      writable: false,
      migration,
      error: `${UNWRITABLE_PREFIX}${errorMessage(rootError)}`,
    };
  }
}
