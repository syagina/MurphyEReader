import type { StickyNote } from '@shared/types';
import { colorForNote } from '../lib/annotation-colors';
import { rectsToCss } from '../lib/sticky-note-geometry';

interface StickyNoteHighlightsProps {
  /** Notes already filtered to this page and PDF version. */
  notes: StickyNote[];
  /** Annotation whose popup is open; its marks are tagged with data-active. */
  activeNoteId?: number | null;
}

/**
 * Read-only annotation-mark layer between the canvas and the text layer. It
 * never receives pointer events; PdfViewer hit-tests clicks against the same
 * geometry. Page-margin pins live in the separate `AnnotationPins` layer.
 */
export function StickyNoteHighlights({
  notes,
  activeNoteId = null,
}: StickyNoteHighlightsProps): React.JSX.Element {
  return (
    <div className="sticky-note-layer" aria-hidden="true">
      {notes.flatMap((note) => {
        if (
          (note.kind !== 'note' && note.kind !== 'mark') ||
          note.markStyle === 'none' ||
          note.anchor.kind !== 'text'
        ) {
          return [];
        }
        const color = colorForNote(note);
        return rectsToCss(note.anchor.rects).map((rect, index) => (
          <span
            key={`${note.id}-${index}`}
            className={`annotation-mark annotation-mark-${note.markStyle}`}
            style={{ ...rect, '--annotation-color': color } as React.CSSProperties}
            data-active={note.id === activeNoteId}
          />
        ));
      })}
    </div>
  );
}
