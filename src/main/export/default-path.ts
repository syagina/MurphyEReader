import { mkdir as fsMkdir } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import type { ExportScope } from '@shared/types';
import { isSafeStorageDir } from '../storage/paths';

export interface ExportDefaultPathInput {
  root: string | null;
  storageDir: string | null;
  fallbackDir: string;
  fileName: string;
  scope: ExportScope;
}

type Mkdir = (path: string, options: { recursive: true }) => Promise<unknown>;

/**
 * Picks where the save dialog starts. Single-paper exports go to the managed
 * paper's `notes/` folder only when that folder is safe and known; otherwise
 * (unmanaged paper, missing root, unsafe relative path) both scopes fall back
 * to `fallbackDir`. Library-wide exports go to `<root>/exports/`.
 */
export function resolveExportDefaultPath(input: ExportDefaultPathInput): string {
  const fileName = basename(input.fileName);
  if (input.root !== null) {
    if (input.scope === 'all') {
      return join(input.root, 'exports', fileName);
    }
    if (input.storageDir !== null && isSafeStorageDir(input.storageDir)) {
      return join(input.root, input.storageDir, 'notes', fileName);
    }
  }
  return join(input.fallbackDir, fileName);
}

/**
 * Resolves the dialog's starting path and creates its directory first. Both
 * managed and fallback targets are created recursively; a failure is reported
 * with Chinese text so the renderer can show it (Review Focus #1).
 */
export async function prepareExportDefaultPath(
  input: ExportDefaultPathInput,
  mkdir: Mkdir = fsMkdir,
): Promise<string> {
  const target = resolveExportDefaultPath(input);
  try {
    await mkdir(dirname(target), { recursive: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`无法写入文献库目录：${message}`);
  }
  return target;
}
