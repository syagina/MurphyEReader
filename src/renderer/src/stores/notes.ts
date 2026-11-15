import { create } from 'zustand';
import type { PaperLensApi } from '@shared/ipc';
import type { Note } from '@shared/types';
import { errorMessage } from '../lib/errors';

export type NoteKind = Parameters<PaperLensApi['notes']['generate']>[0];
export type NoteCreateInput = Parameters<PaperLensApi['notes']['create']>[0];
export type NoteUpdatePatch = Parameters<PaperLensApi['notes']['update']>[1];
export type NoteGenerateParams = Parameters<PaperLensApi['notes']['generate']>[1];

export interface NotesState {
  notes: Note[];
  selectedNoteId: number | null;
  /** Current list filter; `null` means notes from every paper. */
  paperId: number | null;
  /** The generation currently running, or `null` when idle. */
  generating: NoteKind | null;
  error: string | null;
  load(paperId?: number): Promise<void>;
  create(input: NoteCreateInput): Promise<Note | null>;
  update(id: number, patch: NoteUpdatePatch): Promise<Note | null>;
  remove(id: number): Promise<void>;
  generate(kind: NoteKind, params: NoteGenerateParams): Promise<Note | null>;
  selectNote(id: number | null): void;
  clearError(): void;
}

/** Matches the database order: `updated_at DESC, id DESC`. */
function sortNotes(notes: Note[]): Note[] {
  return [...notes].sort((a, b) => b.updatedAt - a.updatedAt || b.id - a.id);
}

/** Invalidates in-flight `load` results when a newer view takes over. */
let loadSeq = 0;

export const useNotesStore = create<NotesState>()((set, get) => ({
  notes: [],
  selectedNoteId: null,
  paperId: null,
  generating: null,
  error: null,

  async load(paperId) {
    const filter = paperId ?? null;
    const seq = ++loadSeq;
    const filterChanged = get().paperId !== filter;
    // Do not clear `error`: a generation failure can predate the notes panel
    // mounting (e.g. 文献栏「生成结构化总结」) and must stay visible until the
    // user dismisses it.
    set({
      paperId: filter,
      ...(filterChanged ? { notes: [] } : {}),
    });

    let notes: Note[];
    try {
      notes = sortNotes(await window.api.notes.list(paperId));
    } catch (error) {
      if (seq === loadSeq && get().paperId === filter) {
        set({ error: errorMessage(error) });
      }
      return;
    }
    if (seq !== loadSeq || get().paperId !== filter) {
      return;
    }
    const selected = get().selectedNoteId;
    set({
      notes,
      selectedNoteId:
        selected !== null && notes.some((note) => note.id === selected) ? selected : null,
    });
  },

  async create(input) {
    set({ error: null });
    try {
      const note = await window.api.notes.create(input);
      set((state) => {
        if (state.paperId !== null && note.paperId !== state.paperId) {
          return {};
        }
        return {
          notes: sortNotes([
            ...state.notes.filter((existing) => existing.id !== note.id),
            note,
          ]),
          selectedNoteId: note.id,
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
      const note = await window.api.notes.update(id, patch);
      set((state) => ({
        notes: sortNotes(
          state.notes.map((existing) => (existing.id === note.id ? note : existing)),
        ),
      }));
      return note;
    } catch (error) {
      set({ error: errorMessage(error) });
      return null;
    }
  },

  async remove(id) {
    set({ error: null });
    try {
      await window.api.notes.remove(id);
      set((state) => ({
        notes: state.notes.filter((note) => note.id !== id),
        selectedNoteId: state.selectedNoteId === id ? null : state.selectedNoteId,
      }));
    } catch (error) {
      set({ error: errorMessage(error) });
    }
  },

  async generate(kind, params) {
    // The AI backend handles one long request at a time; the panels disable
    // their buttons, and this guard closes the race between them.
    if (get().generating !== null) {
      return null;
    }
    set({ generating: kind, error: null });
    try {
      const note = await window.api.notes.generate(kind, params);
      if (note !== null) {
        set((state) => {
          if (state.paperId !== null && note.paperId !== state.paperId) {
            return {};
          }
          return {
            notes: sortNotes([
              ...state.notes.filter((existing) => existing.id !== note.id),
              note,
            ]),
            // A generated concept card is the note the user asked about, so it
            // opens immediately; summaries and innovation notes stay in the list.
            ...(kind === 'concept' ? { selectedNoteId: note.id } : {}),
          };
        });
      }
      return note;
    } catch (error) {
      set({ error: errorMessage(error) });
      return null;
    } finally {
      set({ generating: null });
    }
  },

  selectNote(id) {
    set({ selectedNoteId: id });
  },

  clearError() {
    set({ error: null });
  },
}));
