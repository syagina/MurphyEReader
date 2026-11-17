import { useEffect, useMemo, useRef, useState } from 'react';
import type { AnnotationPin, StickyNote } from '@shared/types';
import {
  PAGE_NOTE_ICON_SIZE,
  pinPositionFromDrag,
  pinRectForNote,
} from '../lib/sticky-note-geometry';
import type { Point } from '../lib/sticky-note-geometry';

/** Movement beyond this many pixels turns a click into a drag. */
const DRAG_THRESHOLD = 3;

interface DragState {
  note: StickyNote;
  pointerId: number;
  startClientX: number;
  startClientY: number;
  /** Pointer position minus the button's top-left corner at pointerdown. */
  grabOffset: Point;
  moved: boolean;
  /** Latest normalized pin; null until the drag threshold is crossed. */
  pin: Point | null;
}

interface DragPreview {
  noteId: number;
  x: number;
  y: number;
}

export interface AnnotationPinsProps {
  notes: StickyNote[];
  pageWidth: number;
  pageHeight: number;
  activeNoteId: number | null;
  disabled: boolean;
  onOpen(note: StickyNote): void;
  onMove(note: StickyNote, pin: AnnotationPin): Promise<boolean>;
}

/**
 * Page-margin pin layer above the text layer. The container ignores pointer
 * events; only the pin buttons are interactive. A press that moves more than a
 * few pixels drags the pin, a plain click opens the note. Each page numbers its
 * visible note pins from 1 in creation order, so the number stays stable when
 * a pin is dragged.
 */
export function AnnotationPins({
  notes,
  pageWidth,
  pageHeight,
  activeNoteId,
  disabled,
  onOpen,
  onMove,
}: AnnotationPinsProps): React.JSX.Element {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const dragSeqRef = useRef(0);
  const [dragPreview, setDragPreview] = useState<DragPreview | null>(null);

  // A drag that ends with the pointer outside the 20px pin still produces a
  // compatibility mouseup under the drop point. That mouseup must never reach
  // PdfViewer's text-mark hit test, so one window-level capture listener is
  // armed on primary pointerdown and disarmed by that mouseup (or cleanup).
  const mouseUpHandlerRef = useRef<((event: MouseEvent) => void) | null>(null);
  const mouseUpCleanupTimerRef = useRef<number | null>(null);

  const clearMouseUpSuppressor = (): void => {
    const handler = mouseUpHandlerRef.current;
    if (handler !== null) {
      window.removeEventListener('mouseup', handler, true);
      mouseUpHandlerRef.current = null;
    }
    if (mouseUpCleanupTimerRef.current !== null) {
      window.clearTimeout(mouseUpCleanupTimerRef.current);
      mouseUpCleanupTimerRef.current = null;
    }
  };

  const suppressNextMouseUp = (): void => {
    clearMouseUpSuppressor();
    const handler = (event: MouseEvent): void => {
      event.stopPropagation();
      clearMouseUpSuppressor();
    };
    mouseUpHandlerRef.current = handler;
    window.addEventListener('mouseup', handler, true);
  };

  // Browsers that do not synthesize a compatibility mouseup (some touch and
  // pen paths) must not leave the suppressor armed for an unrelated gesture.
  const scheduleMouseUpSuppressorCleanup = (): void => {
    if (mouseUpHandlerRef.current === null) {
      return;
    }
    if (mouseUpCleanupTimerRef.current !== null) {
      window.clearTimeout(mouseUpCleanupTimerRef.current);
    }
    mouseUpCleanupTimerRef.current = window.setTimeout(() => {
      mouseUpCleanupTimerRef.current = null;
      clearMouseUpSuppressor();
    }, 0);
  };

  useEffect(
    () => () => {
      clearMouseUpSuppressor();
    },
    [],
  );

  // Drawing mode (Task 14) may disable the layer mid-gesture; never leave a
  // half-finished drag behind for the next pointerdown.
  useEffect(() => {
    if (!disabled) {
      return;
    }
    dragRef.current = null;
    setDragPreview(null);
  }, [disabled]);

  // Default-stack slots follow the exported /Text order: every page-anchored
  // note occupies a slot, even one whose visible pin overrides the position.
  const stackIndexByNoteId = useMemo(() => {
    const pageNotes = notes
      .filter((note) => note.kind === 'note' && note.anchor.kind === 'page')
      .sort((a, b) => a.createdAt - b.createdAt || a.id - b.id);
    const indices = new Map<number, number>();
    pageNotes.forEach((note, index) => {
      indices.set(note.id, index);
    });
    return indices;
  }, [notes]);

  // Only visible pins are numbered, so the icons on a page read 1..N without
  // gaps even when some notes hide their pin.
  const ordinalByNoteId = useMemo(() => {
    const pageSize = { width: pageWidth, height: pageHeight };
    const numbered = notes
      .filter((note) => note.kind === 'note')
      .sort((a, b) => a.createdAt - b.createdAt || a.id - b.id)
      .filter(
        (note) =>
          pinRectForNote(
            note,
            pageSize,
            stackIndexByNoteId.get(note.id) ?? 0,
          ) !== null,
      );
    return new Map(numbered.map((note, index) => [note.id, index + 1]));
  }, [notes, pageWidth, pageHeight, stackIndexByNoteId]);

  const releaseCapture = (
    element: HTMLButtonElement,
    pointerId: number,
  ): void => {
    try {
      if (element.hasPointerCapture(pointerId)) {
        element.releasePointerCapture(pointerId);
      }
    } catch {
      // Capture may already be gone after pointercancel or an implicit release.
    }
  };

  const handlePointerDown = (
    note: StickyNote,
    event: React.PointerEvent<HTMLButtonElement>,
  ): void => {
    if (disabled || event.button !== 0) {
      return;
    }
    event.stopPropagation();
    // Without this the press could start a text selection under the icon.
    event.preventDefault();
    if (dragRef.current !== null) {
      return;
    }
    suppressNextMouseUp();
    const rect = event.currentTarget.getBoundingClientRect();
    dragSeqRef.current += 1;
    dragRef.current = {
      note,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      grabOffset: {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      },
      moved: false,
      pin: null,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (
    event: React.PointerEvent<HTMLButtonElement>,
  ): void => {
    const drag = dragRef.current;
    if (drag === null || drag.pointerId !== event.pointerId) {
      return;
    }
    if (
      disabled ||
      !event.currentTarget.hasPointerCapture(event.pointerId) ||
      (event.buttons & 1) === 0
    ) {
      // The gesture lost its capture or its primary button; abort silently.
      dragRef.current = null;
      setDragPreview(null);
      return;
    }
    if (!drag.moved) {
      const distance = Math.hypot(
        event.clientX - drag.startClientX,
        event.clientY - drag.startClientY,
      );
      if (distance <= DRAG_THRESHOLD) {
        return;
      }
      drag.moved = true;
    }
    const root = rootRef.current;
    if (root === null) {
      return;
    }
    const bounds = root.getBoundingClientRect();
    const pin = pinPositionFromDrag(
      { left: 0, top: 0, width: pageWidth, height: pageHeight },
      { x: event.clientX - bounds.left, y: event.clientY - bounds.top },
      drag.grabOffset,
    );
    drag.pin = pin;
    setDragPreview({ noteId: drag.note.id, x: pin.x, y: pin.y });
  };

  const handlePointerUp = (
    event: React.PointerEvent<HTMLButtonElement>,
  ): void => {
    const drag = dragRef.current;
    if (drag === null || drag.pointerId !== event.pointerId) {
      return;
    }
    event.stopPropagation();
    dragRef.current = null;
    releaseCapture(event.currentTarget, event.pointerId);
    // The compatibility mouseup follows this dispatch; keep the suppressor
    // armed for it, then drop it if the browser never synthesizes one.
    scheduleMouseUpSuppressorCleanup();
    if (disabled) {
      setDragPreview(null);
      return;
    }
    if (!drag.moved || drag.pin === null) {
      setDragPreview(null);
      onOpen(drag.note);
      return;
    }
    const pin = drag.pin;
    const seq = dragSeqRef.current;
    const clearPreview = (): void => {
      // Keep the optimistic position until the write settles, but never clear
      // a preview that belongs to a newer drag.
      if (dragSeqRef.current === seq) {
        setDragPreview(null);
      }
    };
    // The store's update already surfaces failures in its error bar; either
    // way the icon falls back to the saved position.
    void onMove(drag.note, { x: pin.x, y: pin.y, visible: true }).then(
      clearPreview,
      clearPreview,
    );
  };

  const handlePointerCancel = (
    event: React.PointerEvent<HTMLButtonElement>,
  ): void => {
    const drag = dragRef.current;
    if (drag !== null && drag.pointerId !== event.pointerId) {
      return;
    }
    if (drag !== null) {
      event.stopPropagation();
      dragRef.current = null;
      releaseCapture(event.currentTarget, event.pointerId);
      setDragPreview(null);
    }
    // A canceled pointer never produces a compatibility mouseup; disarming
    // also covers a gesture already cleared by the disabled transition.
    clearMouseUpSuppressor();
  };

  // A UA-initiated capture release (focus loss, the button becoming disabled,
  // or an implicit release after a click) must never leave dragRef set: a
  // stale record would block every later press or replay an old drag.
  const handleLostPointerCapture = (
    event: React.PointerEvent<HTMLButtonElement>,
  ): void => {
    const drag = dragRef.current;
    if (drag === null || drag.pointerId !== event.pointerId) {
      return;
    }
    dragRef.current = null;
    setDragPreview(null);
  };

  const handleMouseDown = (event: React.MouseEvent<HTMLButtonElement>): void => {
    if (disabled) {
      return;
    }
    // A synthesized mousedown must not start a text selection either.
    event.preventDefault();
  };

  const handleMouseUp = (event: React.MouseEvent<HTMLButtonElement>): void => {
    if (disabled) {
      return;
    }
    // A pointerup's stopPropagation does not suppress the synthesized mouseup;
    // without this PdfViewer's page-level mouseup would hit-test the mark below.
    event.stopPropagation();
  };

  const handleClick = (
    note: StickyNote,
    event: React.MouseEvent<HTMLButtonElement>,
  ): void => {
    if (disabled) {
      return;
    }
    event.stopPropagation();
    // Keyboard activation is handled in onKeyDown. `detail === 0` covers
    // assistive-technology and programmatic clicks; pointer clicks carry a
    // click count and were already handled by pointerup, so they never double
    // open.
    if (event.detail === 0) {
      onOpen(note);
    }
  };

  const handleKeyDown = (
    note: StickyNote,
    event: React.KeyboardEvent<HTMLButtonElement>,
  ): void => {
    if (disabled) {
      return;
    }
    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }
    // Cancel the native button activation (and Space scrolling) and open here.
    event.preventDefault();
    event.stopPropagation();
    onOpen(note);
  };

  const pageSize = { width: pageWidth, height: pageHeight };

  return (
    <div
      ref={rootRef}
      className={
        disabled ? 'annotation-pins annotation-pins--disabled' : 'annotation-pins'
      }
    >
      {notes.map((note) => {
        if (note.kind !== 'note') {
          return null;
        }
        const pin = pinRectForNote(
          note,
          pageSize,
          stackIndexByNoteId.get(note.id) ?? 0,
        );
        if (pin === null) {
          return null;
        }
        const preview =
          dragPreview !== null && dragPreview.noteId === note.id
            ? dragPreview
            : null;
        const left = preview === null ? pin.left : preview.x * pageWidth;
        const top = preview === null ? pin.top : preview.y * pageHeight;
        const ordinal = ordinalByNoteId.get(note.id) ?? 0;
        return (
          <button
            key={note.id}
            type="button"
            className="annotation-pin"
            data-sticky-note-id={note.id}
            data-active={note.id === activeNoteId}
            aria-label={`第 ${note.pageNo} 页便签 ${ordinal}`}
            disabled={disabled}
            style={{
              left: `${left}px`,
              top: `${top}px`,
            }}
            onPointerDown={(event) => handlePointerDown(note, event)}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerCancel}
            onLostPointerCapture={handleLostPointerCapture}
            onMouseDown={handleMouseDown}
            onMouseUp={handleMouseUp}
            onClick={(event) => handleClick(note, event)}
            onKeyDown={(event) => handleKeyDown(note, event)}
          >
            <svg
              viewBox="0 0 20 20"
              width={PAGE_NOTE_ICON_SIZE}
              height={PAGE_NOTE_ICON_SIZE}
              aria-hidden="true"
            >
              <path
                className="annotation-pin-bubble"
                d="M3.6 2.4h12.8a2 2 0 0 1 2 2v7.2a2 2 0 0 1-2 2h-6.6l-4.4 4v-4H3.6a2 2 0 0 1-2-2V4.4a2 2 0 0 1 2-2Z"
              />
              <text
                className="annotation-pin-number"
                x="10"
                y="8"
                textAnchor="middle"
                dominantBaseline="central"
              >
                {ordinal}
              </text>
            </svg>
          </button>
        );
      })}
    </div>
  );
}
