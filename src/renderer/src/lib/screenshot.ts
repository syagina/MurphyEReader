export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

/** Turns a drag start/end pair into a top-left anchored, non-negative rect. */
export function normalizeRect(
  start: { x: number; y: number },
  end: { x: number; y: number },
): Rect {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}

/**
 * Scales a CSS-pixel rect into the canvas backing-store pixels. All four
 * values are rounded and clamped so the result always addresses real pixels.
 */
export function toSourceRect(
  rect: Rect,
  cssSize: { width: number; height: number },
  canvasSize: { width: number; height: number },
): Rect {
  if (cssSize.width <= 0 || cssSize.height <= 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  const scaleX = canvasSize.width / cssSize.width;
  const scaleY = canvasSize.height / cssSize.height;
  const x = clamp(Math.round(rect.x * scaleX), 0, canvasSize.width);
  const y = clamp(Math.round(rect.y * scaleY), 0, canvasSize.height);
  const width = clamp(Math.round(rect.width * scaleX), 0, canvasSize.width - x);
  const height = clamp(Math.round(rect.height * scaleY), 0, canvasSize.height - y);
  return { x, y, width, height };
}

/**
 * Copies `rect` out of `canvas` into an offscreen canvas and returns it as a
 * PNG data URL. The rect is clamped to the source bounds first; the output
 * canvas is at least 1×1 so a degenerate rect still yields a valid image.
 */
export async function cropToDataUrl(canvas: HTMLCanvasElement, rect: Rect): Promise<string> {
  const sx = clamp(Math.round(rect.x), 0, canvas.width);
  const sy = clamp(Math.round(rect.y), 0, canvas.height);
  const sw = clamp(Math.round(rect.width), 0, canvas.width - sx);
  const sh = clamp(Math.round(rect.height), 0, canvas.height - sy);

  const target = document.createElement('canvas');
  target.width = Math.max(1, sw);
  target.height = Math.max(1, sh);
  const context = target.getContext('2d');
  if (context === null) {
    throw new Error('截图失败：无法创建 2D 画布上下文');
  }
  context.drawImage(canvas, sx, sy, sw, sh, 0, 0, target.width, target.height);
  return target.toDataURL('image/png');
}
