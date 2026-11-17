import { join } from 'node:path';
import type Database from 'better-sqlite3';
import {
  AI_PANEL_DEFAULT_WIDTH,
  AI_PANEL_MAX_WIDTH,
  AI_PANEL_MIN_WIDTH,
} from '@shared/ai-panel';
import {
  PAPER_TEXTURE_DEFAULT,
  normalizePaperTexture,
} from '@shared/appearance';
import {
  TRANSLATION_QPS_DEFAULT,
  TRANSLATION_WORKERS_DEFAULT,
  normalizeTranslationQps,
  normalizeTranslationWorkers,
} from '@shared/translation';
import type { AppSettingsUpdate, ThemeMode } from '@shared/types';

export interface StoredAppSettings {
  libraryRoot: string;
  defaultLibraryRoot: string;
  babeldocPath: string;
  aiPanelWidth: number;
  theme: ThemeMode;
  paperTexture: number;
  translationQps: number;
  translationWorkers: number;
  translationAutoGlossary: boolean;
  onboarded: boolean;
}

export const APP_SETTINGS_KEYS = {
  libraryRoot: 'storage.libraryRoot',
  babeldocPath: 'translation.babeldocPath',
  aiPanelWidth: 'ui.aiPanelWidth',
  theme: 'ui.theme',
  paperTexture: 'ui.paperTexture',
  translationQps: 'translation.qps',
  translationWorkers: 'translation.workers',
  translationAutoGlossary: 'translation.autoExtractGlossary',
  onboarded: 'ui.onboarded',
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
  return join(documentsDir, 'MurphyEReader');
}

/** Unknown or missing stored values fall back to the light theme. */
export function normalizeTheme(value: string | undefined): ThemeMode {
  return value === 'dark' || value === 'eye-care' || value === 'paper'
    ? value
    : 'light';
}

export function normalizePanelWidth(value: number): number {
  const finite = Number.isFinite(value) ? value : AI_PANEL_DEFAULT_WIDTH;
  return Math.round(
    Math.min(AI_PANEL_MAX_WIDTH, Math.max(AI_PANEL_MIN_WIDTH, finite)),
  );
}

/** A stored setting parses as a finite number; blank or unreadable rows do not. */
function storedNumber(value: string | undefined): number | null {
  if (value === undefined || value.trim() === '') {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function getStoredAppSettings(
  db: Database.Database,
  documentsDir: string,
): StoredAppSettings {
  const rows = readAll(db);
  const fallbackRoot = defaultLibraryRoot(documentsDir);
  const storedRoot = (rows.get(APP_SETTINGS_KEYS.libraryRoot) ?? '').trim();
  const storedWidth = rows.get(APP_SETTINGS_KEYS.aiPanelWidth);
  const storedQps = rows.get(APP_SETTINGS_KEYS.translationQps);
  const storedWorkers = rows.get(APP_SETTINGS_KEYS.translationWorkers);
  const storedTexture = rows.get(APP_SETTINGS_KEYS.paperTexture);
  const storedQpsNumber = storedNumber(storedQps);
  const storedWorkerNumber = storedNumber(storedWorkers);
  const translationQps =
    storedQpsNumber === null
      ? TRANSLATION_QPS_DEFAULT
      : normalizeTranslationQps(storedQpsNumber);
  // Older versions used QPS as the worker count. Only a readable stored QPS
  // can act as that legacy fallback; a fresh install keeps the worker default.
  const translationWorkers =
    storedWorkerNumber === null
      ? storedQpsNumber === null
        ? TRANSLATION_WORKERS_DEFAULT
        : translationQps
      : normalizeTranslationWorkers(storedWorkerNumber);

  return {
    libraryRoot: storedRoot === '' ? fallbackRoot : storedRoot,
    defaultLibraryRoot: fallbackRoot,
    babeldocPath: rows.get(APP_SETTINGS_KEYS.babeldocPath) ?? '',
    aiPanelWidth:
      storedWidth === undefined
        ? AI_PANEL_DEFAULT_WIDTH
        : normalizePanelWidth(Number(storedWidth)),
    theme: normalizeTheme(rows.get(APP_SETTINGS_KEYS.theme)),
    paperTexture:
      storedTexture === undefined
        ? PAPER_TEXTURE_DEFAULT
        : normalizePaperTexture(Number(storedTexture)),
    translationQps,
    translationWorkers,
    // Automatic term extraction stays on unless it was explicitly disabled.
    translationAutoGlossary:
      (rows.get(APP_SETTINGS_KEYS.translationAutoGlossary) ?? 'true').toLowerCase() !==
      'false',
    onboarded:
      (rows.get(APP_SETTINGS_KEYS.onboarded) ?? 'false').toLowerCase() === 'true',
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
    if (patch.theme !== undefined) {
      upsert.run(APP_SETTINGS_KEYS.theme, normalizeTheme(patch.theme));
    }
    if (patch.paperTexture !== undefined) {
      upsert.run(
        APP_SETTINGS_KEYS.paperTexture,
        String(normalizePaperTexture(patch.paperTexture)),
      );
    }
    if (patch.translationQps !== undefined) {
      upsert.run(
        APP_SETTINGS_KEYS.translationQps,
        String(normalizeTranslationQps(patch.translationQps)),
      );
    }
    if (patch.translationWorkers !== undefined) {
      upsert.run(
        APP_SETTINGS_KEYS.translationWorkers,
        String(normalizeTranslationWorkers(patch.translationWorkers)),
      );
    }
    if (patch.translationAutoGlossary !== undefined) {
      upsert.run(
        APP_SETTINGS_KEYS.translationAutoGlossary,
        patch.translationAutoGlossary ? 'true' : 'false',
      );
    }
    if (patch.onboarded !== undefined) {
      upsert.run(
        APP_SETTINGS_KEYS.onboarded,
        patch.onboarded ? 'true' : 'false',
      );
    }
  })();
}

/**
 * 老用户升级时没有 ui.onboarded 标记。已有文献说明不是首次使用，
 * 补写 true 并返回 true；空库返回 false，不写标记。
 */
export function ensureOnboardedForExistingLibrary(
  db: Database.Database,
): boolean {
  const row = db
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get(APP_SETTINGS_KEYS.onboarded) as { value: string } | undefined;
  if (row !== undefined) {
    return row.value.toLowerCase() === 'true';
  }
  const existing = db.prepare('SELECT 1 FROM papers LIMIT 1').get();
  if (existing === undefined) {
    return false;
  }
  db.prepare(UPSERT_SQL).run(APP_SETTINGS_KEYS.onboarded, 'true');
  return true;
}

export function setLibraryRootSetting(db: Database.Database, root: string): void {
  db.prepare(UPSERT_SQL).run(APP_SETTINGS_KEYS.libraryRoot, root.trim());
}
