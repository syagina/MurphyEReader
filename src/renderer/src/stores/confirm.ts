import { create } from 'zustand';

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'default' | 'danger';
}

export interface ConfirmRequest extends ConfirmOptions {
  id: number;
}

interface ConfirmState {
  requests: ConfirmRequest[];
  request(options: ConfirmOptions): Promise<boolean>;
  resolve(id: number, value: boolean): void;
}

let nextId = 1;
const resolvers = new Map<number, (value: boolean) => void>();

/**
 * Promise-based, one-at-a-time confirmation queue. It deliberately lives in the
 * renderer rather than using Electron's native modal, whose focus/IME teardown
 * on Windows is unreliable.
 */
export const useConfirmStore = create<ConfirmState>()((set, get) => ({
  requests: [],

  request(options) {
    const id = nextId;
    nextId += 1;
    return new Promise<boolean>((resolve) => {
      resolvers.set(id, resolve);
      set((state) => ({ requests: [...state.requests, { id, ...options }] }));
    });
  },

  resolve(id, value) {
    if (!get().requests.some((request) => request.id === id)) {
      return;
    }
    set((state) => ({
      requests: state.requests.filter((request) => request.id !== id),
    }));
    const resolve = resolvers.get(id);
    resolvers.delete(id);
    resolve?.(value);
  },
}));

/** Asks for confirmation and resolves once the user (or Escape/overlay) answers. */
export function confirm(options: ConfirmOptions): Promise<boolean> {
  return useConfirmStore.getState().request(options);
}
