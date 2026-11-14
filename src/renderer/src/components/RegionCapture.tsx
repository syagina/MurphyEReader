import { useEffect, useRef, useState } from 'react';
import { normalizeRect } from '../lib/screenshot';
import type { Rect } from '../lib/screenshot';

export interface RegionCaptureProps {
  /** Receives the drag rectangle in viewport/client coordinates. */
  onSelect(rect: Rect): void;
  /** Esc, a right/non-left press or a sub-5px drag cancels the capture. */
  onCancel(): void;
}

const MIN_CAPTURE_PX = 5;

/**
 * Full-window overlay that turns a mouse drag into a client-coordinate rect.
 * It knows nothing about PDFs or canvases; the caller maps the rect onto its
 * own content.
 */
export function RegionCapture({ onSelect, onCancel }: RegionCaptureProps): React.JSX.Element {
  const [rect, setRect] = useState<Rect | null>(null);
  const [dragging, setDragging] = useState(false);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const finishedRef = useRef(false);
  // Keep the latest callbacks without re-binding window listeners mid-drag.
  const callbacksRef = useRef({ onSelect, onCancel });
  callbacksRef.current = { onSelect, onCancel };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') {
        return;
      }
      event.preventDefault();
      callbacksRef.current.onCancel();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    if (!dragging) {
      return;
    }
    const handleMouseMove = (event: MouseEvent): void => {
      const start = startRef.current;
      if (start === null) {
        return;
      }
      setRect(normalizeRect(start, { x: event.clientX, y: event.clientY }));
    };
    const handleMouseUp = (event: MouseEvent): void => {
      if (finishedRef.current) {
        return;
      }
      finishedRef.current = true;
      setDragging(false);
      const start = startRef.current;
      if (start === null) {
        callbacksRef.current.onCancel();
        return;
      }
      const finalRect = normalizeRect(start, { x: event.clientX, y: event.clientY });
      if (finalRect.width < MIN_CAPTURE_PX || finalRect.height < MIN_CAPTURE_PX) {
        callbacksRef.current.onCancel();
        return;
      }
      setRect(finalRect);
      callbacksRef.current.onSelect(finalRect);
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragging]);

  const handleMouseDown = (event: React.MouseEvent<HTMLDivElement>): void => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    finishedRef.current = false;
    startRef.current = { x: event.clientX, y: event.clientY };
    setRect({ x: event.clientX, y: event.clientY, width: 0, height: 0 });
    setDragging(true);
  };

  return (
    <div
      className="region-capture"
      role="presentation"
      data-testid="region-capture"
      onMouseDown={handleMouseDown}
    >
      <div className="region-capture-hint">拖拽框选页面区域，Esc 取消</div>
      {rect !== null && rect.width > 0 && rect.height > 0 && (
        <div
          className="region-capture-rect"
          style={{
            left: rect.x,
            top: rect.y,
            width: rect.width,
            height: rect.height,
          }}
        />
      )}
    </div>
  );
}
