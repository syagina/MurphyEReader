import { useId, useMemo, useRef, useState } from 'react';
import type { PDFPageProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type {
  AnnotationDrawing,
  AnnotationShape,
  AnnotationShapeData,
  AnnotationStroke,
  StickyNote,
  StickyNoteRect,
} from '@shared/types';
import {
  HIGHLIGHTER_OPACITY,
  drawingIntersectsRect,
  hitTestDrawing,
  limitPoints,
  pdfNormalizedToDisplay,
  screenPointToPdfNormalized,
  simplifyPoints,
} from '../lib/annotation-drawing';
import type { DrawingTool, PdfViewportLike } from '../lib/annotation-drawing';

/** 绘制模式的全部输入与回调；由 PdfViewer 持有状态，逐页下发。 */
export interface PdfDrawingConfig {
  enabled: boolean;
  tool: DrawingTool;
  color: string;
  width: number;
  notes: StickyNote[];
  onCommitStroke(stroke: AnnotationStroke): Promise<boolean>;
  onCommitShape(shape: AnnotationShapeData): Promise<boolean>;
  onErase(notes: StickyNote[]): Promise<void>;
}

export interface DrawingLayerProps {
  notes: StickyNote[];
  pageWidth: number;
  pageHeight: number;
  rotation: number;
  zoom: number;
}

export type DrawingCaptureLayerProps = PdfDrawingConfig & {
  page: PDFPageProxy;
  zoom: number;
};

/** PDF 归一化点 → 显示页面 CSS 像素。 */
function displayPoint(
  point: readonly [number, number],
  rotation: number,
  pageWidth: number,
  pageHeight: number,
): [number, number] {
  const [x, y] = pdfNormalizedToDisplay(point, rotation);
  return [x * pageWidth, y * pageHeight];
}

interface DrawingElementProps {
  drawing: AnnotationDrawing;
  rotation: number;
  pageWidth: number;
  pageHeight: number;
  zoom: number;
  /** Unique per stored note (or per capture layer for the transient draft). */
  markerId: string;
}

/**
 * One stored or draft drawing in display coordinates. Strokes become a
 * polyline, shapes become the matching SVG element, and an arrow adds a
 * marker whose polygon is explicitly filled with the drawing colour (a
 * marker cannot inherit `currentColor` from the line it decorates).
 */
function DrawingElement({
  drawing,
  rotation,
  pageWidth,
  pageHeight,
  zoom,
  markerId,
}: DrawingElementProps): React.JSX.Element {
  const stroke = drawing.color;
  const strokeWidth = drawing.width * zoom;
  if ('tool' in drawing) {
    const points = drawing.points
      .map((point) => {
        const [x, y] = displayPoint(point, rotation, pageWidth, pageHeight);
        return `${x},${y}`;
      })
      .join(' ');
    return (
      <polyline
        points={points}
        fill="none"
        stroke={stroke}
        strokeWidth={strokeWidth}
        opacity={drawing.opacity}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    );
  }

  const [startX, startY] = displayPoint(
    drawing.start,
    rotation,
    pageWidth,
    pageHeight,
  );
  const [endX, endY] = displayPoint(
    drawing.end,
    rotation,
    pageWidth,
    pageHeight,
  );

  switch (drawing.shape) {
    case 'line':
      return (
        <line
          x1={startX}
          y1={startY}
          x2={endX}
          y2={endY}
          stroke={stroke}
          strokeWidth={strokeWidth}
          opacity={drawing.opacity}
          strokeLinecap="round"
        />
      );
    case 'arrow':
      return (
        <g>
          <defs>
            <marker
              id={markerId}
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              markerUnits="strokeWidth"
              orient="auto"
            >
              <polygon points="0,0 10,5 0,10" fill={drawing.color} />
            </marker>
          </defs>
          <line
            x1={startX}
            y1={startY}
            x2={endX}
            y2={endY}
            stroke={stroke}
            strokeWidth={strokeWidth}
            opacity={drawing.opacity}
            strokeLinecap="round"
            markerEnd={`url(#${markerId})`}
          />
        </g>
      );
    case 'rect':
      return (
        <rect
          x={Math.min(startX, endX)}
          y={Math.min(startY, endY)}
          width={Math.abs(endX - startX)}
          height={Math.abs(endY - startY)}
          fill="none"
          stroke={stroke}
          strokeWidth={strokeWidth}
          opacity={drawing.opacity}
        />
      );
    case 'ellipse':
      return (
        <ellipse
          cx={(startX + endX) / 2}
          cy={(startY + endY) / 2}
          rx={Math.abs(endX - startX) / 2}
          ry={Math.abs(endY - startY) / 2}
          fill="none"
          stroke={stroke}
          strokeWidth={strokeWidth}
          opacity={drawing.opacity}
        />
      );
  }
}

/**
 * Stored ink/shape records for one page, above the text layer and below the
 * pin layer. Corrupt rows whose drawing failed to parse are skipped.
 */
export function DrawingLayer({
  notes,
  pageWidth,
  pageHeight,
  rotation,
  zoom,
}: DrawingLayerProps): React.JSX.Element {
  return (
    <svg
      className="annotation-drawing-layer"
      width={pageWidth}
      height={pageHeight}
    >
      {notes.map((note) =>
        note.drawing === null ? null : (
          <DrawingElement
            key={note.id}
            drawing={note.drawing}
            rotation={rotation}
            pageWidth={pageWidth}
            pageHeight={pageHeight}
            zoom={zoom}
            markerId={`annotation-arrow-${note.id}`}
          />
        ),
      )}
    </svg>
  );
}

type StrokeDraft = {
  kind: 'stroke';
  tool: 'pen' | 'highlighter';
  points: Array<[number, number]>;
};

type ShapeDraft = {
  kind: 'shape';
  shape: AnnotationShape;
  start: [number, number];
  end: [number, number];
};

type MarqueeDraft = {
  kind: 'marquee';
  start: [number, number];
  end: [number, number];
};

type Draft = StrokeDraft | ShapeDraft | MarqueeDraft;

interface Gesture {
  pointerId: number;
  tool: DrawingTool;
  startClientX: number;
  startClientY: number;
  start: [number, number];
  points: Array<[number, number]>;
}

/** Shape tools map one-to-one onto `AnnotationShape`; others are not shapes. */
function shapeForTool(tool: DrawingTool): AnnotationShape | null {
  return tool === 'line' || tool === 'rect' || tool === 'ellipse' || tool === 'arrow'
    ? tool
    : null;
}

/**
 * Transparent capture surface above the page. Only the primary button starts
 * a gesture; the pointer is captured so a drag that leaves the page keeps
 * producing move/up events. Wheel events are never handled, so scrolling
 * through the drawing layer keeps working.
 */
export function DrawingCaptureLayer({
  enabled,
  tool,
  color,
  width,
  notes,
  onCommitStroke,
  onCommitShape,
  onErase,
  page,
  zoom,
}: DrawingCaptureLayerProps): React.JSX.Element | null {
  const [draft, setDraft] = useState<Draft | null>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const markerPrefix = useId().replace(/[^a-zA-Z0-9_-]/g, '') || 'draft';

  // pdf.js types the viewBox as number[]; rebuild the tuple the pure
  // coordinate helper requires, defaulting a malformed box to zeroes.
  const viewport = useMemo<PdfViewportLike>(() => {
    const raw = page.getViewport({ scale: zoom });
    const [viewX = 0, viewY = 0, viewWidth = 0, viewHeight = 0] = raw.viewBox;
    return {
      width: raw.width,
      height: raw.height,
      viewBox: [viewX, viewY, viewWidth, viewHeight],
      convertToPdfPoint: (x, y) => {
        const pdfPoint = raw.convertToPdfPoint(x, y) as number[];
        return [pdfPoint[0] ?? 0, pdfPoint[1] ?? 0];
      },
    };
  }, [page, zoom]);

  const pointFromEvent = (
    event: React.PointerEvent<HTMLDivElement>,
  ): [number, number] => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return screenPointToPdfNormalized(
      viewport,
      event.clientX - bounds.left,
      event.clientY - bounds.top,
    );
  };

  const releaseCapture = (
    element: HTMLDivElement,
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
    event: React.PointerEvent<HTMLDivElement>,
  ): void => {
    if (event.button !== 0 || gestureRef.current !== null) {
      return;
    }
    // A press must never start a text selection under the capture layer.
    event.preventDefault();
    const point = pointFromEvent(event);

    if (tool === 'eraser') {
      const toleranceBase = Math.min(viewport.width, viewport.height);
      for (let index = notes.length - 1; index >= 0; index -= 1) {
        const note = notes[index];
        const drawing = note.drawing;
        if (drawing === null) {
          continue;
        }
        const tolerance =
          (6 + (drawing.width * zoom) / 2) / toleranceBase;
        if (hitTestDrawing(drawing, point, tolerance)) {
          void onErase([note]);
          return;
        }
      }
      // Nothing hit: the press starts a marquee selection rectangle.
      gestureRef.current = {
        pointerId: event.pointerId,
        tool,
        startClientX: event.clientX,
        startClientY: event.clientY,
        start: point,
        points: [],
      };
      setDraft({ kind: 'marquee', start: point, end: point });
    } else if (tool === 'pen' || tool === 'highlighter') {
      gestureRef.current = {
        pointerId: event.pointerId,
        tool,
        startClientX: event.clientX,
        startClientY: event.clientY,
        start: point,
        points: [point],
      };
      setDraft({ kind: 'stroke', tool, points: [point] });
    } else {
      const shape = shapeForTool(tool);
      if (shape === null) {
        return;
      }
      gestureRef.current = {
        pointerId: event.pointerId,
        tool,
        startClientX: event.clientX,
        startClientY: event.clientY,
        start: point,
        points: [],
      };
      setDraft({ kind: 'shape', shape, start: point, end: point });
    }
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (
    event: React.PointerEvent<HTMLDivElement>,
  ): void => {
    const gesture = gestureRef.current;
    if (gesture === null || gesture.pointerId !== event.pointerId) {
      return;
    }
    const point = pointFromEvent(event);
    if (gesture.tool === 'pen' || gesture.tool === 'highlighter') {
      gesture.points.push(point);
      setDraft({ kind: 'stroke', tool: gesture.tool, points: [...gesture.points] });
      return;
    }
    if (gesture.tool === 'eraser') {
      setDraft({ kind: 'marquee', start: gesture.start, end: point });
      return;
    }
    const shape = shapeForTool(gesture.tool);
    if (shape === null) {
      return;
    }
    setDraft({ kind: 'shape', shape, start: gesture.start, end: point });
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>): void => {
    const gesture = gestureRef.current;
    if (gesture === null || gesture.pointerId !== event.pointerId) {
      return;
    }
    gestureRef.current = null;
    releaseCapture(event.currentTarget, event.pointerId);
    // A rejected commit (store failure) still leaves no local-only stroke.
    setDraft(null);
    const point = pointFromEvent(event);

    if (gesture.tool === 'pen' || gesture.tool === 'highlighter') {
      // The release point is the true end of the stroke; a fast release can
      // arrive without a final move event. A press/release at the same point
      // adds nothing, so a click still commits no stroke.
      const last = gesture.points[gesture.points.length - 1];
      if (
        last === undefined ||
        last[0] !== point[0] ||
        last[1] !== point[1]
      ) {
        gesture.points.push(point);
      }
      const points = limitPoints(simplifyPoints(gesture.points));
      if (points.length < 2) {
        return;
      }
      void onCommitStroke({
        tool: gesture.tool,
        color,
        width,
        opacity: gesture.tool === 'highlighter' ? HIGHLIGHTER_OPACITY : 1,
        points,
      });
      return;
    }

    if (gesture.tool === 'eraser') {
      const selectionRect: StickyNoteRect = {
        x: Math.min(gesture.start[0], point[0]),
        y: Math.min(gesture.start[1], point[1]),
        width: Math.abs(point[0] - gesture.start[0]),
        height: Math.abs(point[1] - gesture.start[1]),
      };
      const hits = notes.filter(
        (note) =>
          note.drawing !== null &&
          drawingIntersectsRect(note.drawing, selectionRect),
      );
      if (hits.length > 0) {
        void onErase(hits);
      }
      return;
    }

    const shape = shapeForTool(gesture.tool);
    if (shape === null) {
      return;
    }
    // A press that moved no further than 2px is a click, not a shape.
    const distance = Math.hypot(
      event.clientX - gesture.startClientX,
      event.clientY - gesture.startClientY,
    );
    if (distance <= 2) {
      return;
    }
    void onCommitShape({
      shape,
      color,
      width,
      opacity: 1,
      start: gesture.start,
      end: point,
    });
  };

  const handlePointerCancel = (
    event: React.PointerEvent<HTMLDivElement>,
  ): void => {
    const gesture = gestureRef.current;
    if (gesture === null || gesture.pointerId !== event.pointerId) {
      return;
    }
    gestureRef.current = null;
    releaseCapture(event.currentTarget, event.pointerId);
    setDraft(null);
  };

  // A UA-initiated release (focus loss, unmount, or the element becoming
  // inert) discards the draft without committing, same as pointercancel.
  const handleLostPointerCapture = (
    event: React.PointerEvent<HTMLDivElement>,
  ): void => {
    const gesture = gestureRef.current;
    if (gesture === null || gesture.pointerId !== event.pointerId) {
      return;
    }
    gestureRef.current = null;
    setDraft(null);
  };

  if (!enabled) {
    return null;
  }

  const marquee =
    draft?.kind === 'marquee'
      ? (() => {
          const [startX, startY] = displayPoint(
            draft.start,
            page.rotate,
            viewport.width,
            viewport.height,
          );
          const [endX, endY] = displayPoint(
            draft.end,
            page.rotate,
            viewport.width,
            viewport.height,
          );
          return {
            x: Math.min(startX, endX),
            y: Math.min(startY, endY),
            width: Math.abs(endX - startX),
            height: Math.abs(endY - startY),
          };
        })()
      : null;

  return (
    <div
      className="drawing-capture-layer"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onLostPointerCapture={handleLostPointerCapture}
    >
      {draft !== null && (
        <svg
          className="annotation-drawing-draft"
          width={viewport.width}
          height={viewport.height}
          style={{ pointerEvents: 'none' }}
        >
          {draft.kind === 'stroke' && (
            <polyline
              points={draft.points
                .map((point) => {
                  const [x, y] = displayPoint(
                    point,
                    page.rotate,
                    viewport.width,
                    viewport.height,
                  );
                  return `${x},${y}`;
                })
                .join(' ')}
              fill="none"
              stroke={color}
              strokeWidth={width * zoom}
              opacity={
                draft.tool === 'highlighter' ? HIGHLIGHTER_OPACITY : 1
              }
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
          {draft.kind === 'shape' && (
            <DrawingElement
              drawing={{
                shape: draft.shape,
                color,
                width,
                opacity: 1,
                start: draft.start,
                end: draft.end,
              }}
              rotation={page.rotate}
              pageWidth={viewport.width}
              pageHeight={viewport.height}
              zoom={zoom}
              markerId={`annotation-draft-arrow-${markerPrefix}`}
            />
          )}
          {marquee !== null && (
            <rect
              x={marquee.x}
              y={marquee.y}
              width={marquee.width}
              height={marquee.height}
              fill="rgba(37, 99, 235, 0.12)"
              stroke="#2563eb"
              strokeWidth={1}
              strokeDasharray="4 4"
            />
          )}
        </svg>
      )}
    </div>
  );
}
