import { readdir } from 'node:fs/promises';
import { extname, join } from 'node:path';
import type { FolderImportSummary, ImportPaperResult, ImportProgressEvent } from '@shared/types';
import { isPathInside, samePath } from './paths';

/** Progress payload produced by the pure batch runner; the service adds `jobId`. */
export type FolderImportProgress = Omit<ImportProgressEvent, 'jobId'>;

export interface FolderImportOptions {
  isCanceled(): boolean;
  onProgress(event: FolderImportProgress): void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Recursively lists PDF files below `folder` in a deterministic order.
 * Symlinks and junctions are never followed, and nothing inside `libraryRoot`
 * is returned, so the managed library can never re-import itself.
 */
export async function collectPdfFiles(
  folder: string,
  libraryRoot: string,
): Promise<string[]> {
  const files: string[] = [];

  const visit = async (dir: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      throw new Error(`无法读取文件夹：${errorMessage(error)}`);
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        continue;
      }
      if (entry.isDirectory()) {
        if (samePath(libraryRoot, fullPath) || isPathInside(libraryRoot, fullPath)) {
          continue;
        }
        await visit(fullPath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      if (extname(entry.name).toLowerCase() !== '.pdf') {
        continue;
      }
      if (isPathInside(libraryRoot, fullPath)) {
        continue;
      }
      files.push(fullPath);
    }
  };

  await visit(folder);
  return files.sort();
}

/**
 * Imports the collected files sequentially. The current file always finishes;
 * cancellation prevents later files from starting and never deletes results
 * from files that were already imported. Duplicates count as skipped, and a
 * per-file failure is recorded without aborting the rest of the batch.
 */
export async function runFolderImport(
  files: string[],
  importOne: (file: string) => Promise<ImportPaperResult>,
  options: FolderImportOptions,
): Promise<FolderImportSummary> {
  const summary: FolderImportSummary = {
    imported: 0,
    skipped: 0,
    failed: [],
    canceled: false,
  };
  const total = files.length;

  options.onProgress({ phase: 'scan', current: 0, total, file: '' });

  for (let index = 0; index < files.length; index += 1) {
    if (options.isCanceled()) {
      summary.canceled = true;
      break;
    }
    const file = files[index]!;
    options.onProgress({ phase: 'copy', current: index + 1, total, file });
    try {
      const result = await importOne(file);
      if (result.duplicate) {
        summary.skipped += 1;
      } else {
        summary.imported += 1;
      }
    } catch (error) {
      summary.failed.push({ file, message: errorMessage(error) });
    }
  }

  options.onProgress({ phase: 'done', current: total, total, file: '' });
  return summary;
}
