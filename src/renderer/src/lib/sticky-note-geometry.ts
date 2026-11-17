import type {
  AnnotationPin,
  AnnotationPopupPlacement,
  StickyNote,
  StickyNoteAnchor,
  StickyNoteRect,
} from '@shared/types';

export interface PageBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface ClientRectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface PageSize {
  width: number;
  height: number;
}

export interface CssRect {
  left: string;
  top: string;
  width: string;
  height: string;
}

export const PAGE_NOTE_ICON_SIZE = 18;
export const PAGE_NOTE_ICON_GAP = 4;
export const PAGE_NOTE_ICON_MARGIN = 8;

const MAX_RECTS = 500;
const EDGE_TOLERANCE = 0.5;

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function clamp01(value: number): number {
  return Math.min(Math.max(value, 0), 1);
}

function clampRange(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

interface PixelRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function isSameEdges(a: PixelRect, b: PixelRect): boolean {
  return (
    Math.abs(a.left - b.left) <= EDGE_TOLERANCE &&
    Math.abs(a.right - b.right) <= EDGE_TOLERANCE &&
    Math.abs(a.top - b.top) <= EDGE_TOLERANCE &&
    Math.abs(a.bottom - b.bottom) <= EDGE_TOLERANCE
  );
}

/**
 * Converts each browser selection rectangle into page-relative normalized
 * coordinates. Rectangles are clipped to the page, degenerate/off-page boxes
 * are dropped, and duplicates (all four edges within half a pixel) collapse to
 * one. Adjacent line boxes are never merged.
 */
export function normalizeSelectionRects(
  pageBounds: PageBounds,
  clientRects: ArrayLike<ClientRectLike>,
): StickyNoteRect[] {
  if (pageBounds.width <= 0 || pageBounds.height <= 0) {
    return [];
  }
  const pageRight = pageBounds.left + pageBounds.width;
  const pageBottom = pageBounds.top + pageBounds.height;
  const kept: PixelRect[] = [];

  for (let index = 0; index < clientRects.length; index += 1) {
    const rect = clientRects[index];
    if (
      !Number.isFinite(rect.left) ||
      !Number.isFinite(rect.top) ||
      !Number.isFinite(rect.width) ||
      !Number.isFinite(rect.height)
    ) {
      continue;
    }
    const left = Math.max(rect.left, pageBounds.left);
    const top = Math.max(rect.top, pageBounds.top);
    const right = Math.min(rect.left + rect.width, pageRight);
    const bottom = Math.min(rect.top + rect.height, pageBottom);

    if (right <= left || bottom <= top) {
      continue;
    }
    const candidate: PixelRect = { left, top, right, bottom };
    if (kept.some((existing) => isSameEdges(existing, candidate))) {
      continue;
    }
    kept.push(candidate);
    if (kept.length >= MAX_RECTS) {
      break;
    }
  }

  const normalized: StickyNoteRect[] = [];
  for (const rect of kept) {
    const x = round4(clamp01((rect.left - pageBounds.left) / pageBounds.width));
    const y = round4(clamp01((rect.top - pageBounds.top) / pageBounds.height));
    const width = round4(
      clamp01((rect.right - rect.left) / pageBounds.width),
    );
    const height = round4(
      clamp01((rect.bottom - rect.top) / pageBounds.height),
    );
    const clampedWidth = round4(Math.min(width, 1 - x));
    const clampedHeight = round4(Math.min(height, 1 - y));
    if (clampedWidth <= 0 || clampedHeight <= 0) {
      continue;
    }
    normalized.push({ x, y, width: clampedWidth, height: clampedHeight });
  }
  return normalized;
}

function percent(value: number): string {
  return `${(value * 100).toFixed(4)}%`;
}

/** CSS percentages for one overlay highlight. */
export function rectsToCss(rects: StickyNoteRect[]): CssRect[] {
  return rects.map((rect) => ({
    left: percent(rect.x),
    top: percent(rect.y),
    width: percent(rect.width),
    height: percent(rect.height),
  }));
}

function newerFirst(a: StickyNote, b: StickyNote): number {
  return b.createdAt - a.createdAt || b.id - a.id;
}

/** Returns the newest visible text mark containing `point`, notes first. */
export function hitTestTextNote(
  notes: StickyNote[],
  point: Point,
): StickyNote | null {
  const candidates = notes
    .filter(
      (note) =>
        (note.kind === 'note' || note.kind === 'mark') &&
        note.markStyle !== 'none' &&
        note.anchor.kind === 'text' &&
        note.anchor.rects.some(
          (rect) =>
            point.x >= rect.x &&
            point.x <= rect.x + rect.width &&
            point.y >= rect.y &&
            point.y <= rect.y + rect.height,
        ),
    )
    .sort((a, b) => {
      const rank = (note: StickyNote): number =>
        note.kind === 'note' ? 0 : 1;
      return rank(a) - rank(b) || newerFirst(a, b);
    });
  return candidates[0] ?? null;
}

/** Top offset in CSS pixels of one page-level note icon. */
export function pageNoteIconOffset(index: number): number {
  return PAGE_NOTE_ICON_MARGIN + index * (PAGE_NOTE_ICON_SIZE + PAGE_NOTE_ICON_GAP);
}

export interface IconRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Page-level note icon rect in CSS pixels relative to the page wrapper. */
export function pageNoteIconRect(pageWidth: number, index: number): IconRect {
  return {
    left: pageWidth - PAGE_NOTE_ICON_MARGIN - PAGE_NOTE_ICON_SIZE,
    top: pageNoteIconOffset(index),
    width: PAGE_NOTE_ICON_SIZE,
    height: PAGE_NOTE_ICON_SIZE,
  };
}

/**
 * Popup anchor in CSS pixels relative to the page wrapper: a visible pin's
 * centre, the top-centre of the first highlight, or the page-level icon.
 */
export function noteAnchorPoint(
  note: StickyNote,
  pageSize: PageSize,
  pageNoteIndex = 0,
): Point | null {
  if (note.pin !== null && note.pin.visible) {
    // A pin's stored position can drift outside the page after a rebuild; clamp
    // the icon box first, then return its centre (same box as pinRectForNote).
    const maxLeft = Math.max(0, pageSize.width - PAGE_NOTE_ICON_SIZE);
    const maxTop = Math.max(0, pageSize.height - PAGE_NOTE_ICON_SIZE);
    return {
      x:
        round4(clampRange(note.pin.x * pageSize.width, 0, maxLeft)) +
        PAGE_NOTE_ICON_SIZE / 2,
      y:
        round4(clampRange(note.pin.y * pageSize.height, 0, maxTop)) +
        PAGE_NOTE_ICON_SIZE / 2,
    };
  }
  if (note.anchor.kind === 'text') {
    const first = note.anchor.rects[0];
    if (first === undefined) {
      return null;
    }
    return {
      x: (first.x + first.width / 2) * pageSize.width,
      y: first.y * pageSize.height,
    };
  }
  const icon = pageNoteIconRect(pageSize.width, pageNoteIndex);
  return {
    x: icon.left + icon.width / 2,
    y: icon.top + icon.height / 2,
  };
}

export interface TextNotePopupAnchor {
  /** X relative to the page wrapper where an anchor popup is centred. */
  x: number;
  /** Y relative to the page wrapper for right-mode vertical centring. */
  rightY: number;
  /** Y relative to the page wrapper where an anchor popup starts. */
  bottom: number;
}

/**
 * Popup anchor for a text-anchored note. A body-mark note follows its first
 * selection rect (the pin is only an icon anchor). A markless note whose pin
 * is its only visible marker follows the dragged pin instead, so moving the
 * pin moves the card.
 */
export function textNotePopupAnchor(
  note: StickyNote,
  pageSize: PageSize,
): TextNotePopupAnchor | null {
  if (note.markStyle === 'none' && note.pin !== null && note.pin.visible) {
    const point = noteAnchorPoint(note, pageSize);
    if (point === null) {
      return null;
    }
    return {
      x: point.x,
      rightY: point.y,
      bottom: point.y + PAGE_NOTE_ICON_SIZE / 2,
    };
  }
  if (note.anchor.kind !== 'text') {
    return null;
  }
  const rect = note.anchor.rects[0];
  if (rect === undefined) {
    return null;
  }
  return {
    x: (rect.x + rect.width / 2) * pageSize.width,
    rightY: (rect.y + rect.height / 2) * pageSize.height,
    bottom: (rect.y + rect.height) * pageSize.height,
  };
}

/** Icon rect for a note, in CSS pixels relative to the page wrapper. */
export function pinRectForNote(
  note: StickyNote,
  pageSize: PageSize,
  pageNoteIndex = 0,
): IconRect | null {
  if (note.kind !== 'note') {
    return null;
  }
  if (note.pin !== null) {
    if (!note.pin.visible) {
      return null;
    }
    const maxLeft = Math.max(0, pageSize.width - PAGE_NOTE_ICON_SIZE);
    const maxTop = Math.max(0, pageSize.height - PAGE_NOTE_ICON_SIZE);
    return {
      left: round4(
        clampRange(note.pin.x * pageSize.width, 0, maxLeft),
      ),
      top: round4(
        clampRange(note.pin.y * pageSize.height, 0, maxTop),
      ),
      width: PAGE_NOTE_ICON_SIZE,
      height: PAGE_NOTE_ICON_SIZE,
    };
  }
  if (note.anchor.kind === 'page') {
    return pageNoteIconRect(pageSize.width, pageNoteIndex);
  }
  return null;
}

/** Normalized pin position from a pointer position during a drag. */
export function pinPositionFromDrag(
  pageBounds: PageBounds,
  pointer: Point,
  grabOffset: Point,
): Point {
  const maxLeft = Math.max(0, pageBounds.width - PAGE_NOTE_ICON_SIZE);
  const maxTop = Math.max(0, pageBounds.height - PAGE_NOTE_ICON_SIZE);
  const left = clampRange(
    pointer.x - grabOffset.x - pageBounds.left,
    0,
    maxLeft,
  );
  const top = clampRange(
    pointer.y - grabOffset.y - pageBounds.top,
    0,
    maxTop,
  );
  return {
    x:
      pageBounds.width > 0
        ? round4(left / pageBounds.width)
        : 0,
    y:
      pageBounds.height > 0
        ? round4(top / pageBounds.height)
        : 0,
  };
}

/** Clamps a stored pin so its icon stays inside the displayed page. */
export function clampPinPosition(
  pin: AnnotationPin,
  pageSize: PageSize,
): AnnotationPin {
  const maxX =
    pageSize.width > 0
      ? Math.max(0, (pageSize.width - PAGE_NOTE_ICON_SIZE) / pageSize.width)
      : 0;
  const maxY =
    pageSize.height > 0
      ? Math.max(0, (pageSize.height - PAGE_NOTE_ICON_SIZE) / pageSize.height)
      : 0;
  return {
    x: round4(clampRange(pin.x, 0, maxX)),
    y: round4(clampRange(pin.y, 0, maxY)),
    visible: pin.visible,
  };
}

export interface PinFormOptions {
  visible: boolean;
  side: 'left' | 'right';
  sideTouched: boolean;
}

/**
 * Deterministic pin value for the note form. `null` means "no stored pin":
 * page notes then keep their default stacked icon on the right.
 */
export function pinForForm(
  note: Pick<StickyNote, 'pin'>,
  anchor: StickyNoteAnchor,
  options: PinFormOptions,
): AnnotationPin | null {
  const { visible, side, sideTouched } = options;
  const existing = note.pin;

  if (existing !== null) {
    return {
      x: sideTouched ? (side === 'left' ? 0 : 1) : existing.x,
      y: existing.y,
      visible,
    };
  }

  if (anchor.kind === 'page') {
    if (visible && side === 'right' && !sideTouched) {
      return null;
    }
    return {
      x: side === 'left' ? 0 : 1,
      y: 0,
      visible,
    };
  }

  if (!visible) {
    return null;
  }
  return {
    x: side === 'left' ? 0 : 1,
    y: anchor.rects[0]?.y ?? 0,
    visible: true,
  };
}

export type PopupMode = 'anchor' | 'right' | 'free';

export interface PopupPosition {
  left: number;
  top: number;
}

const POPUP_MARGIN = 8;

/** Clamps a popup's top-left position inside the reading area. */
export function clampPopupPosition(
  position: PopupPosition,
  bounds: ClientRectLike,
  popupSize: PageSize,
): PopupPosition {
  const minLeft = bounds.left + POPUP_MARGIN;
  const minTop = bounds.top + POPUP_MARGIN;
  const maxLeft =
    bounds.left + bounds.width - popupSize.width - POPUP_MARGIN;
  const maxTop =
    bounds.top + bounds.height - popupSize.height - POPUP_MARGIN;
  return {
    left: round4(Math.max(minLeft, Math.min(position.left, maxLeft))),
    top: round4(Math.max(minTop, Math.min(position.top, maxTop))),
  };
}

/**
 * Popup anchored to a marker, centred horizontally. It opens below the anchor
 * when the estimated card fits, flips above it when only the upper space fits,
 * and otherwise falls back to the clamped below position.
 */
export function anchorPopupPosition(
  anchor: Point,
  bounds: ClientRectLike,
  popupSize: PageSize,
): PopupPosition {
  const minTop = bounds.top + POPUP_MARGIN;
  const maxTop = bounds.top + bounds.height - popupSize.height - POPUP_MARGIN;
  const below = anchor.y + POPUP_MARGIN;
  const above = anchor.y - POPUP_MARGIN - popupSize.height;
  const top = below <= maxTop ? below : above >= minTop ? above : below;
  return clampPopupPosition(
    {
      left: anchor.x - popupSize.width / 2,
      top,
    },
    bounds,
    popupSize,
  );
}

/** Popup pinned to the right edge, vertically centred on `anchorY`. */
export function rightPopupPosition(
  anchorY: number,
  bounds: ClientRectLike,
  popupSize: PageSize,
): PopupPosition {
  return clampPopupPosition(
    {
      left: bounds.left + bounds.width - popupSize.width - POPUP_MARGIN,
      top: anchorY - popupSize.height / 2,
    },
    bounds,
    popupSize,
  );
}

/** Popup from a reading-area-normalized top-left position, clamped. */
export function freePopupPosition(
  position: Point,
  bounds: ClientRectLike,
  popupSize: PageSize,
): PopupPosition {
  return clampPopupPosition(
    {
      left: bounds.left + position.x * bounds.width,
      top: bounds.top + position.y * bounds.height,
    },
    bounds,
    popupSize,
  );
}

/** Reading-area-normalized popup position after clamping. */
export function normalizedPopupPosition(
  left: number,
  top: number,
  bounds: ClientRectLike,
  popupSize: PageSize,
): Point {
  const clamped = clampPopupPosition({ left, top }, bounds, popupSize);
  return {
    x:
      bounds.width > 0
        ? round4((clamped.left - bounds.left) / bounds.width)
        : 0,
    y:
      bounds.height > 0
        ? round4((clamped.top - bounds.top) / bounds.height)
        : 0,
  };
}

/** Placement for a mode; free keeps an already stored free position. */
export function popupForMode(
  note: StickyNote | null,
  mode: PopupMode,
): AnnotationPopupPlacement {
  if (mode !== 'free') {
    return { mode };
  }
  if (note !== null && note.popup !== null && note.popup.mode === 'free') {
    return { mode: 'free', x: note.popup.x, y: note.popup.y };
  }
  return { mode: 'free', x: 0.5, y: 0.25 };
}
