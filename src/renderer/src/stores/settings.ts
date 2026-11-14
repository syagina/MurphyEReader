import { create } from 'zustand';
import type { AiSettings, AiSettingsInput } from '@shared/types';
import { errorMessage } from '../lib/errors';

export interface SettingsState {
  settings: AiSettings | null;
  loading: boolean;
  error: string | null;
  testing: boolean;
  load(): Promise<void>;
  save(input: AiSettingsInput): Promise<void>;
  test(input: AiSettingsInput): Promise<{ ok: boolean; error?: string }>;
  clearError(): void;
}

/**
 * Renderer-side view of the AI settings. The API key itself never passes
 * through this store in readable form: `settings` only carries `apiKeySet`,
 * and inputs handed to `save`/`test` are not retained.
 */
export const useSettingsStore = create<SettingsState>()((set) => ({
  settings: null,
  loading: false,
  error: null,
  testing: false,

  async load() {
    set({ loading: true, error: null });
    try {
      const settings = await window.api.settings.get();
      set({ settings });
    } catch (error) {
      set({ error: errorMessage(error) });
    } finally {
      set({ loading: false });
    }
  },

  async save(input) {
    set({ error: null });
    try {
      const settings = await window.api.settings.set(input);
      set({ settings });
    } catch (error) {
      // Keep the failure visible for the dialog and let it decide to stay open.
      set({ error: errorMessage(error) });
      throw error;
    }
  },

  async test(input) {
    set({ testing: true });
    try {
      return await window.api.settings.test(input);
    } catch (error) {
      // An IPC rejection is a failed connection test, not a store crash.
      return { ok: false, error: errorMessage(error) };
    } finally {
      set({ testing: false });
    }
  },

  clearError() {
    set({ error: null });
  },
}));
