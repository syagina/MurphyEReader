import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** Folder name the app used before it was renamed to MurphyEReader. */
const LEGACY_FOLDER = 'paperlens';
const DB_FILE_NAME = 'paperlens.db';

/**
 * Returns the pre-rename data folder when it holds the only database. The
 * update then keeps using that folder instead of opening an empty library.
 */
export function legacyUserDataDir(
  userDataDir: string,
  appDataDir: string,
): string | null {
  const legacyDir = join(appDataDir, LEGACY_FOLDER);
  if (legacyDir.toLowerCase() === userDataDir.toLowerCase()) {
    return null;
  }
  if (existsSync(join(userDataDir, DB_FILE_NAME))) {
    return null;
  }
  return existsSync(join(legacyDir, DB_FILE_NAME)) ? legacyDir : null;
}
