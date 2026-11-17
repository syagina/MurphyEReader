import {
  clampAiFloatingBounds,
  defaultAiFloatingBounds,
  type AiPanelFloatingBounds,
  type AiPanelLayout,
} from '@shared/ai-panel';

export const AI_PANEL_LAYOUT_STORAGE_KEY = 'paperlens-ai-panel-layout';
export const AI_FLOATING_BOUNDS_STORAGE_KEY = 'paperlens-ai-panel-floating-bounds';

export function readAiPanelLayout(): AiPanelLayout {
  try {
    return window.localStorage.getItem(AI_PANEL_LAYOUT_STORAGE_KEY) === 'floating'
      ? 'floating'
      : 'docked';
  } catch {
    return 'docked';
  }
}

export function writeAiPanelLayout(layout: AiPanelLayout): void {
  try {
    window.localStorage.setItem(AI_PANEL_LAYOUT_STORAGE_KEY, layout);
  } catch {
    // A blocked localStorage must not stop the panel from switching layouts.
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Reads the last floating geometry, clamped against the current window so a
 * layout saved on a larger screen cannot strand the panel off-screen.
 */
export function readAiFloatingBounds(
  windowWidth: number,
  windowHeight: number,
): AiPanelFloatingBounds {
  try {
    const raw = window.localStorage.getItem(AI_FLOATING_BOUNDS_STORAGE_KEY);
    if (raw !== null) {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed === 'object' && parsed !== null) {
        const value = parsed as Record<string, unknown>;
        if (
          isFiniteNumber(value.x) &&
          isFiniteNumber(value.y) &&
          isFiniteNumber(value.width) &&
          isFiniteNumber(value.height)
        ) {
          return clampAiFloatingBounds(
            {
              x: value.x,
              y: value.y,
              width: value.width,
              height: value.height,
            },
            windowWidth,
            windowHeight,
          );
        }
      }
    }
  } catch {
    // Malformed or unavailable storage falls back to the default placement.
  }
  return defaultAiFloatingBounds(windowWidth, windowHeight);
}

export function writeAiFloatingBounds(bounds: AiPanelFloatingBounds): void {
  try {
    window.localStorage.setItem(AI_FLOATING_BOUNDS_STORAGE_KEY, JSON.stringify(bounds));
  } catch {
    // Dragging and resizing keep working even when persistence is unavailable.
  }
}
