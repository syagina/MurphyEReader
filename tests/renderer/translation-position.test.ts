import { describe, expect, it } from 'vitest';
import { translationCardPosition } from '@renderer/lib/translation-position';
import type { TranslationCardPositionInput } from '@renderer/lib/translation-position';

const BASE: TranslationCardPositionInput = {
  anchorTop: 400,
  anchorLeft: 500,
  viewportWidth: 1000,
  viewportHeight: 800,
  cardWidth: 420,
  cardHeight: 400,
  gap: 48,
  margin: 8,
};

describe('translationCardPosition', () => {
  it('places the card below the toolbar when it fits', () => {
    expect(translationCardPosition({ ...BASE, anchorTop: 100 })).toEqual({
      top: 148,
      left: 500,
    });
  });

  it('keeps the card below when it exactly touches the bottom margin', () => {
    // 392 + 400 === 792, the last allowed row.
    expect(translationCardPosition({ ...BASE, anchorTop: 344 }).top).toBe(392);
  });

  it('flips above the toolbar when the lower half cannot fit', () => {
    expect(translationCardPosition({ ...BASE, anchorTop: 560 })).toEqual({
      top: 112,
      left: 500,
    });
  });

  it('pins to the top margin when neither side fits a very short window', () => {
    expect(
      translationCardPosition({
        ...BASE,
        viewportHeight: 400,
        anchorTop: 200,
      }),
    ).toEqual({ top: 8, left: 500 });
  });

  it('centers the card on the anchor within the horizontal margins', () => {
    expect(translationCardPosition({ ...BASE, anchorLeft: 900, anchorTop: 100 }).left).toBe(
      782,
    );
    expect(translationCardPosition({ ...BASE, anchorLeft: 5, anchorTop: 100 }).left).toBe(
      218,
    );
  });

  it('keeps a card wider than the window centered', () => {
    expect(
      translationCardPosition({
        ...BASE,
        viewportWidth: 300,
        anchorLeft: 20,
        anchorTop: 100,
      }),
    ).toEqual({ top: 148, left: 150 });
  });
});
