import { create } from 'zustand';
import type { PaperLensApi } from '@shared/ipc';
import type { Paper } from '@shared/types';

export interface FileStatus {
  originalExists: boolean;
  translatedExists: boolean;
}

export type PaperUpdatePatch = Parameters<PaperLensApi['papers']['update']>[1];

export interface LibraryState {
  papers: Paper[];
  loading: boolean;
  fileStatus: Record<number, FileStatus>;
  load(): Promise<void>;
  importPaper(): Promise<void>;
  attachTranslated(id: number): Promise<void>;
  relocate(id: number, version: 'original' | 'translated'): Promise<void>;
  removePaper(id: number): Promise<void>;
  updateMeta(id: number, patch: PaperUpdatePatch): Promise<void>;
}

export const useLibraryStore = create<LibraryState>()((set, get) => ({
  papers: [],
  loading: false,
  fileStatus: {},

  async load() {
    set({ loading: true });
    try {
      const papers = await window.api.papers.list();
      const statuses = await window.api.papers.checkFiles();
      const fileStatus: Record<number, FileStatus> = {};
      for (const status of statuses) {
        fileStatus[status.id] = {
          originalExists: status.originalExists,
          translatedExists: status.translatedExists,
        };
      }
      set({ papers, fileStatus });
    } finally {
      set({ loading: false });
    }
  },

  async importPaper() {
    const paper = await window.api.papers.importOriginal();
    if (paper === null) {
      return;
    }
    set((state) => ({
      papers: [paper, ...state.papers],
      fileStatus: {
        ...state.fileStatus,
        [paper.id]: { originalExists: true, translatedExists: false },
      },
    }));
  },

  async attachTranslated(id) {
    const paper = await window.api.papers.attachTranslated(id);
    if (paper === null) {
      return;
    }
    set((state) => ({
      papers: state.papers.map((existing) => (existing.id === paper.id ? paper : existing)),
      fileStatus: {
        ...state.fileStatus,
        [paper.id]: {
          originalExists: state.fileStatus[paper.id]?.originalExists ?? true,
          translatedExists: true,
        },
      },
    }));
  },

  async relocate(id, version) {
    const paper = await window.api.papers.relocate(id, version);
    if (paper === null) {
      return;
    }
    await get().load();
  },

  async removePaper(id) {
    await window.api.papers.remove(id);
    set((state) => {
      const fileStatus = { ...state.fileStatus };
      delete fileStatus[id];
      return {
        papers: state.papers.filter((paper) => paper.id !== id),
        fileStatus,
      };
    });
  },

  async updateMeta(id, patch) {
    const paper = await window.api.papers.update(id, patch);
    set((state) => ({
      papers: state.papers.map((existing) => (existing.id === paper.id ? paper : existing)),
    }));
  },
}));
