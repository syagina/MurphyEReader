import type { Note } from '@shared/types';

/** Raw editor values for a note; `tags` keeps whatever the user typed. */
export interface NoteDraft {
  title: string;
  tags: string;
  contentMd: string;
}

/** Builds the editable draft from a stored note. */
export function noteDraftFromNote(
  note: Pick<Note, 'title' | 'tags' | 'contentMd'>,
): NoteDraft {
  return {
    title: note.title,
    tags: note.tags.join(', '),
    contentMd: note.contentMd,
  };
}

/**
 * Whether the draft diverges from the stored note. The raw tag input is
 * compared against `tags.join(', ')` on purpose: whitespace or comma variants
 * still count as an unsaved edit, matching what the user typed.
 */
export function isNoteDraftDirty(
  note: Pick<Note, 'title' | 'tags' | 'contentMd'>,
  draft: NoteDraft,
): boolean {
  return (
    draft.title !== note.title ||
    draft.tags !== note.tags.join(', ') ||
    draft.contentMd !== note.contentMd
  );
}
