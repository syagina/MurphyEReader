import { create } from 'zustand';
import type { Folder } from '@shared/types';
import { errorMessage } from '../lib/errors';

export interface FoldersState {
  folders: Folder[];
  loading: boolean;
  /** Latest folder operation failure, rendered in the library sidebar. */
  error: string | null;
  load(): Promise<void>;
  create(name: string): Promise<Folder | null>;
  rename(id: number, name: string): Promise<Folder | null>;
  remove(id: number): Promise<boolean>;
}

export const useFoldersStore = create<FoldersState>()((set) => ({
  folders: [],
  loading: false,
  error: null,

  async load() {
    set({ loading: true, error: null });
    try {
      const folders = await window.api.folders.list();
      set({ folders });
    } catch (loadError) {
      set({ error: errorMessage(loadError) });
    } finally {
      set({ loading: false });
    }
  },

  async create(name) {
    set({ error: null });
    try {
      const folder = await window.api.folders.create(name);
      set((state) => ({ folders: [...state.folders, folder] }));
      return folder;
    } catch (createError) {
      set({ error: errorMessage(createError) });
      return null;
    }
  },

  async rename(id, name) {
    set({ error: null });
    try {
      const folder = await window.api.folders.rename(id, name);
      set((state) => ({
        folders: state.folders.map((existing) => (existing.id === folder.id ? folder : existing)),
      }));
      return folder;
    } catch (renameError) {
      set({ error: errorMessage(renameError) });
      return null;
    }
  },

  async remove(id) {
    set({ error: null });
    try {
      await window.api.folders.remove(id);
      set((state) => ({ folders: state.folders.filter((folder) => folder.id !== id) }));
      return true;
    } catch (removeError) {
      set({ error: errorMessage(removeError) });
      return false;
    }
  },
}));
