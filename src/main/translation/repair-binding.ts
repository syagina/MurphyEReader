import { statSync } from 'node:fs';
import type Database from 'better-sqlite3';
import { getPages } from '../db/pages';
import { getPaper, updatePaper } from '../db/papers';
import { extractPdf } from '../pdf/extract';
import {
  BABELDOC_DUAL_NAME,
  BABELDOC_MONO_NAME,
  samePath,
  storageFile,
} from '../storage/paths';
import { findIncompletePages } from './completeness';

interface FileStamp {
  path: string;
  mtimeMs: number;
  size: number;
}

/**
 * One evaluation per unchanged pair of output files. A repaired binding points
 * at the dual afterwards, so later loads never reach the cache again; failed
 * checks stay cached until either file changes (e.g. a new translation).
 */
const repairChecks = new Map<string, Promise<boolean>>();

function stamp(filePath: string): FileStamp | null {
  try {
    const stats = statSync(filePath);
    if (!stats.isFile()) {
      return null;
    }
    return { path: filePath, mtimeMs: stats.mtimeMs, size: stats.size };
  } catch {
    return null;
  }
}

function cacheKey(paperId: number, mono: FileStamp, dual: FileStamp): string {
  return [
    paperId,
    mono.path,
    mono.mtimeMs,
    mono.size,
    dual.path,
    dual.mtimeMs,
    dual.size,
  ].join('|');
}

async function evaluate(
  db: Database.Database,
  paperId: number,
  monoPath: string,
  dualPath: string,
): Promise<boolean> {
  try {
    const storedPages = getPages(db, paperId);
    if (storedPages.length === 0) {
      return false;
    }
    const mono = await extractPdf(monoPath);
    if (findIncompletePages(storedPages, mono.pages).length === 0) {
      return false;
    }
    // The dual keeps the original text next to the translation, so a complete
    // translated page proves the content is reachable without translating
    // anything again (no API cost).
    const dual = await extractPdf(dualPath);
    if (findIncompletePages(storedPages, dual.pages).length > 0) {
      return false;
    }
    updatePaper(db, paperId, {
      filePathTranslated: dualPath,
      pageCountTranslated: dual.pageCount,
    });
    return true;
  } catch {
    // Repair is best effort: an unreadable or malformed output must never
    // block opening the reader. The previous binding stays untouched.
    return false;
  }
}

/**
 * Repairs a managed BabelDOC mono binding whose output lost page content.
 *
 * Only the app's own `translated.zh-CN.mono.pdf` binding inside the paper's
 * canonical folder is considered; a user-attached translation is never
 * switched. When the sibling `translated.zh-CN.dual.pdf` exists and retains
 * every original page, the paper row is rebound to it.
 */
export function repairManagedTranslation(
  db: Database.Database,
  paperId: number,
  root: string,
): Promise<boolean> {
  const paper = getPaper(db, paperId);
  if (paper === null || paper.storageDir === null || paper.filePathTranslated === null) {
    return Promise.resolve(false);
  }

  let monoPath: string;
  let dualPath: string;
  try {
    monoPath = storageFile(root, paper.storageDir, BABELDOC_MONO_NAME);
    dualPath = storageFile(root, paper.storageDir, BABELDOC_DUAL_NAME);
  } catch {
    return Promise.resolve(false);
  }
  if (!samePath(paper.filePathTranslated, monoPath)) {
    return Promise.resolve(false);
  }

  const monoStamp = stamp(monoPath);
  const dualStamp = stamp(dualPath);
  if (monoStamp === null || dualStamp === null) {
    return Promise.resolve(false);
  }

  const key = cacheKey(paperId, monoStamp, dualStamp);
  const cached = repairChecks.get(key);
  if (cached !== undefined) {
    return cached;
  }
  const check = evaluate(db, paperId, monoPath, dualPath);
  repairChecks.set(key, check);
  return check;
}
