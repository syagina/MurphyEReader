/** Fixed top-left position of the draggable translation status card. */
export interface TranslationCardPosition {
  left: number;
  top: number;
}

export const TRANSLATION_CARD_POSITION_STORAGE_KEY =
  'paperlens-translation-card-position';

const VIEWPORT_MARGIN = 8;

/** Keeps the whole card inside the viewport with a small edge margin. */
export function clampTranslationCardPosition(
  position: TranslationCardPosition,
  viewportWidth: number,
  viewportHeight: number,
  cardWidth: number,
  cardHeight: number,
): TranslationCardPosition {
  const maxLeft = Math.max(
    VIEWPORT_MARGIN,
    viewportWidth - Math.max(0, cardWidth) - VIEWPORT_MARGIN,
  );
  const maxTop = Math.max(
    VIEWPORT_MARGIN,
    viewportHeight - Math.max(0, cardHeight) - VIEWPORT_MARGIN,
  );
  return {
    left: Math.min(Math.max(position.left, VIEWPORT_MARGIN), maxLeft),
    top: Math.min(Math.max(position.top, VIEWPORT_MARGIN), maxTop),
  };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Reads the last dragged position; malformed or unavailable storage is null. */
export function readTranslationCardPosition(): TranslationCardPosition | null {
  try {
    const raw = window.localStorage.getItem(
      TRANSLATION_CARD_POSITION_STORAGE_KEY,
    );
    if (raw === null) {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) {
      return null;
    }
    const value = parsed as Record<string, unknown>;
    return isFiniteNumber(value.left) && isFiniteNumber(value.top)
      ? { left: value.left, top: value.top }
      : null;
  } catch {
    return null;
  }
}

export function writeTranslationCardPosition(
  position: TranslationCardPosition,
): void {
  try {
    window.localStorage.setItem(
      TRANSLATION_CARD_POSITION_STORAGE_KEY,
      JSON.stringify(position),
    );
  } catch {
    // Dragging keeps working when persistence is unavailable.
  }
}
