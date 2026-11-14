import { create } from 'zustand';
import type { SearchResult } from '@shared/types';
import { errorMessage } from '../lib/errors';

export interface SearchState {
  query: string;
  results: SearchResult[];
  /** True only while a `search.global` request is in flight. */
  searching: boolean;
  error: string | null;
  /** True once a request for the current query has completed. */
  hasSearched: boolean;
  setQuery(query: string): void;
  run(): Promise<void>;
  setError(message: string | null): void;
  dismissError(): void;
  clear(): void;
}

const DEBOUNCE_MS = 250;

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
/**
 * Monotonic request generation. Every query edit, manual run and clear bumps it
 * so a response that arrives after the user moved on cannot write state.
 */
let requestSeq = 0;

function cancelDebounce(): void {
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
}

export const useSearchStore = create<SearchState>()((set, get) => ({
  query: '',
  results: [],
  searching: false,
  error: null,
  hasSearched: false,

  setQuery(query) {
    cancelDebounce();
    // A new keystroke invalidates any response still in flight.
    requestSeq += 1;
    if (query.trim() === '') {
      set({ query, results: [], searching: false, error: null, hasSearched: false });
      return;
    }
    set({ query, results: [], searching: false, error: null, hasSearched: false });
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      void get().run();
    }, DEBOUNCE_MS);
  },

  async run() {
    cancelDebounce();
    const query = get().query.trim();
    if (query === '') {
      set({ results: [], searching: false });
      return;
    }
    const seq = ++requestSeq;
    set({ searching: true, error: null });
    try {
      const results = await window.api.search.global(query);
      if (seq !== requestSeq) {
        return;
      }
      set({ results, searching: false, hasSearched: true });
    } catch (error) {
      if (seq !== requestSeq) {
        return;
      }
      set({ results: [], searching: false, error: errorMessage(error), hasSearched: true });
    }
  },

  setError(message) {
    set({ error: message });
  },

  dismissError() {
    set({ error: null });
  },

  clear() {
    cancelDebounce();
    requestSeq += 1;
    set({ query: '', results: [], searching: false, error: null, hasSearched: false });
  },
}));
