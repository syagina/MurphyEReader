import { join } from 'node:path';
import type Database from 'better-sqlite3';
import {
  AI_PANEL_DEFAULT_WIDTH,
  AI_PANEL_MAX_WIDTH,
  AI_PANEL_MIN_WIDTH,
} from '@shared/ai-panel';
import type { AppSettingsUpdate } from '@shared/types';

export interface StoredAppSettings {
  libraryRoot: string;
  defaultLibraryRoot: string;
  babeldocPath: string;
  aiPanelWidth: number;
}

export const APP_SETTINGS_KEYS = {
  libraryRoot: 'storage.libraryRoot',
  babeldocPath: 'translation.babeldocPath',
  aiPanelWidth: 'ui.aiPanelWidth',
} as const;

const UPSERT_SQL = `INSERT INTO settings (key, value) VALUES (?, ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value`;

const DELETE_SQL = 'DELETE FROM settings WHERE key = ?';

interface SettingsRow {
  key: string;
  value: string;
}

function readAll(db: Database.Database): Map<string, string> {
  const rows = db.prepare('SELECT key, value FROM settings').all() as SettingsRow[];
  return new Map(rows.map((row) => [row.key, row.value]));
}

export function defaultLibraryRoot(documentsDir: string): string {
  return join(documentsDir, 'PaperLens');
}

export function normalizePanelWidth(value: number): number {
  const finite = Number.isFinite(value) ? value : AI_PANEL_DEFAULT_WIDTH;
  return Math.round(
    Math.min(AI_PANEL_MAX_WIDTH, Math.max(AI_PANEL_MIN_WIDTH, finite)),
  );
}

export function getStoredAppSettings(
  db: Database.Database,
  documentsDir: string,
): StoredAppSettings {
  const rows = readAll(db);
  const fallbackRoot = defaultLibraryRoot(documentsDir);
  const storedRoot = (rows.get(APP_SETTINGS_KEYS.libraryRoot) ?? '').trim();
  const storedWidth = rows.get(APP_SETTINGS_KEYS.aiPanelWidth);

  return {
    libraryRoot: storedRoot === '' ? fallbackRoot : storedRoot,
    defaultLibraryRoot: fallbackRoot,
    babeldocPath: rows.get(APP_SETTINGS_KEYS.babeldocPath) ?? '',
    aiPanelWidth:
      storedWidth === undefined
        ? AI_PANEL_DEFAULT_WIDTH
        : normalizePanelWidth(Number(storedWidth)),
  };
}

export function setStoredAppSettings(
  db: Database.Database,
  patch: AppSettingsUpdate,
): void {
  const upsert = db.prepare(UPSERT_SQL);
  const remove = db.prepare(DELETE_SQL);

  db.transaction(() => {
    if (patch.babeldocPath !== undefined) {
      const trimmed = (patch.babeldocPath ?? '').trim();
      if (trimmed === '') {
        remove.run(APP_SETTINGS_KEYS.babeldocPath);
      } else {
        upsert.run(APP_SETTINGS_KEYS.babeldocPath, trimmed);
      }
    }
    if (patch.aiPanelWidth !== undefined) {
      upsert.run(
        APP_SETTINGS_KEYS.aiPanelWidth,
        String(normalizePanelWidth(patch.aiPanelWidth)),
      );
    }
  })();
}

export function setLibraryRootSetting(db: Database.Database, root: string): void {
  db.prepare(UPSERT_SQL).run(APP_SETTINGS_KEYS.libraryRoot, root.trim());
}
