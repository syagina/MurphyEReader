/**
 * Pure geometry for exporting annotations from a rotated PDF page.
 *
 * Annotations are stored in normalized display-page coordinates whose origin
 * is the top-left corner of the page as shown in the app. PDF user space uses
 * the page box origin at the bottom-left, so export has to invert the page
 * rotation. The formulas match pdf.js `PageViewport.convertToPdfPoint`.
 */

/** A page rotation supported by the export path. */
export type Rotation = 0 | 90 | 180 | 270;

/** A rectangle in PDF user space, or a normalized display rectangle. */
export interface PageRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type PdfPoint = [number, number];

export type PdfQuad = [PdfPoint, PdfPoint, PdfPoint, PdfPoint];

/**
 * Normalizes a page's `/Rotate` angle to one of the four supported
 * orientations. Any finite multiple of 90° is accepted modulo 360 (so 360°
 * becomes 0° and -90° becomes 270°); everything else warns and falls back to
 * 0°, per design §7.
 */
export function normalizeRotation(angle: number): Rotation {
  if (Number.isFinite(angle)) {
    const normalized = ((angle % 360) + 360) % 360;
    if (normalized === 0 || normalized === 90 || normalized === 180 || normalized === 270) {
      return normalized;
    }
  }
  console.warn(`不支持的页面旋转角度 ${angle}°，按 0° 处理`);
  return 0;
}

/**
 * Maps a normalized display-page point (origin top-left, y downward) to PDF
 * user space for the given page rotation.
 */
export function displayNormalizedToPdfPoint(
  rect: PageRect,
  rotation: Rotation,
  point: readonly [number, number],
): PdfPoint {
  const [nx, ny] = point;
  const { x, y, width, height } = rect;
  switch (rotation) {
    case 0:
      return [x + nx * width, y + height * (1 - ny)];
    case 90:
      return [x + ny * width, y + nx * height];
    case 180:
      return [x + width * (1 - nx), y + ny * height];
    case 270:
      return [x + width * (1 - ny), y + height * (1 - nx)];
  }
}

/**
 * Maps a normalized display rectangle to its four PDF corners in QuadPoints
 * order: display top-left, top-right, bottom-left, bottom-right. Note that the
 * mapped points are not necessarily axis-sorted; use `quadToRect` for `/Rect`.
 */
export function displayRectToPdfQuad(
  rect: PageRect,
  rotation: Rotation,
  noteRect: PageRect,
): PdfQuad {
  const left = noteRect.x;
  const right = noteRect.x + noteRect.width;
  const top = noteRect.y;
  const bottom = noteRect.y + noteRect.height;
  return [
    displayNormalizedToPdfPoint(rect, rotation, [left, top]),
    displayNormalizedToPdfPoint(rect, rotation, [right, top]),
    displayNormalizedToPdfPoint(rect, rotation, [left, bottom]),
    displayNormalizedToPdfPoint(rect, rotation, [right, bottom]),
  ];
}

/** Axis-aligned bounding box of a quad, as required by the annotation `/Rect`. */
export function quadToRect(quad: readonly (readonly [number, number])[]): PageRect {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const [px, py] of quad) {
    minX = Math.min(minX, px);
    minY = Math.min(minY, py);
    maxX = Math.max(maxX, px);
    maxY = Math.max(maxY, py);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** The page size as displayed, which swaps width and height at 90°/270°. */
export function displayPageSize(
  rect: PageRect,
  rotation: Rotation,
): { width: number; height: number } {
  return rotation === 90 || rotation === 270
    ? { width: rect.height, height: rect.width }
    : { width: rect.width, height: rect.height };
}
