import { existsSync } from 'node:fs';
import { copyFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import type { Paper } from '@shared/types';
import { updatePaper } from '../db/papers';
import { sha256File } from './hash';
import {
  CUSTOM_TRANSLATED_NAME,
  ORIGINAL_PDF_NAME,
  canonicalStorageDir,
  samePath,
} from './paths';

export interface AdoptUnmanagedOptions {
  /** Precomputed SHA-256; when supplied the file is not hashed again. */
  hash?: string;
}

const ALREADY_MANAGED_MESSAGE = '文献已托管，无需整理';
const ORIGINAL_MISSING_MESSAGE = '原文文件不存在';
const TRANSLATION_MISSING_MESSAGE = '译本文件缺失';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isBoundTranslation(paper: Paper): paper is Paper & { filePathTranslated: string } {
  return paper.filePathTranslated !== null && paper.filePathTranslated !== '';
}

async function hashOrNull(filePath: string): Promise<string | null> {
  try {
    return await sha256File(filePath);
  } catch {
    return null;
  }
}

/**
 * Moves a legacy, explicitly unmanaged paper under the managed library layout
 * by copying (never moving) its files into `papers/<safeTitle> (<id>)/`.
 *
 * Callers must already hold the storage lease (or deliberately manage
 * concurrency themselves); this function never acquires one. The DB row stays
 * unmanaged when any precondition fails, so a later call can retry.
 */
export async function adoptUnmanagedPaper(
  db: Database.Database,
  root: string,
  paper: Paper,
  options: AdoptUnmanagedOptions = {},
): Promise<Paper> {
  if (paper.storageDir !== null) {
    throw new Error(ALREADY_MANAGED_MESSAGE);
  }
  if (paper.filePathOriginal === '' || !existsSync(paper.filePathOriginal)) {
    throw new Error(ORIGINAL_MISSING_MESSAGE);
  }
  const translationBound = isBoundTranslation(paper);
  if (translationBound && !existsSync(paper.filePathTranslated)) {
    throw new Error(TRANSLATION_MISSING_MESSAGE);
  }

  const storageDir = canonicalStorageDir(paper.id, paper.title);
  const folder = join(root, storageDir);
  const originalTarget = join(folder, ORIGINAL_PDF_NAME);

  let hash: string | null;
  if (options.hash !== undefined) {
    hash = options.hash;
  } else {
    hash = await hashOrNull(paper.filePathOriginal);
  }

  try {
    await mkdir(join(folder, 'notes'), { recursive: true });
  } catch (error) {
    throw new Error(`无法整理文献文件：${errorMessage(error)}`);
  }

  if (!samePath(paper.filePathOriginal, originalTarget)) {
    try {
      await copyFile(paper.filePathOriginal, originalTarget);
    } catch (error) {
      throw new Error(`无法整理文献文件：${errorMessage(error)}`);
    }
  }

  let filePathTranslated = paper.filePathTranslated;
  if (translationBound) {
    const translationTarget = join(folder, CUSTOM_TRANSLATED_NAME);
    if (!samePath(paper.filePathTranslated, translationTarget)) {
      try {
        await copyFile(paper.filePathTranslated, translationTarget);
      } catch (error) {
        throw new Error(`无法整理文献文件：${errorMessage(error)}`);
      }
    }
    filePathTranslated = translationTarget;
  }

  return updatePaper(db, paper.id, {
    storageDir,
    filePathOriginal: originalTarget,
    filePathTranslated,
    fileHash: hash,
  });
}
