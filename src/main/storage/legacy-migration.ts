import type Database from 'better-sqlite3';
import type { LegacyMigrationSummary } from '@shared/types';
import { listPapers } from '../db/papers';
import type { JobRegistry } from '../jobs/job-registry';
import { adoptUnmanagedPaper } from './adopt';
import { ensureLibraryLayout } from './paths';

export type StorageEventEmitter = (channel: string, payload: unknown) => void;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Adopts every legacy paper (`storage_dir IS NULL`) into the managed library
 * layout under `root`. Missing originals and per-paper adoption failures are
 * recorded as skipped items and never abort the pass. The migration is
 * idempotent because adopted rows no longer match the unmanaged set.
 *
 * Callers do not need to hold the storage lease; this function acquires the
 * `'migrateLegacy'` marker itself and always releases it, so a concurrent
 * migration fails with the standard busy error.
 */
export async function migrateLegacyPapers(
  db: Database.Database,
  jobs: JobRegistry,
  root: string,
  emit: StorageEventEmitter,
): Promise<LegacyMigrationSummary> {
  jobs.tryAcquireStorage('migrateLegacy');

  const summary: LegacyMigrationSummary = { adopted: 0, skipped: [] };
  try {
    try {
      await ensureLibraryLayout(root);
    } catch (error) {
      throw new Error(`文献库目录不可写：${errorMessage(error)}`);
    }

    const unmanaged = listPapers(db).filter((paper) => paper.storageDir === null);
    for (const paper of unmanaged) {
      try {
        await adoptUnmanagedPaper(db, root, paper);
        summary.adopted += 1;
      } catch (error) {
        summary.skipped.push({
          paperId: paper.id,
          title: paper.title,
          reason: errorMessage(error),
        });
      }
    }
  } finally {
    jobs.releaseStorage();
  }

  // Emitted after the lease is released so a listener may start its own
  // storage task without racing the finished migration.
  emit('storage:migrated', summary);
  return summary;
}
