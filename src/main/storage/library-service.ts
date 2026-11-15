import { existsSync } from 'node:fs';
import { copyFile, mkdir, rm } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import type Database from 'better-sqlite3';
import type { ImportPaperResult, Paper } from '@shared/types';
import { replacePages } from '../db/pages';
import {
  createPaper,
  deletePaper,
  findPaperByHash,
  getPaper,
  updatePaper,
} from '../db/papers';
import type { JobRegistry } from '../jobs/job-registry';
import { extractPdf, getPdfPageCount } from '../pdf/extract';
import type { ExtractedPdf } from '../pdf/extract';
import { adoptUnmanagedPaper } from './adopt';
import { sha256File } from './hash';
import {
  CUSTOM_TRANSLATED_NAME,
  ORIGINAL_PDF_NAME,
  canonicalStorageDir,
  ensureLibraryLayout,
  isCanonicalStorageDir,
  isPathInside,
  samePath,
  storageFile,
} from './paths';

export interface PaperLibraryDeps {
  db: Database.Database;
  jobs: JobRegistry;
  getRoot(): string;
  trashItem?(target: string): Promise<void>;
  copyFile?(source: string, target: string): Promise<void>;
  sha256?(path: string): Promise<string>;
}

const INVALID_MANAGED_PATH_MESSAGE = '文献文件夹路径异常，请重新定位或导入';
const INVALID_DELETE_PATH_MESSAGE = '文献文件夹路径异常，已中止删除';
const DUPLICATE_HASH_MESSAGE = '与已有文献重复';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isEnoent(error: unknown): boolean {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    if ((error as { code?: unknown }).code === 'ENOENT') {
      return true;
    }
  }
  return error instanceof Error && /ENOENT/i.test(error.message);
}

async function trashWithShell(target: string): Promise<void> {
  // Imported lazily so main-process modules stay importable under Vitest's
  // node-only Electron run mode, where only the injected implementation runs.
  const { shell } = await import('electron');
  await shell.trashItem(target);
}

/**
 * Single-file managed library operations. Every write path copies into
 * `papers/<safeTitle> (<id>)/`; source files are never moved or deleted.
 * The public mutating methods take the storage lease for their whole duration,
 * while `importPaperLocked` lets a batch caller (folder import) hold one lease
 * across many files.
 */
export class PaperLibrary {
  private readonly db: Database.Database;
  private readonly jobs: JobRegistry;
  private readonly getRoot: () => string;
  private readonly copy: (source: string, target: string) => Promise<void>;
  private readonly hash: (path: string) => Promise<string>;
  private readonly trash: (target: string) => Promise<void>;

  constructor(deps: PaperLibraryDeps) {
    this.db = deps.db;
    this.jobs = deps.jobs;
    this.getRoot = deps.getRoot;
    this.copy = deps.copyFile ?? copyFile;
    this.hash = deps.sha256 ?? sha256File;
    this.trash = deps.trashItem ?? trashWithShell;
  }

  async importPaper(sourcePath: string): Promise<ImportPaperResult> {
    this.jobs.tryAcquireStorage('import');
    try {
      return await this.importPaperLocked(sourcePath);
    } finally {
      this.jobs.releaseStorage();
    }
  }

  /**
   * Import without acquiring the storage lease. Private: folder import lives
   * on this class and calls it while holding the `'importFolder'` lease.
   */
  private async importPaperLocked(sourcePath: string): Promise<ImportPaperResult> {
    const root = this.getRoot();

    try {
      await ensureLibraryLayout(root);
    } catch (error) {
      throw new Error(`文献库目录不可写：${errorMessage(error)}`);
    }

    const hash = await this.hashOrNull(sourcePath);
    if (hash !== null) {
      const duplicate = findPaperByHash(this.db, hash);
      if (duplicate !== null) {
        return { paper: duplicate, duplicate: true };
      }
    }

    const extracted = await this.extract(sourcePath);
    const paper = createPaper(this.db, {
      title: extracted.title ?? basename(sourcePath, extname(sourcePath)),
      authors: extracted.authors,
      year: null,
      filePathOriginal: sourcePath,
      filePathTranslated: null,
      pageCountOriginal: extracted.pageCount,
      pageCountTranslated: null,
      hasTextLayer: extracted.hasTextLayer,
      outline: extracted.outline,
      folderId: null,
      storageDir: null,
      fileHash: hash,
    });

    const storageDir = canonicalStorageDir(paper.id, paper.title);
    const folder = join(root, storageDir);
    const target = join(folder, ORIGINAL_PDF_NAME);
    const folderExisted = existsSync(folder);

    try {
      try {
        await mkdir(join(folder, 'notes'), { recursive: true });
      } catch (error) {
        throw new Error(`创建文献文件夹失败：${errorMessage(error)}`);
      }

      try {
        await this.copy(sourcePath, target);
      } catch (error) {
        throw new Error(`复制文献文件失败：${errorMessage(error)}`);
      }

      const updated = updatePaper(this.db, paper.id, {
        storageDir,
        filePathOriginal: target,
        fileHash: hash,
      });
      replacePages(this.db, paper.id, extracted.pages);
      return { paper: updated, duplicate: false };
    } catch (error) {
      deletePaper(this.db, paper.id);
      if (!folderExisted) {
        await rm(folder, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }).catch(
          () => undefined,
        );
      }
      throw error;
    }
  }

  async attachTranslated(paperId: number, sourcePath: string): Promise<Paper> {
    this.jobs.assertPaperNotTranslating(paperId);
    this.jobs.tryAcquireStorage('attachTranslated', paperId);
    try {
      const paper = this.requirePaper(paperId);
      const root = this.getRoot();
      const pageCountTranslated = await this.pageCount(sourcePath);

      if (paper.storageDir !== null) {
        this.assertCanonicalStorageDir(paper);
        const target = storageFile(root, paper.storageDir, CUSTOM_TRANSLATED_NAME);
        if (!samePath(sourcePath, target)) {
          await this.copyTranslation(sourcePath, target);
        }
        return updatePaper(this.db, paperId, {
          filePathTranslated: target,
          pageCountTranslated,
        });
      }

      if (!existsSync(paper.filePathOriginal)) {
        // The original is gone: keep the selected external translation and
        // leave `storageDir` NULL so the UI can warn that the paper is unmanaged.
        return updatePaper(this.db, paperId, {
          filePathTranslated: sourcePath,
          pageCountTranslated,
        });
      }

      // The selected file replaces any previously bound translation, so a
      // missing old binding must not block adopting the paper.
      const adopted = await adoptUnmanagedPaper(this.db, root, paper, {
        ignoreMissingTranslation: true,
      });
      const target = storageFile(root, adopted.storageDir!, CUSTOM_TRANSLATED_NAME);
      if (!samePath(sourcePath, target)) {
        await this.copyTranslation(sourcePath, target);
      }
      return updatePaper(this.db, paperId, {
        filePathTranslated: target,
        pageCountTranslated,
      });
    } finally {
      this.jobs.releaseStorage();
    }
  }

  async relocate(
    paperId: number,
    version: 'original' | 'translated',
    sourcePath: string,
  ): Promise<Paper> {
    this.jobs.assertPaperNotTranslating(paperId);
    this.jobs.tryAcquireStorage('relocate', paperId);
    try {
      const paper = this.requirePaper(paperId);
      const root = this.getRoot();
      const managed = paper.storageDir !== null;
      if (managed) {
        this.assertCanonicalStorageDir(paper);
      }

      if (version === 'translated') {
        const pageCountTranslated = await this.pageCount(sourcePath);
        let filePathTranslated = sourcePath;
        if (managed) {
          const target = storageFile(root, paper.storageDir!, CUSTOM_TRANSLATED_NAME);
          if (!samePath(sourcePath, target)) {
            await this.copyTranslation(sourcePath, target);
          }
          filePathTranslated = target;
        }
        return updatePaper(this.db, paperId, {
          filePathTranslated,
          pageCountTranslated,
        });
      }

      const extracted = await this.extract(sourcePath);
      const hash = await this.hashOrNull(sourcePath);
      if (hash !== null && findPaperByHash(this.db, hash, paperId) !== null) {
        throw new Error(DUPLICATE_HASH_MESSAGE);
      }

      let filePathOriginal = sourcePath;
      if (managed) {
        const target = storageFile(root, paper.storageDir!, ORIGINAL_PDF_NAME);
        if (!samePath(sourcePath, target)) {
          await this.copyOriginal(sourcePath, target);
        }
        filePathOriginal = target;
      }

      const updated = updatePaper(this.db, paperId, {
        filePathOriginal,
        pageCountOriginal: extracted.pageCount,
        hasTextLayer: extracted.hasTextLayer,
        outline: extracted.outline,
        fileHash: hash,
        lastPageOriginal: Math.min(paper.lastPageOriginal, extracted.pageCount),
      });
      replacePages(this.db, paperId, extracted.pages);
      return updated;
    } finally {
      this.jobs.releaseStorage();
    }
  }

  async removePaper(paperId: number): Promise<void> {
    this.jobs.assertPaperNotTranslating(paperId);
    this.jobs.tryAcquireStorage('remove', paperId);
    try {
      const paper = getPaper(this.db, paperId);
      if (paper === null) {
        return;
      }

      if (paper.storageDir !== null) {
        const root = this.getRoot();
        const target = join(root, paper.storageDir);
        if (
          !isCanonicalStorageDir(paper.storageDir, paper.id) ||
          !isPathInside(root, target)
        ) {
          throw new Error(INVALID_DELETE_PATH_MESSAGE);
        }

        try {
          await this.trash(target);
        } catch (error) {
          if (!isEnoent(error)) {
            throw new Error(`无法移入回收站：${errorMessage(error)}`);
          }
        }
      }

      deletePaper(this.db, paperId);
    } finally {
      this.jobs.releaseStorage();
    }
  }

  /**
   * Guarantees a managed, canonical folder for the paper. Only this service's
   * own re-entrant `ensureManaged` marker means the call is already nested
   * inside the adoption lease; every other held storage marker must stay
   * mutually exclusive and surface the standard busy error.
   */
  async ensureManaged(paperId: number): Promise<Paper> {
    const paper = this.requirePaper(paperId);
    if (paper.storageDir !== null) {
      if (!isCanonicalStorageDir(paper.storageDir, paper.id)) {
        throw new Error(INVALID_MANAGED_PATH_MESSAGE);
      }
      return paper;
    }

    if (this.jobs.getState().storageTask === 'ensureManaged') {
      return await adoptUnmanagedPaper(this.db, this.getRoot(), paper);
    }

    this.jobs.tryAcquireStorage('ensureManaged');
    try {
      return await adoptUnmanagedPaper(this.db, this.getRoot(), paper);
    } finally {
      this.jobs.releaseStorage();
    }
  }

  private requirePaper(paperId: number): Paper {
    const paper = getPaper(this.db, paperId);
    if (paper === null) {
      throw new Error(`文献不存在: ${paperId}`);
    }
    return paper;
  }

  private assertCanonicalStorageDir(paper: Paper): void {
    if (paper.storageDir === null || !isCanonicalStorageDir(paper.storageDir, paper.id)) {
      throw new Error(INVALID_MANAGED_PATH_MESSAGE);
    }
  }

  private async hashOrNull(filePath: string): Promise<string | null> {
    try {
      return await this.hash(filePath);
    } catch {
      return null;
    }
  }

  private async extract(sourcePath: string): Promise<ExtractedPdf> {
    try {
      return await extractPdf(sourcePath);
    } catch (error) {
      throw new Error(`无法读取 PDF：${errorMessage(error)}`);
    }
  }

  private async pageCount(sourcePath: string): Promise<number> {
    try {
      return await getPdfPageCount(sourcePath);
    } catch (error) {
      throw new Error(`无法读取 PDF：${errorMessage(error)}`);
    }
  }

  private async copyOriginal(sourcePath: string, target: string): Promise<void> {
    try {
      await this.copy(sourcePath, target);
    } catch (error) {
      throw new Error(`复制文献文件失败：${errorMessage(error)}`);
    }
  }

  private async copyTranslation(sourcePath: string, target: string): Promise<void> {
    try {
      await this.copy(sourcePath, target);
    } catch (error) {
      throw new Error(`复制译本文件失败：${errorMessage(error)}`);
    }
  }
}
