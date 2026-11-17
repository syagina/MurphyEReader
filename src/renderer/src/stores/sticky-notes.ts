import { create } from 'zustand';
import type {
  PdfVersion,
  StickyNote,
  StickyNoteCreateInput,
  StickyNoteExportResult,
  StickyNoteUpdatePatch,
} from '@shared/types';
import { errorMessage } from '../lib/errors';

export interface StickyNotesState {
  paperId: number | null;
  version: PdfVersion | null;
  notes: StickyNote[];
  activeNoteId: number | null;
  loading: boolean;
  exporting: boolean;
  error: string | null;
  notice: StickyNoteExportResult | null;
  load(paperId: number, version: PdfVersion): Promise<void>;
  create(input: StickyNoteCreateInput): Promise<StickyNote | null>;
  update(id: number, patch: StickyNoteUpdatePatch): Promise<StickyNote | null>;
  remove(id: number): Promise<boolean>;
  clearPageDrawings(
    paperId: number,
    version: PdfVersion,
    pageNo: number,
  ): Promise<number | null>;
  openNote(id: number | null): void;
  exportPdf(
    paperId: number,
    version: PdfVersion,
  ): Promise<StickyNoteExportResult | null>;
  reset(): void;
  clearError(): void;
  dismissNotice(): void;
}

function sortNotes(notes: StickyNote[]): StickyNote[] {
  return [...notes].sort(
    (a, b) => a.pageNo - b.pageNo || a.createdAt - b.createdAt || a.id - b.id,
  );
}

function sameDomain(
  state: Pick<StickyNotesState, 'paperId' | 'version'>,
  note: Pick<StickyNote, 'paperId' | 'pdfVersion'>,
): boolean {
  return state.paperId === note.paperId && state.version === note.pdfVersion;
}

/** Invalidates in-flight loads when the view moves on or a write lands. */
let loadSeq = 0;

const INITIAL = {
  paperId: null,
  version: null,
  notes: [],
  activeNoteId: null,
  loading: false,
  exporting: false,
  error: null,
  notice: null,
} satisfies Partial<StickyNotesState>;

export const useStickyNotesStore = create<StickyNotesState>()((set, get) => ({
  ...INITIAL,

  async load(paperId, version) {
    const seq = ++loadSeq;
    const changed = get().paperId !== paperId || get().version !== version;
    set({
      paperId,
      version,
      loading: true,
      error: null,
      ...(changed ? { notes: [], activeNoteId: null } : {}),
    });

    let notes: StickyNote[];
    try {
      notes = await window.api.stickyNotes.list(paperId, version);
    } catch (error) {
      if (
        seq === loadSeq &&
        get().paperId === paperId &&
        get().version === version
      ) {
        set({ loading: false, error: errorMessage(error) });
      }
      return;
    }
    if (
      seq !== loadSeq ||
      get().paperId !== paperId ||
      get().version !== version
    ) {
      return;
    }

    const sorted = sortNotes(notes);
    const active = get().activeNoteId;
    set({
      notes: sorted,
      loading: false,
      activeNoteId:
        active !== null && sorted.some((note) => note.id === active)
          ? active
          : null,
    });
  },

  async create(input) {
    set({ error: null });
    try {
      const note = await window.api.stickyNotes.create(input);
      ++loadSeq;
      set((state) => {
        if (!sameDomain(state, note)) {
          return {};
        }
        return {
          notes: sortNotes([
            ...state.notes.filter((existing) => existing.id !== note.id),
            note,
          ]),
        };
      });
      return note;
    } catch (error) {
      set({ error: errorMessage(error) });
      return null;
    }
  },

  async update(id, patch) {
    set({ error: null });
    try {
      const note = await window.api.stickyNotes.update(id, patch);
      ++loadSeq;
      set((state) => {
        if (!sameDomain(state, note)) {
          return {};
        }
        return {
          notes: sortNotes([
            ...state.notes.filter((existing) => existing.id !== note.id),
            note,
          ]),
        };
      });
      return note;
    } catch (error) {
      set({ error: errorMessage(error) });
      return null;
    }
  },

  async remove(id) {
    set({ error: null });
    try {
      await window.api.stickyNotes.remove(id);
      ++loadSeq;
      set((state) => ({
        notes: state.notes.filter((note) => note.id !== id),
        activeNoteId: state.activeNoteId === id ? null : state.activeNoteId,
      }));
      return true;
    } catch (error) {
      set({ error: errorMessage(error) });
      return false;
    }
  },

  async clearPageDrawings(paperId, version, pageNo) {
    set({ error: null });
    try {
      const removed = await window.api.stickyNotes.clearPageDrawings(
        paperId,
        version,
        pageNo,
      );
      // The view may have moved to another paper/version while the request was
      // in flight. The delete targeted the old domain, so leave the new domain
      // untouched and do not invalidate its in-flight load.
      if (get().paperId !== paperId || get().version !== version) {
        return removed;
      }
      ++loadSeq;
      set((state) => ({
        notes: state.notes.filter(
          (note) =>
            !sameDomain(state, note) ||
            note.pageNo !== pageNo ||
            (note.kind !== 'ink' && note.kind !== 'shape'),
        ),
      }));
      return removed;
    } catch (error) {
      if (get().paperId !== paperId || get().version !== version) {
        return null;
      }
      set({ error: errorMessage(error) });
      return null;
    }
  },

  openNote(id) {
    set({ activeNoteId: id });
  },

  async exportPdf(paperId, version) {
    set({ exporting: true, error: null, notice: null });
    try {
      const result = await window.api.stickyNotes.exportPdf(paperId, version);
      set({ exporting: false, notice: result });
      return result;
    } catch (error) {
      set({ exporting: false, error: errorMessage(error) });
      return null;
    }
  },

  reset() {
    ++loadSeq;
    set({ ...INITIAL });
  },

  clearError() {
    set({ error: null });
  },

  dismissNotice() {
    set({ notice: null });
  },
}));
