import type { AnnotationDrawing, StickyNoteRect } from '@shared/types';

/** 绘制工具栏当前选中的工具；橡皮不属于落笔记录。 */
export type DrawingTool =
  | 'pen'
  | 'highlighter'
  | 'line'
  | 'rect'
  | 'ellipse'
  | 'arrow'
  | 'eraser';

/** 荧光笔固定使用的透明度。 */
export const HIGHLIGHTER_OPACITY = 0.35;

/** 单条自由笔迹允许保存的最多点数。 */
export const MAX_STROKE_POINTS = 4000;

/** 椭圆命中与框选时使用的边界采样数。 */
const ELLIPSE_SAMPLES = 64;

/** 判断交点几何时把足够小的叉积视为共线。 */
const COLLINEAR_EPSILON = 1e-12;

/** 带 `tool` 的是自由笔迹，否则是几何图形。 */
export function drawingKind(drawing: AnnotationDrawing): 'ink' | 'shape' {
  return 'tool' in drawing ? 'ink' : 'shape';
}

function copyPoint(point: readonly [number, number]): [number, number] {
  return [point[0], point[1]];
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** 非有限坐标归零，其余夹紧到 [0,1]。 */
export function clampNormalizedPoint(
  point: readonly [number, number],
): [number, number] {
  const x = Number.isFinite(point[0]) ? clamp01(point[0]) : 0;
  const y = Number.isFinite(point[1]) ? clamp01(point[1]) : 0;
  return [x, y];
}

/** 点到线段的最短距离；退化线段等价于到端点的距离。 */
export function distanceToSegment(
  point: readonly [number, number],
  start: readonly [number, number],
  end: readonly [number, number],
): number {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) {
    return Math.hypot(point[0] - start[0], point[1] - start[1]);
  }
  const projected =
    ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared;
  const t = Math.min(1, Math.max(0, projected));
  return Math.hypot(
    point[0] - (start[0] + t * dx),
    point[1] - (start[1] + t * dy),
  );
}

/** 点到折线的最短距离；空折线为 Infinity，单点折线取点距。 */
export function distanceToPolyline(
  points: ReadonlyArray<readonly [number, number]>,
  point: readonly [number, number],
): number {
  if (points.length === 0) {
    return Infinity;
  }
  if (points.length === 1) {
    return Math.hypot(point[0] - points[0][0], point[1] - points[0][1]);
  }
  let minimum = Infinity;
  for (let i = 0; i < points.length - 1; i += 1) {
    minimum = Math.min(
      minimum,
      distanceToSegment(point, points[i], points[i + 1]),
    );
  }
  return minimum;
}

/**
 * 道格拉斯-普克简化：保留首尾，去掉偏离当前弦不超过 `tolerance` 的点。
 * 少于三点原样复制返回；非有限或负容差按 0 处理。
 */
export function simplifyPoints(
  points: ReadonlyArray<readonly [number, number]>,
  tolerance = 0.001,
): Array<[number, number]> {
  const copied = points.map(copyPoint);
  if (copied.length < 3) {
    return copied;
  }
  const epsilon = Number.isFinite(tolerance) && tolerance > 0 ? tolerance : 0;
  const keep = new Array<boolean>(copied.length).fill(false);
  keep[0] = true;
  keep[copied.length - 1] = true;
  const stack: Array<[number, number]> = [[0, copied.length - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop() as [number, number];
    let farthestIndex = -1;
    let farthestDistance = -Infinity;
    for (let i = first + 1; i < last; i += 1) {
      const distance = distanceToSegment(copied[i], copied[first], copied[last]);
      if (distance > farthestDistance) {
        farthestDistance = distance;
        farthestIndex = i;
      }
    }
    if (farthestIndex !== -1 && farthestDistance > epsilon) {
      keep[farthestIndex] = true;
      stack.push([first, farthestIndex], [farthestIndex, last]);
    }
  }
  return copied.filter((_, index) => keep[index]);
}

/**
 * 把点数限制到 `max`：超过时按等步长抽样并保留首尾；
 * `max <= 0` 得到空数组，`max === 1` 只保留首点。
 */
export function limitPoints(
  points: ReadonlyArray<readonly [number, number]>,
  max = MAX_STROKE_POINTS,
): Array<[number, number]> {
  const count = Math.floor(max);
  if (Number.isNaN(count)) {
    return limitPoints(points, MAX_STROKE_POINTS);
  }
  if (count <= 0 || points.length === 0) {
    return [];
  }
  if (count === 1) {
    return [copyPoint(points[0])];
  }
  if (points.length <= count) {
    return points.map(copyPoint);
  }
  const sampled: Array<[number, number]> = [];
  for (let i = 0; i < count; i += 1) {
    const index = Math.round((i * (points.length - 1)) / (count - 1));
    sampled.push(copyPoint(points[index]));
  }
  return sampled;
}

interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

function pointsBounds(
  points: ReadonlyArray<readonly [number, number]>,
): Bounds {
  let minX = points[0][0];
  let maxX = minX;
  let minY = points[0][1];
  let maxY = minY;
  for (const [x, y] of points) {
    if (x < minX) {
      minX = x;
    }
    if (x > maxX) {
      maxX = x;
    }
    if (y < minY) {
      minY = y;
    }
    if (y > maxY) {
      maxY = y;
    }
  }
  return { minX, maxX, minY, maxY };
}

function rectBounds(rect: StickyNoteRect): Bounds {
  const maxX = rect.x + rect.width;
  const maxY = rect.y + rect.height;
  return {
    minX: Math.min(rect.x, maxX),
    maxX: Math.max(rect.x, maxX),
    minY: Math.min(rect.y, maxY),
    maxY: Math.max(rect.y, maxY),
  };
}

function pointInBounds(
  point: readonly [number, number],
  bounds: Bounds,
): boolean {
  return (
    point[0] >= bounds.minX &&
    point[0] <= bounds.maxX &&
    point[1] >= bounds.minY &&
    point[1] <= bounds.maxY
  );
}

function rectEdgeDistance(
  point: readonly [number, number],
  bounds: Bounds,
): number {
  const { minX, maxX, minY, maxY } = bounds;
  return Math.min(
    distanceToSegment(point, [minX, minY], [maxX, minY]),
    distanceToSegment(point, [maxX, minY], [maxX, maxY]),
    distanceToSegment(point, [maxX, maxY], [minX, maxY]),
    distanceToSegment(point, [minX, maxY], [minX, minY]),
  );
}

function cross(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
): number {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

/** 已知 `point` 与线段共线时，判断它是否落在线段范围内。 */
function onSegment(
  start: readonly [number, number],
  end: readonly [number, number],
  point: readonly [number, number],
): boolean {
  return (
    point[0] >= Math.min(start[0], end[0]) &&
    point[0] <= Math.max(start[0], end[0]) &&
    point[1] >= Math.min(start[1], end[1]) &&
    point[1] <= Math.max(start[1], end[1])
  );
}

function segmentsIntersect(
  a: readonly [number, number],
  b: readonly [number, number],
  c: readonly [number, number],
  d: readonly [number, number],
): boolean {
  const o1 = cross(a[0], a[1], b[0], b[1], c[0], c[1]);
  const o2 = cross(a[0], a[1], b[0], b[1], d[0], d[1]);
  const o3 = cross(c[0], c[1], d[0], d[1], a[0], a[1]);
  const o4 = cross(c[0], c[1], d[0], d[1], b[0], b[1]);
  if (
    ((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0)) &&
    ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0))
  ) {
    return true;
  }
  if (Math.abs(o1) <= COLLINEAR_EPSILON && onSegment(a, b, c)) {
    return true;
  }
  if (Math.abs(o2) <= COLLINEAR_EPSILON && onSegment(a, b, d)) {
    return true;
  }
  if (Math.abs(o3) <= COLLINEAR_EPSILON && onSegment(c, d, a)) {
    return true;
  }
  return Math.abs(o4) <= COLLINEAR_EPSILON && onSegment(c, d, b);
}

/** 线段与矩形（含边界）是否相交。 */
function segmentIntersectsBounds(
  a: readonly [number, number],
  b: readonly [number, number],
  bounds: Bounds,
): boolean {
  if (pointInBounds(a, bounds) || pointInBounds(b, bounds)) {
    return true;
  }
  const corners: Array<[number, number]> = [
    [bounds.minX, bounds.minY],
    [bounds.maxX, bounds.minY],
    [bounds.maxX, bounds.maxY],
    [bounds.minX, bounds.maxY],
  ];
  for (let i = 0; i < corners.length; i += 1) {
    const next = corners[(i + 1) % corners.length];
    if (segmentsIntersect(a, b, corners[i], next)) {
      return true;
    }
  }
  return false;
}

interface EllipseGeometry {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

function ellipseGeometry(
  start: readonly [number, number],
  end: readonly [number, number],
): EllipseGeometry {
  return {
    cx: (start[0] + end[0]) / 2,
    cy: (start[1] + end[1]) / 2,
    rx: Math.abs(end[0] - start[0]) / 2,
    ry: Math.abs(end[1] - start[1]) / 2,
  };
}

/** 按固定角度均匀采样椭圆边界；顺序相邻即边界相邻。 */
function ellipseBoundary({
  cx,
  cy,
  rx,
  ry,
}: EllipseGeometry): Array<[number, number]> {
  const boundary: Array<[number, number]> = [];
  for (let i = 0; i < ELLIPSE_SAMPLES; i += 1) {
    const angle = (Math.PI * 2 * i) / ELLIPSE_SAMPLES;
    boundary.push([
      cx + rx * Math.cos(angle),
      cy + ry * Math.sin(angle),
    ]);
  }
  return boundary;
}

/** 笔迹/图形的归一化包围盒；空笔迹返回零矩形。 */
export function annotationBounds(drawing: AnnotationDrawing): StickyNoteRect {
  let bounds: Bounds;
  if ('tool' in drawing) {
    if (drawing.points.length === 0) {
      return { x: 0, y: 0, width: 0, height: 0 };
    }
    bounds = pointsBounds(drawing.points);
  } else {
    bounds = pointsBounds([drawing.start, drawing.end]);
  }
  return {
    x: bounds.minX,
    y: bounds.minY,
    width: bounds.maxX - bounds.minX,
    height: bounds.maxY - bounds.minY,
  };
}

/**
 * 橡皮命中测试。`tolerance` 使用归一化单位，由调用方把屏幕像素
 * 和对象半宽换算进来；负值或非有限值按 0 处理。
 */
export function hitTestDrawing(
  drawing: AnnotationDrawing,
  point: readonly [number, number],
  tolerance: number,
): boolean {
  const tol = Number.isFinite(tolerance) ? Math.max(0, tolerance) : 0;
  if ('tool' in drawing) {
    return distanceToPolyline(drawing.points, point) <= tol;
  }
  switch (drawing.shape) {
    case 'line':
    case 'arrow':
      return distanceToSegment(point, drawing.start, drawing.end) <= tol;
    case 'rect': {
      const bounds = pointsBounds([drawing.start, drawing.end]);
      return pointInBounds(point, bounds) || rectEdgeDistance(point, bounds) <= tol;
    }
    case 'ellipse': {
      const geometry = ellipseGeometry(drawing.start, drawing.end);
      if (geometry.rx <= 0 || geometry.ry <= 0) {
        return distanceToSegment(point, drawing.start, drawing.end) <= tol;
      }
      const normalizedX = (point[0] - geometry.cx) / geometry.rx;
      const normalizedY = (point[1] - geometry.cy) / geometry.ry;
      if (normalizedX * normalizedX + normalizedY * normalizedY <= 1) {
        return true;
      }
      const boundary = ellipseBoundary(geometry);
      return (
        distanceToPolyline(boundary, point) <= tol ||
        distanceToSegment(point, boundary[boundary.length - 1], boundary[0]) <=
          tol
      );
    }
  }
}

/**
 * 框选相交测试，边界接触也算相交。椭圆按 64 个采样点近似：
 * 包围盒不重叠直接排除，否则任一边界点在框内或边界段穿框即相交。
 */
export function drawingIntersectsRect(
  drawing: AnnotationDrawing,
  rect: StickyNoteRect,
): boolean {
  const bounds = rectBounds(rect);
  if ('tool' in drawing) {
    const { points } = drawing;
    for (const point of points) {
      if (pointInBounds(point, bounds)) {
        return true;
      }
    }
    for (let i = 0; i < points.length - 1; i += 1) {
      if (segmentIntersectsBounds(points[i], points[i + 1], bounds)) {
        return true;
      }
    }
    return false;
  }
  switch (drawing.shape) {
    case 'line':
    case 'arrow':
      return segmentIntersectsBounds(drawing.start, drawing.end, bounds);
    case 'rect': {
      const shapeBounds = pointsBounds([drawing.start, drawing.end]);
      return (
        shapeBounds.minX <= bounds.maxX &&
        shapeBounds.maxX >= bounds.minX &&
        shapeBounds.minY <= bounds.maxY &&
        shapeBounds.maxY >= bounds.minY
      );
    }
    case 'ellipse': {
      const geometry = ellipseGeometry(drawing.start, drawing.end);
      if (geometry.rx <= 0 || geometry.ry <= 0) {
        return segmentIntersectsBounds(drawing.start, drawing.end, bounds);
      }
      const ellipseBounds: Bounds = {
        minX: geometry.cx - geometry.rx,
        maxX: geometry.cx + geometry.rx,
        minY: geometry.cy - geometry.ry,
        maxY: geometry.cy + geometry.ry,
      };
      if (
        ellipseBounds.minX > bounds.maxX ||
        ellipseBounds.maxX < bounds.minX ||
        ellipseBounds.minY > bounds.maxY ||
        ellipseBounds.maxY < bounds.minY
      ) {
        return false;
      }
      const boundary = ellipseBoundary(geometry);
      if (boundary.some((point) => pointInBounds(point, bounds))) {
        return true;
      }
      for (let i = 0; i < boundary.length; i += 1) {
        const next = boundary[(i + 1) % boundary.length];
        if (segmentIntersectsBounds(boundary[i], next, bounds)) {
          return true;
        }
      }
      return false;
    }
  }
}

/**
 * PDF 可视框左下角归一化坐标 → 显示页面左上角归一化坐标。
 * 只接受 0/90/180/270 的旋转（先归一化到 0..359），其余按 0 处理。
 */
export function pdfNormalizedToDisplay(
  point: readonly [number, number],
  rotation: number,
): [number, number] {
  const normalizedRotation = Number.isFinite(rotation)
    ? ((rotation % 360) + 360) % 360
    : 0;
  const [x, y] = point;
  let display: [number, number];
  switch (normalizedRotation) {
    case 90:
      display = [y, x];
      break;
    case 180:
      display = [1 - x, y];
      break;
    case 270:
      display = [1 - y, 1 - x];
      break;
    default:
      display = [x, 1 - y];
      break;
  }
  return clampNormalizedPoint(display);
}

/** pdf.js viewport 中本模块用到的部分。 */
export interface PdfViewportLike {
  width: number;
  height: number;
  viewBox: [number, number, number, number];
  convertToPdfPoint(x: number, y: number): [number, number];
}

/**
 * 屏幕点经 viewport 转为 PDF 用户坐标，再按 viewBox 原点与尺寸
 * 归一化到 [0,1]；非正 viewBox 或非有限 PDF 坐标返回原点。
 */
export function screenPointToPdfNormalized(
  viewport: PdfViewportLike,
  x: number,
  y: number,
): [number, number] {
  const [viewX, viewY, viewWidth, viewHeight] = viewport.viewBox;
  if (viewWidth <= 0 || viewHeight <= 0) {
    return [0, 0];
  }
  const pdfPoint = viewport.convertToPdfPoint(x, y);
  if (!Number.isFinite(pdfPoint[0]) || !Number.isFinite(pdfPoint[1])) {
    return [0, 0];
  }
  return clampNormalizedPoint([
    (pdfPoint[0] - viewX) / viewWidth,
    (pdfPoint[1] - viewY) / viewHeight,
  ]);
}
