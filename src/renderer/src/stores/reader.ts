import { create } from 'zustand';
import { clampPage } from '../lib/pdf';

export interface ReaderSelection {
  text: string;
  pageNo: number;
}

export interface ReaderState {
  paperId: number | null;
  version: 'original' | 'translated';
  pageCount: number;
  currentPage: number;
  zoom: number;
  error: string | null;
  selection: ReaderSelection | null;
  open(paperId: number): Promise<void>;
  close(): void;
  setCurrentPage(page: number): void;
  setZoom(z: number): void;
  setSelection(sel: ReaderSelection | null): void;
  jumpToPage(page: number): void;
  /**
   * Extension for PDF viewer load failures (missing/corrupt files): the viewer
   * mirrors its local error here so other panels can see that reading failed.
   */
  setError(message: string | null): void;
}

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;

interface ReaderFields {
  paperId: number | null;
  version: 'original' | 'translated';
  pageCount: number;
  currentPage: number;
  zoom: number;
  error: string | null;
  selection: ReaderSelection | null;
}

function initialFields(): ReaderFields {
  return {
    paperId: null,
    version: 'original',
    pageCount: 0,
    currentPage: 1,
    zoom: 1,
    error: null,
    selection: null,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) {
    return 1;
  }
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

export const useReaderStore = create<ReaderState>()((set, get) => ({
  ...initialFields(),

  async open(paperId) {
    set({ ...initialFields(), paperId });
    try {
      const paper = await window.api.papers.get(paperId);
      if (paper === null) {
        set({ error: `文献不存在: ${paperId}` });
        return;
      }
      const pageCount = paper.pageCountOriginal;
      set({
        pageCount,
        currentPage: clampPage(paper.lastPageOriginal || 1, pageCount),
      });
      try {
        // Validation read only. The buffer is intentionally not kept in state:
        // PdfViewer re-reads it for pdfjs (double IPC read is accepted in v1).
        await window.api.pdf.load(paperId, 'original');
      } catch (error) {
        set({ error: errorMessage(error) });
      }
    } catch (error) {
      // Metadata lookup failures (e.g. DB errors) surface in the viewer error UI.
      set({ error: errorMessage(error) });
    }
  },

  close() {
    set(initialFields());
  },

  setCurrentPage(page) {
    set({ currentPage: clampPage(page, get().pageCount) });
  },

  setZoom(z) {
    set({ zoom: clampZoom(z) });
  },

  setSelection(sel) {
    set({ selection: sel });
  },

  jumpToPage(page) {
    set({ currentPage: clampPage(page, get().pageCount) });
  },

  setError(message) {
    set({ error: message });
  },
}));
