import {
  ANNOTATION_DEFAULT_HIGHLIGHT_COLOR,
  ANNOTATION_DEFAULT_MARK_COLOR,
} from '@shared/sticky-notes';
import type { AnnotationMarkStyle, StickyNote } from '@shared/types';

/** Fixed highlight palette: yellow, green, blue, pink, purple. */
export const HIGHLIGHT_COLORS = [
  '#facc15',
  '#4ade80',
  '#60a5fa',
  '#f472b6',
  '#c084fc',
] as const;

/** Fixed underline / strikeout palette; first entry is the shared default. */
export const MARK_COLORS = [
  ANNOTATION_DEFAULT_MARK_COLOR,
  '#f97316',
  '#eab308',
  '#22c55e',
  '#3b82f6',
  '#a855f7',
  '#000000',
] as const;

/** Fixed drawing palette; first entry is the default pen colour. */
export const DEFAULT_DRAWING_COLOR = '#111827';

export const DRAWING_COLORS = [
  DEFAULT_DRAWING_COLOR,
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#3b82f6',
  '#a855f7',
] as const;

/** Default colour for a text mark of `style`. */
export function defaultMarkColor(style: AnnotationMarkStyle): string {
  return style === 'highlight'
    ? ANNOTATION_DEFAULT_HIGHLIGHT_COLOR
    : ANNOTATION_DEFAULT_MARK_COLOR;
}

/** A note's own colour, falling back to the default for its mark style. */
export function colorForNote(
  note: Pick<StickyNote, 'color' | 'markStyle'>,
): string {
  return note.color ?? defaultMarkColor(note.markStyle);
}
