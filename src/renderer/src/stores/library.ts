import { create } from 'zustand';
import type {
  ImportPaperResult,
  Paper,
  PaperFileStatus,
  PaperUpdatePatch,
} from '@shared/types';

export type { PaperUpdatePatch };

export type FileStatus = Omit<PaperFileStatus, 'id'>;

export interface LibraryState {
  papers: Paper[];
  loading: boolean;
  fileStatus: Record<number, FileStatus>;
  load(): Promise<void>;
  /** Re-checks bound files without reloading the paper list. */
  refreshFileStatus(): Promise<void>;
  importPaper(): Promise<ImportPaperResult | null>;
  attachTranslated(id: number): Promise<Paper | null>;
  relocate(id: number, version: 'original' | 'translated'): Promise<void>;
  removePaper(id: number): Promise<void>;
  updateMeta(id: number, patch: PaperUpdatePatch): Promise<void>;
}

const REPLACE_TRANSLATION_CONFIRM = '该文献已有译本，确定用新文件替换吗？';

function toFileStatusMap(
  statuses: PaperFileStatus[],
): Record<number, FileStatus> {
  const fileStatus: Record<number, FileStatus> = {};
  for (const status of statuses) {
    fileStatus[status.id] = {
      originalExists: status.originalExists,
      translatedExists: status.translatedExists,
      bilingualExists: status.bilingualExists,
      translatedIsBilingual: status.translatedIsBilingual,
    };
  }
  return fileStatus;
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
      set({ papers, fileStatus: toFileStatusMap(statuses) });
    } finally {
      set({ loading: false });
    }
  },

  async refreshFileStatus() {
    const statuses = await window.api.papers.checkFiles();
    set({ fileStatus: toFileStatusMap(statuses) });
  },

  async importPaper() {
    const result = await window.api.papers.importOriginal();
    if (result === null) {
      return null;
    }
    // A plain duplicate already has a working row; leave the list untouched so
    // the caller can simply highlight the existing card. A restored duplicate
    // was re-copied into that row, so replace its stale card and status.
    if (result.restored === true) {
      set((state) => ({
        papers: state.papers.some((paper) => paper.id === result.paper.id)
          ? state.papers.map((paper) =>
              paper.id === result.paper.id ? result.paper : paper,
            )
          : [result.paper, ...state.papers],
        fileStatus: {
          ...state.fileStatus,
          [result.paper.id]: {
            originalExists: true,
            translatedExists: result.paper.filePathTranslated !== null,
            bilingualExists: false,
            translatedIsBilingual: false,
          },
        },
      }));
    } else if (!result.duplicate) {
      set((state) => ({
        papers: [result.paper, ...state.papers],
        fileStatus: {
          ...state.fileStatus,
          [result.paper.id]: {
            originalExists: true,
            translatedExists: false,
            bilingualExists: false,
            translatedIsBilingual: false,
          },
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
          bilingualExists: false,
          translatedIsBilingual: false,
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
