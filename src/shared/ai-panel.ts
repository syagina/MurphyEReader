export const AI_PANEL_MIN_WIDTH = 320;
export const AI_PANEL_MAX_WIDTH = 900;
export const AI_PANEL_DEFAULT_WIDTH = 360;

export type AiPanelLayout = 'docked' | 'floating';

export interface AiPanelFloatingBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const AI_FLOATING_MIN_WIDTH = 320;
export const AI_FLOATING_MIN_HEIGHT = 320;
export const AI_FLOATING_DEFAULT_WIDTH = 420;
export const AI_FLOATING_DEFAULT_HEIGHT = 620;
/** Minimum gap between the floating panel and the window edges. */
export const AI_FLOATING_MARGIN = 16;
/** First floating position keeps the title bar below the app top bar. */
export const AI_FLOATING_DEFAULT_Y = 64;

export function aiPanelMaxWidth(windowWidth: number): number {
  return Math.max(
    AI_PANEL_MIN_WIDTH,
    Math.min(AI_PANEL_MAX_WIDTH, Math.floor(windowWidth * 0.7)),
  );
}

export function clampAiPanelWidth(width: number, windowWidth: number): number {
  const finite = Number.isFinite(width) ? width : AI_PANEL_DEFAULT_WIDTH;
  return Math.round(
    Math.min(aiPanelMaxWidth(windowWidth), Math.max(AI_PANEL_MIN_WIDTH, finite)),
  );
}

/**
 * Width after dragging the panel separator by `deltaX` pointer pixels. The
 * separator sits left of the panel, so moving the pointer right (positive
 * delta) narrows the panel; moving left widens it.
 */
export function resizeAiPanelWidth(
  startWidth: number,
  deltaX: number,
  windowWidth: number,
): number {
  return clampAiPanelWidth(startWidth - deltaX, windowWidth);
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function clampValue(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function sizeMax(value: number, minimum: number, margin: number): number {
  return Math.max(minimum, finiteOr(value, 0) - margin * 2);
}

function clampSize(
  value: number,
  minimum: number,
  viewport: number,
  margin: number,
): number {
  return Math.round(
    clampValue(finiteOr(value, minimum), minimum, sizeMax(viewport, minimum, margin)),
  );
}

/** Default free-floating geometry: a comfortable card near the top-right. */
export function defaultAiFloatingBounds(
  windowWidth: number,
  windowHeight: number,
): AiPanelFloatingBounds {
  const maxWidth = sizeMax(windowWidth, AI_FLOATING_MIN_WIDTH, AI_FLOATING_MARGIN);
  const maxHeight = sizeMax(windowHeight, AI_FLOATING_MIN_HEIGHT, AI_FLOATING_MARGIN);
  const width = Math.min(AI_FLOATING_DEFAULT_WIDTH, maxWidth);
  const height = Math.min(AI_FLOATING_DEFAULT_HEIGHT, maxHeight);
  const x = Math.max(AI_FLOATING_MARGIN, windowWidth - width - AI_FLOATING_MARGIN);
  const y = Math.max(
    AI_FLOATING_MARGIN,
    Math.min(AI_FLOATING_DEFAULT_Y, windowHeight - height - AI_FLOATING_MARGIN),
  );
  return clampAiFloatingBounds({ x, y, width, height }, windowWidth, windowHeight);
}

/**
 * Keeps a floating panel fully inside the window when possible. When the
 * window is smaller than the minimum panel size, the left/top margin wins so
 * the title bar stays reachable.
 */
export function clampAiFloatingBounds(
  bounds: AiPanelFloatingBounds,
  windowWidth: number,
  windowHeight: number,
): AiPanelFloatingBounds {
  const width = clampSize(
    bounds.width,
    AI_FLOATING_MIN_WIDTH,
    windowWidth,
    AI_FLOATING_MARGIN,
  );
  const height = clampSize(
    bounds.height,
    AI_FLOATING_MIN_HEIGHT,
    windowHeight,
    AI_FLOATING_MARGIN,
  );
  const maxX = Math.max(AI_FLOATING_MARGIN, finiteOr(windowWidth, 0) - width - AI_FLOATING_MARGIN);
  const maxY = Math.max(
    AI_FLOATING_MARGIN,
    finiteOr(windowHeight, 0) - height - AI_FLOATING_MARGIN,
  );
  const x = Math.round(
    clampValue(finiteOr(bounds.x, AI_FLOATING_MARGIN), AI_FLOATING_MARGIN, maxX),
  );
  const y = Math.round(
    clampValue(finiteOr(bounds.y, AI_FLOATING_MARGIN), AI_FLOATING_MARGIN, maxY),
  );
  return { x, y, width, height };
}

/** Drags the title bar by pointer delta while preserving the panel size. */
export function moveAiFloatingBounds(
  start: AiPanelFloatingBounds,
  deltaX: number,
  deltaY: number,
  windowWidth: number,
  windowHeight: number,
): AiPanelFloatingBounds {
  return clampAiFloatingBounds(
    {
      ...start,
      x: start.x + (Number.isFinite(deltaX) ? deltaX : 0),
      y: start.y + (Number.isFinite(deltaY) ? deltaY : 0),
    },
    windowWidth,
    windowHeight,
  );
}

/** Resizes from the bottom-right handle, keeping the top-left corner fixed. */
export function resizeAiFloatingBounds(
  start: AiPanelFloatingBounds,
  deltaX: number,
  deltaY: number,
  windowWidth: number,
  windowHeight: number,
): AiPanelFloatingBounds {
  return clampAiFloatingBounds(
    {
      ...start,
      width: start.width + (Number.isFinite(deltaX) ? deltaX : 0),
      height: start.height + (Number.isFinite(deltaY) ? deltaY : 0),
    },
    windowWidth,
    windowHeight,
  );
}
