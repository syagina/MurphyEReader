import { create } from 'zustand';
import type { JobState, LegacyMigrationSummary, StorageInfo } from '@shared/types';
import { errorMessage } from '../lib/errors';
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
  error: string | null;
  lastMigration: LegacyMigrationSummary | null;
  /** Remembers a dismissed one-time notice so a later info reload keeps it hidden. */
  migrationDismissed: boolean;
  init(): () => void;
  loadInfo(): Promise<void>;
  migrateLegacy(): Promise<LegacyMigrationSummary | null>;
  dismissError(): void;
  dismissMigrationNotice(): void;
}

// `init` is called from a React effect that StrictMode mounts twice; subscribe
// to the main-process events once and let the returned cleanup re-arm it.
let unsubscribeEvents: (() => void) | null = null;

export const useStorageStore = create<StorageState>()((set, get) => ({
  info: null,
  busy: IDLE_JOB_STATE,
  loading: false,
  error: null,
  lastMigration: null,
  migrationDismissed: false,

  init() {
    let unsubscribe = unsubscribeEvents;
    if (unsubscribe === null) {
      const offBusy = window.api.storage.onBusy((state) => {
        set({ busy: state });
      });
      const offMigrated = window.api.storage.onMigrated((summary) => {
        set({ lastMigration: summary, migrationDismissed: false });
        if (summary.adopted > 0) {
          void useLibraryStore.getState().load();
        }
      });
      unsubscribe = () => {
        offBusy();
        offMigrated();
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
      set((state) => ({
        info,
        error: info.error,
        lastMigration: state.migrationDismissed ? null : (info.migration ?? state.lastMigration),
      }));
      if ((info.migration?.adopted ?? 0) > 0) {
        await useLibraryStore.getState().load();
      }
    } catch (error) {
      set({ error: errorMessage(error) });
    } finally {
      set({ loading: false });
    }
  },

  async migrateLegacy() {
    set({ loading: true, error: null });
    try {
      const summary = await window.api.storage.migrateLegacy();
      set({ lastMigration: summary, migrationDismissed: false });
      await get().loadInfo();
      return summary;
    } catch (error) {
      // The manual retry is a user action; keep its Chinese error in the
      // storage banner instead of rejecting into a click handler.
      set({ error: errorMessage(error) });
      return null;
    } finally {
      set({ loading: false });
    }
  },

  dismissError() {
    set((state) => ({
      error: null,
      info: state.info === null ? null : { ...state.info, error: null },
    }));
  },

  dismissMigrationNotice() {
    set({ lastMigration: null, migrationDismissed: true });
  },
}));
