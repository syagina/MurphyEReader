import type { PaperLensApi } from '../shared/ipc';

declare global {
  interface Window {
    api: PaperLensApi;
  }
}
