import { create } from 'zustand';
import type { ImportPaperResult, Paper, PaperUpdatePatch } from '@shared/types';

export type { PaperUpdatePatch };

export interface FileStatus {
  originalExists: boolean;
  translatedExists: boolean;
}

export interface LibraryState {
  papers: Paper[];
  loading: boolean;
  fileStatus: Record<number, FileStatus>;
  load(): Promise<void>;
  importPaper(): Promise<ImportPaperResult | null>;
  attachTranslated(id: number): Promise<Paper | null>;
  relocate(id: number, version: 'original' | 'translated'): Promise<void>;
  removePaper(id: number): Promise<void>;
  updateMeta(id: number, patch: PaperUpdatePatch): Promise<void>;
}

const REPLACE_TRANSLATION_CONFIRM = '该文献已有译本，确定用新文件替换吗？';

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
    const result = await window.api.papers.importOriginal();
    if (result === null) {
      return null;
    }
    // A duplicate already has a row; leave the list untouched so the caller
    // can simply highlight the existing card.
    if (!result.duplicate) {
      set((state) => ({
        papers: [result.paper, ...state.papers],
        fileStatus: {
          ...state.fileStatus,
          [result.paper.id]: { originalExists: true, translatedExists: false },
        },
      }));
    }
    return result;
  },

  async attachTranslated(id) {
    const existing = get().papers.find((paper) => paper.id === id);
    if (existing !== undefined && existing.filePathTranslated !== null) {
      if (!window.confirm(REPLACE_TRANSLATION_CONFIRM)) {
        return null;
      }
    }
    const paper = await window.api.papers.attachTranslated(id);
    if (paper === null) {
      return null;
    }
    set((state) => ({
      papers: state.papers.map((current) => (current.id === paper.id ? paper : current)),
      fileStatus: {
        ...state.fileStatus,
        [paper.id]: {
          originalExists: state.fileStatus[paper.id]?.originalExists ?? true,
          translatedExists: true,
        },
      },
    }));
    return paper;
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
