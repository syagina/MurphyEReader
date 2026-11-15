import { existsSync } from 'node:fs';
import { cp, mkdir, unlink, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, join } from 'node:path';
import type Database from 'better-sqlite3';
import type { Paper, RootChangeResult, RootChangeUnmanagedPaper } from '@shared/types';
import { listPapers, updatePaper } from '../db/papers';
import type { JobRegistry } from '../jobs/job-registry';
import { setLibraryRootSetting } from '../settings/app-settings';
import { adoptUnmanagedPaper } from './adopt';
import {
  ORIGINAL_PDF_NAME,
  isCanonicalStorageDir,
  isPathInside,
  samePath,
  storageFile,
} from './paths';

const INVALID_NEW_ROOT_MESSAGE = '新位置无效，请选择其他文件夹';
const SAME_ROOT_MESSAGE = '新位置与当前位置相同';
const NESTED_ROOT_MESSAGE = '新位置不能位于当前文献库内部，也不能包含当前文献库';
const UNWRITABLE_ROOT_MESSAGE = '新位置不可写，请选择其他文件夹';
const INVALID_STORAGE_DIR_MESSAGE = '文献文件夹路径异常，已中止迁移';
const MISSING_SOURCE_FOLDER_MESSAGE = '文献文件夹不存在，已中止迁移';
const DESTINATION_EXISTS_MESSAGE = '目标位置已存在同名文献文件夹，已中止迁移';
const COPY_FAILED_PREFIX = '复制文献文件夹失败：';
const WRITE_TEST_NAME = '.paperlens-write-test';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function hasCode(error: unknown, code: string): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return false;
  }
  return (error as { code?: unknown }).code === code;
}

/**
 * Creates the new library layout and proves it is writable with a short-lived
 * probe file. Any failure here rejects the change before adoption or copying.
 */
async function prepareNewRoot(newRoot: string): Promise<void> {
  const probe = join(newRoot, WRITE_TEST_NAME);
  try {
    await mkdir(join(newRoot, 'papers'), { recursive: true });
    await mkdir(join(newRoot, 'exports'), { recursive: true });
    await writeFile(probe, 'paperlens', 'utf8');
  } catch {
    await unlink(probe).catch(() => undefined);
    throw new Error(UNWRITABLE_ROOT_MESSAGE);
  }
  await unlink(probe).catch(() => undefined);
}

/**
 * Creates the destination folder non-recursively so an existing folder aborts
 * the change instead of being merged, then copies the source folder's contents
 * into it. The empty destination mirrors the source layout exactly.
 */
async function copyManagedFolder(source: string, target: string): Promise<void> {
  try {
    await mkdir(target);
  } catch (error) {
    if (hasCode(error, 'EEXIST')) {
      throw new Error(DESTINATION_EXISTS_MESSAGE);
    }
    throw new Error(`${COPY_FAILED_PREFIX}${errorMessage(error)}`);
  }
  try {
    await cp(source, target, { recursive: true });
  } catch (error) {
    throw new Error(`${COPY_FAILED_PREFIX}${errorMessage(error)}`);
  }
}

/**
 * Copies every managed paper folder to the new library root and only then, in
 * one transaction, rewrites the absolute paths and the stored root setting.
 * The old root is never modified or deleted. Unmanaged papers that cannot be
 * adopted are reported instead of being silently dropped.
 */
export async function changeLibraryRoot(
  db: Database.Database,
  jobs: JobRegistry,
  oldRoot: string,
  newRoot: string,
): Promise<RootChangeResult> {
  jobs.tryAcquireChangeRoot();
  try {
    const targetRoot = typeof newRoot === 'string' ? newRoot.trim() : '';
    if (targetRoot === '' || !isAbsolute(targetRoot)) {
      throw new Error(INVALID_NEW_ROOT_MESSAGE);
    }
    if (samePath(oldRoot, targetRoot)) {
      throw new Error(SAME_ROOT_MESSAGE);
    }
    if (isPathInside(oldRoot, targetRoot) || isPathInside(targetRoot, oldRoot)) {
      throw new Error(NESTED_ROOT_MESSAGE);
    }

    await prepareNewRoot(targetRoot);

    const unmanaged: RootChangeUnmanagedPaper[] = [];
    for (const paper of listPapers(db)) {
      if (paper.storageDir !== null) {
        continue;
      }
      try {
        await adoptUnmanagedPaper(db, oldRoot, paper);
      } catch {
        // Missing originals and other adoption failures stay where they are
        // and are reported as unmanaged instead of aborting the whole change.
        unmanaged.push({ paperId: paper.id, title: paper.title });
      }
    }

    // Adoption may have managed rows since the first read; re-query so those
    // newly adopted papers join the migration set.
    const managed = listPapers(db).filter(
      (paper): paper is Paper & { storageDir: string } => paper.storageDir !== null,
    );

    const copies: Array<{ paper: Paper; storageDir: string }> = [];
    for (const paper of managed) {
      const storageDir = paper.storageDir;
      if (!isCanonicalStorageDir(storageDir, paper.id)) {
        throw new Error(INVALID_STORAGE_DIR_MESSAGE);
      }
      const source = join(oldRoot, storageDir);
      if (!existsSync(source)) {
        throw new Error(MISSING_SOURCE_FOLDER_MESSAGE);
      }
      await copyManagedFolder(source, join(targetRoot, storageDir));
      copies.push({ paper, storageDir });
    }

    // Every copy succeeded: one transaction switches every path and the root
    // setting together. A failure rolls all of it back to the old root.
    db.transaction(() => {
      for (const { paper, storageDir } of copies) {
        updatePaper(db, paper.id, {
          filePathOriginal: storageFile(targetRoot, storageDir, ORIGINAL_PDF_NAME),
          filePathTranslated: migratedTranslationPath(
            paper.filePathTranslated,
            oldRoot,
            targetRoot,
            storageDir,
          ),
        });
      }
      setLibraryRootSetting(db, targetRoot);
    })();

    return {
      root: targetRoot,
      migrated: copies.length,
      unmanaged,
      keptOldCopies: true,
    };
  } finally {
    jobs.releaseStorage();
  }
}

/**
 * Rebinds a translation only when the old absolute path pointed inside the
 * paper's managed folder. A translation that still lives outside the library
 * is the user's external file and keeps its absolute path.
 */
function migratedTranslationPath(
  filePathTranslated: string | null,
  oldRoot: string,
  newRoot: string,
  storageDir: string,
): string | null {
  if (filePathTranslated === null || filePathTranslated === '') {
    return filePathTranslated;
  }
  if (!isPathInside(join(oldRoot, storageDir), filePathTranslated)) {
    return filePathTranslated;
  }
  return join(newRoot, storageDir, basename(filePathTranslated));
}
