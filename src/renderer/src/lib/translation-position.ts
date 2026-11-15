export interface TranslationCardPosition {
  top: number;
  left: number;
}

export interface TranslationCardPositionInput {
  /** Viewport top of the selection toolbar the card anchors to. */
  anchorTop: number;
  /** Viewport left (center) of the selection toolbar. */
  anchorLeft: number;
  viewportWidth: number;
  viewportHeight: number;
  /** Expected maximum card height; chooses below vs above the anchor. */
  cardHeight: number;
  /** Card width used to center it on the anchor. */
  cardWidth: number;
  /** Distance between the anchor and the card. */
  gap: number;
  /** Minimum distance kept from every viewport edge. */
  margin: number;
}

/**
 * Places the fixed translation card near the selection toolbar. The card is
 * centered on the anchor horizontally, prefers the space below the toolbar and
 * flips above it when the lower half cannot fit the estimated card height.
 */
export function translationCardPosition({
  anchorTop,
  anchorLeft,
  viewportWidth,
  viewportHeight,
  cardHeight,
  cardWidth,
  gap,
  margin,
}: TranslationCardPositionInput): TranslationCardPosition {
  const maxCardWidth = Math.max(0, viewportWidth - 2 * margin);
  const halfWidth = Math.min(cardWidth, maxCardWidth) / 2;
  // When the viewport is narrower than the card, keep it centered.
  const minLeft = Math.min(margin + halfWidth, viewportWidth / 2);
  const maxLeft = Math.max(viewportWidth - margin - halfWidth, viewportWidth / 2);
  const left = Math.min(Math.max(anchorLeft, minLeft), maxLeft);

  const below = anchorTop + gap;
  if (below + cardHeight <= viewportHeight - margin) {
    return { top: below, left };
  }
  const above = anchorTop - gap - cardHeight;
  if (above >= margin) {
    return { top: above, left };
  }
  // Neither side fits (very short window): pin to the top without clipping.
  const maxTop = Math.max(margin, viewportHeight - margin - cardHeight);
  return { top: Math.min(Math.max(below, margin), maxTop), left };
}
