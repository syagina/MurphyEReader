import { create } from 'zustand';
import type {
  AiProfile,
  AiProfileInput,
  AiSettings,
  AiSettingsInput,
  AiSpeedTestResult,
} from '@shared/types';
import { errorMessage } from '../lib/errors';

export interface SettingsState {
  /** Active profile as seen by the rest of the renderer (e.g. vision availability). */
  settings: AiSettings | null;
  profiles: AiProfile[];
  loading: boolean;
  error: string | null;
  testing: boolean;
  testingAll: boolean;
  /** Latest speed probe per profile id; cleared for a profile when it is removed. */
  speedResults: Record<number, AiSpeedTestResult>;
  load(): Promise<void>;
  create(input: AiProfileInput): Promise<AiProfile>;
  update(id: number, input: AiProfileInput): Promise<AiProfile>;
  remove(id: number): Promise<void>;
  activate(id: number): Promise<void>;
  test(
    input: AiSettingsInput,
    profileId: number | null,
  ): Promise<{ ok: boolean; error?: string }>;
  speedTestAll(): Promise<void>;
  clearError(): void;
}

/**
 * Renderer-side view of AI profiles. API keys never pass through this store:
 * profiles only carry `apiKeySet`, and form inputs handed to `test` are not
 * retained.
 */
export const useSettingsStore = create<SettingsState>()((set, get) => ({
  settings: null,
  profiles: [],
  loading: false,
  error: null,
  testing: false,
  testingAll: false,
  speedResults: {},

  async load() {
    set({ loading: true, error: null });
    try {
      const [settings, profiles] = await Promise.all([
        window.api.settings.get(),
        window.api.aiProfiles.list(),
      ]);
      set({ settings, profiles });
    } catch (error) {
      set({ error: errorMessage(error) });
    } finally {
      set({ loading: false });
    }
  },

  async create(input) {
    set({ error: null });
    try {
      const profile = await window.api.aiProfiles.create(input);
      await get().load();
      return profile;
    } catch (error) {
      set({ error: errorMessage(error) });
      throw error;
    }
  },

  async update(id, input) {
    set({ error: null });
    try {
      const profile = await window.api.aiProfiles.update(id, input);
      // A changed endpoint invalidates the previous probe for this profile.
      set((state) => {
        const speedResults = { ...state.speedResults };
        delete speedResults[id];
        return { speedResults };
      });
      await get().load();
      return profile;
    } catch (error) {
      set({ error: errorMessage(error) });
      throw error;
    }
  },

  async remove(id) {
    set({ error: null });
    try {
      await window.api.aiProfiles.remove(id);
      set((state) => {
        const speedResults = { ...state.speedResults };
        delete speedResults[id];
        return { speedResults };
      });
      await get().load();
    } catch (error) {
      set({ error: errorMessage(error) });
      throw error;
    }
  },

  async activate(id) {
    set({ error: null });
    try {
      await window.api.aiProfiles.activate(id);
      await get().load();
    } catch (error) {
      set({ error: errorMessage(error) });
      throw error;
    }
  },

  async test(input, profileId) {
    set({ testing: true });
    try {
      return await window.api.settings.test(input, profileId);
    } catch (error) {
      // An IPC rejection is a failed connection test, not a store crash.
      return { ok: false, error: errorMessage(error) };
    } finally {
      set({ testing: false });
    }
  },

  async speedTestAll() {
    set({ testingAll: true, error: null });
    try {
      const results = await window.api.aiProfiles.speedTestAll();
      const speedResults: Record<number, AiSpeedTestResult> = {};
      for (const result of results) {
        speedResults[result.profileId] = result;
      }
      set({ speedResults });
    } catch (error) {
      set({ error: errorMessage(error) });
    } finally {
      set({ testingAll: false });
    }
  },

  clearError() {
    set({ error: null });
  },
}));
