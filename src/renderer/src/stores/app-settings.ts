import { create } from 'zustand';
import type { AppSettings, AppSettingsUpdate } from '@shared/types';
import { errorMessage, stripIpcErrorPrefix } from '../lib/errors';

export interface AppSettingsState {
  settings: AppSettings | null;
  loading: boolean;
  error: string | null;
  load(): Promise<void>;
  save(patch: AppSettingsUpdate): Promise<void>;
}

/**
 * Renderer-side view of the generic application settings (library root,
 * BabelDOC path, AI panel width, theme). Failures stay on the store so a settings tab
 * can show them; `save` also rethrows so a form can keep its draft open.
 */
export const useAppSettingsStore = create<AppSettingsState>()((set) => ({
  settings: null,
  loading: false,
  error: null,

  async load() {
    set({ loading: true, error: null });
    try {
      const settings = await window.api.appSettings.get();
      set({ settings });
    } catch (error) {
      set({ error: stripIpcErrorPrefix(errorMessage(error)) });
    } finally {
      set({ loading: false });
    }
  },

  async save(patch) {
    set({ error: null });
    try {
      const settings = await window.api.appSettings.update(patch);
      set({ settings });
    } catch (error) {
      set({ error: stripIpcErrorPrefix(errorMessage(error)) });
      throw error;
    }
  },
}));
