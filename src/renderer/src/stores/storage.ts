import { create } from 'zustand';
import type {
  FolderImportSummary,
  ImportProgressEvent,
  JobState,
  LegacyMigrationSummary,
  RootChangeResult,
  StorageInfo,
} from '@shared/types';
import { errorMessage } from '../lib/errors';
import { useAppSettingsStore } from './app-settings';
import { useLibraryStore } from './library';

export const IDLE_JOB_STATE: JobState = {
  storageTask: null,
  storagePaperId: null,
  toolTask: null,
  toolJobId: null,
  translatingPaperId: null,
};

export interface StorageState {
  info: StorageInfo | null;
  busy: JobState;
  loading: boolean;
  /** Action/reload failures, or the mirrored `info.error`; shown first. */
  error: string | null;
  /** Remembers a dismissed banner so a later info reload keeps it hidden. */
  errorDismissed: boolean;
  lastMigration: LegacyMigrationSummary | null;
  /** Remembers a dismissed one-time notice so a later info reload keeps it hidden. */
  migrationDismissed: boolean;
  /** Result notice for the last successful root change. */
  rootChangeNotice: string | null;
  /** Latest throttled progress snapshot while a folder batch is running. */
  importProgress: ImportProgressEvent | null;
  /** Outcome of the last completed folder batch; shown in a summary modal. */
  lastFolderSummary: FolderImportSummary | null;
  init(): () => void;
  loadInfo(): Promise<void>;
  migrateLegacy(): Promise<LegacyMigrationSummary | null>;
  chooseAndChangeRoot(): Promise<void>;
  importFolder(): Promise<FolderImportSummary | null>;
  cancelImport(): Promise<void>;
  openRoot(): Promise<void>;
  revealPaper(paperId: number): Promise<void>;
  dismissError(): void;
  dismissMigrationNotice(): void;
  dismissRootChangeNotice(): void;
  dismissFolderSummary(): void;
}

function rootChangeSummary(result: RootChangeResult): string {
  const parts = [`已迁移 ${result.migrated} 篇文献，旧位置的副本仍保留，可自行清理`];
  if (result.unmanaged.length > 0) {
    const titles = result.unmanaged.map((paper) => paper.title).join('、');
    parts.push(`${result.unmanaged.length} 篇未托管（文件缺失），未迁移：${titles}`);
  }
  return parts.join('；');
}

// `init` is called from a React effect that StrictMode mounts twice; subscribe
// to the main-process events once and let the returned cleanup re-arm it.
let unsubscribeEvents: (() => void) | null = null;

export const useStorageStore = create<StorageState>()((set, get) => ({
  info: null,
  busy: IDLE_JOB_STATE,
  loading: false,
  error: null,
  errorDismissed: false,
  lastMigration: null,
  migrationDismissed: false,
  rootChangeNotice: null,
  importProgress: null,
  lastFolderSummary: null,

  init() {
    let unsubscribe = unsubscribeEvents;
    if (unsubscribe === null) {
      const offBusy = window.api.storage.onBusy((state) => {
        set({ busy: state });
      });
      const offMigrated = window.api.storage.onMigrated((summary) => {
        set({ lastMigration: summary, migrationDismissed: false });
        if (summary.adopted > 0) {
          // The event path is fire-and-forget from the main process; a failed
          // reload must become a visible store error, not an unhandled rejection.
          void useLibraryStore
            .getState()
            .load()
            .catch((error: unknown) => {
              set({ error: errorMessage(error), errorDismissed: false });
            });
        }
      });
      const offImportProgress = window.api.storage.onImportProgress((event) => {
        // `done` arrives right before the invoke resolves with the summary;
        // clearing here removes the progress banner as soon as work stops.
        set({ importProgress: event.phase === 'done' ? null : event });
      });
      unsubscribe = () => {
        offBusy();
        offMigrated();
        offImportProgress();
        unsubscribeEvents = null;
      };
      unsubscribeEvents = unsubscribe;
    }
    void get().loadInfo();
    return unsubscribe;
  },

  async loadInfo() {
    set({ loading: true });
    try {
      const info = await window.api.storage.getInfo();
      set((state) => {
        // An action error recorded after the previous snapshot is newer than
        // `info.error` and must win; an error merely mirrored from the old
        // snapshot is replaced by the fresh one. A dismissed banner stays
        // dismissed across later info snapshots.
        const previousInfoError = state.info?.error ?? null;
        const freshActionError =
          state.error !== null && state.error !== previousInfoError ? state.error : null;
        const error = state.errorDismissed
          ? freshActionError
          : (freshActionError ?? info.error);
        return {
          info: state.errorDismissed ? { ...info, error: null } : info,
          error,
          lastMigration: state.migrationDismissed
            ? null
            : (info.migration ?? state.lastMigration),
        };
      });
      if ((info.migration?.adopted ?? 0) > 0) {
        // Reloading the list is a separate concern from reading storage info:
        // its failure keeps the fresh snapshot and never gets mislabeled.
        try {
          await useLibraryStore.getState().load();
        } catch (error) {
          set({ error: errorMessage(error), errorDismissed: false });
        }
      }
    } catch (error) {
      set({ error: errorMessage(error), errorDismissed: false });
    } finally {
      set({ loading: false });
    }
  },

  async migrateLegacy() {
    set({ loading: true, error: null, errorDismissed: false });
    try {
      const summary = await window.api.storage.migrateLegacy();
      set({ lastMigration: summary, migrationDismissed: false });
      await get().loadInfo();
      return summary;
    } catch (error) {
      // The manual retry is a user action; keep its Chinese error in the
      // storage banner instead of rejecting into a click handler.
      set({ error: errorMessage(error), errorDismissed: false });
      return null;
    } finally {
      set({ loading: false });
    }
  },

  async chooseAndChangeRoot() {
    // A new attempt invalidates the previous success notice before anything
    // can fail, so a stale "migrated" message never sits next to a new error.
    set({ rootChangeNotice: null });
    try {
      const newRoot = await window.api.storage.chooseRoot();
      if (newRoot === null) {
        return;
      }
      set({ loading: true, error: null, errorDismissed: false });
      try {
        const result = await window.api.storage.changeRoot(newRoot);
        set((state) => ({
          info: state.info === null ? null : { ...state.info, root: result.root },
          // The previous root's migration summary no longer describes the library.
          lastMigration: null,
          rootChangeNotice: rootChangeSummary(result),
        }));
        // The root setting is read by the app-settings store; refresh it too.
        void useAppSettingsStore.getState().load();
        await get().loadInfo();
        try {
          await useLibraryStore.getState().load();
        } catch (error) {
          set({ error: errorMessage(error), errorDismissed: false });
        }
      } catch (error) {
        // The change never happened: leave `info.root` on the old library.
        set({ error: errorMessage(error), errorDismissed: false });
      } finally {
        set({ loading: false });
      }
    } catch (error) {
      set({ error: errorMessage(error), errorDismissed: false });
    }
  },

  async importFolder() {
    // A new attempt makes the previous summary modal stale immediately.
    set({
      lastFolderSummary: null,
      importProgress: null,
      error: null,
      errorDismissed: false,
    });
    try {
      const summary = await window.api.storage.importFolder();
      if (summary === null) {
        return null;
      }
      set({ lastFolderSummary: summary, importProgress: null });
      try {
        await useLibraryStore.getState().load();
      } catch (error) {
        set({ error: errorMessage(error), errorDismissed: false });
      }
      return summary;
    } catch (error) {
      set({ error: errorMessage(error), errorDismissed: false, importProgress: null });
      return null;
    }
  },

  async cancelImport() {
    try {
      await window.api.storage.cancelImport();
    } catch (error) {
      set({ error: errorMessage(error), errorDismissed: false });
    }
  },

  async openRoot() {
    await window.api.storage.openRoot();
  },

  async revealPaper(paperId) {
    await window.api.storage.revealPaper(paperId);
  },

  dismissError() {
    set((state) => ({
      error: null,
      errorDismissed: true,
      info: state.info === null ? null : { ...state.info, error: null },
    }));
  },

  dismissMigrationNotice() {
    set({ lastMigration: null, migrationDismissed: true });
  },

  dismissRootChangeNotice() {
    set({ rootChangeNotice: null });
  },

  dismissFolderSummary() {
    set({ lastFolderSummary: null });
  },
}));
