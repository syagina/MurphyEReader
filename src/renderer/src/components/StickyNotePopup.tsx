import { useRef, useState } from 'react';
import type { StickyNote } from '@shared/types';
import { normalizedPopupPosition } from '../lib/sticky-note-geometry';
import { MarkdownView } from './MarkdownView';

export interface StickyNotePopupProps {
  note: StickyNote;
  /** Viewport coordinates of the card's top-left. */
  top: number;
  left: number;
  onClose(): void;
  onEdit(): void;
  onDelete(): void;
  onMoveFree(x: number, y: number): Promise<void>;
}

/** Local drag tracking; `left`/`top` are viewport coordinates of the card. */
interface DragState {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startLeft: number;
  startTop: number;
  left: number;
  top: number;
}

interface DragPreview {
  left: number;
  top: number;
}

const DRAG_IGNORE_SELECTOR = 'button, select, input, textarea';

/**
 * Floating annotation card in read-only view mode: it shows the quoted text,
 * the note body and only the 编辑 / 关闭 / 删除 actions. Mark style, colour,
 * page-edge pin and popup placement are edited in the edit dialog, which the
 * 编辑 button opens. The title bar always drags the card; dropping it stores
 * a free position relative to the reading area so the next open returns there.
 */
export function StickyNotePopup({
  note,
  top,
  left,
  onClose,
  onEdit,
  onDelete,
  onMoveFree,
}: StickyNotePopupProps): React.JSX.Element {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [dragPreview, setDragPreview] = useState<DragPreview | null>(null);

  const isPureMark = note.kind === 'mark' && note.contentMd.trim() === '';

  const releaseCapture = (
    element: HTMLElement,
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

  const finishDrag = async (drag: DragState): Promise<void> => {
    const readingArea = document.querySelector<HTMLElement>(
      '[data-reading-area]',
    );
    const card = cardRef.current;
    if (readingArea === null || card === null) {
      setDragPreview(null);
      return;
    }
    const bounds = readingArea.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    const position = normalizedPopupPosition(
      drag.left,
      drag.top,
      bounds,
      { width: cardRect.width, height: cardRect.height },
    );
    await onMoveFree(position.x, position.y);
    setDragPreview(null);
  };

  const handlePointerDown = (
    event: React.PointerEvent<HTMLElement>,
  ): void => {
    if (event.button !== 0) {
      return;
    }
    const target = event.target;
    if (
      target instanceof Element &&
      target.closest(DRAG_IGNORE_SELECTOR) !== null
    ) {
      return;
    }
    if (dragRef.current !== null) {
      return;
    }
    // Without this the press could start a text selection in the card.
    event.preventDefault();
    dragRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startLeft: left,
      startTop: top,
      left,
      top,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (
    event: React.PointerEvent<HTMLElement>,
  ): void => {
    const drag = dragRef.current;
    if (drag === null || drag.pointerId !== event.pointerId) {
      return;
    }
    drag.left = drag.startLeft + (event.clientX - drag.startClientX);
    drag.top = drag.startTop + (event.clientY - drag.startClientY);
    setDragPreview({ left: drag.left, top: drag.top });
  };

  const handlePointerUp = (
    event: React.PointerEvent<HTMLElement>,
  ): void => {
    const drag = dragRef.current;
    if (drag === null || drag.pointerId !== event.pointerId) {
      return;
    }
    dragRef.current = null;
    releaseCapture(event.currentTarget, event.pointerId);
    void finishDrag(drag);
  };

  const handlePointerCancel = (
    event: React.PointerEvent<HTMLElement>,
  ): void => {
    const drag = dragRef.current;
    if (drag !== null && drag.pointerId !== event.pointerId) {
      return;
    }
    if (drag !== null) {
      dragRef.current = null;
      releaseCapture(event.currentTarget, event.pointerId);
    }
    setDragPreview(null);
  };

  const handleLostPointerCapture = (
    event: React.PointerEvent<HTMLElement>,
  ): void => {
    const drag = dragRef.current;
    if (drag === null || drag.pointerId !== event.pointerId) {
      return;
    }
    dragRef.current = null;
    setDragPreview(null);
  };

  return (
    <div
      ref={cardRef}
      className="sticky-note-popup"
      role="dialog"
      aria-label="标注"
      style={{
        top: dragPreview?.top ?? top,
        left: dragPreview?.left ?? left,
      }}
    >
      <header
        className="sticky-note-popup-header"
        data-popup-drag-handle="true"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onLostPointerCapture={handleLostPointerCapture}
      >
        <h2 className="sticky-note-popup-title">标注</h2>
      </header>

      {note.quote.trim() !== '' && (
        <blockquote className="sticky-note-popup-quote">{note.quote}</blockquote>
      )}

      {!isPureMark && (
        <div className="sticky-note-popup-content">
          {note.contentMd.trim() === '' ? (
            <p className="sticky-note-popup-empty">（无内容）</p>
          ) : (
            <MarkdownView text={note.contentMd} />
          )}
        </div>
      )}

      <div className="sticky-note-popup-footer">
        <button type="button" className="menu-button" onClick={onEdit}>
          编辑
        </button>
        <button type="button" className="menu-button" onClick={onClose}>
          关闭
        </button>
        <button type="button" className="menu-button danger" onClick={onDelete}>
          删除
        </button>
      </div>
    </div>
  );
}
