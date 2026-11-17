// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  TRANSLATION_CARD_POSITION_STORAGE_KEY,
  clampTranslationCardPosition,
  readTranslationCardPosition,
  writeTranslationCardPosition,
} from '@renderer/lib/translation-card-position';

describe('clampTranslationCardPosition', () => {
  it('keeps a position already inside the viewport', () => {
    expect(
      clampTranslationCardPosition({ left: 200, top: 150 }, 1000, 800, 360, 200),
    ).toEqual({ left: 200, top: 150 });
  });

  it('pulls negative coordinates back to the margin', () => {
    expect(
      clampTranslationCardPosition({ left: -50, top: -20 }, 1000, 800, 360, 200),
    ).toEqual({ left: 8, top: 8 });
  });

  it('keeps the whole card on screen at the far edge', () => {
    expect(
      clampTranslationCardPosition({ left: 950, top: 900 }, 1000, 800, 360, 200),
    ).toEqual({ left: 632, top: 592 });
  });

  it('falls back to the margin when the card is larger than the viewport', () => {
    expect(
      clampTranslationCardPosition({ left: 100, top: 100 }, 200, 150, 360, 400),
    ).toEqual({ left: 8, top: 8 });
  });
});

describe('translation card position storage', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('round-trips a written position', () => {
    writeTranslationCardPosition({ left: 120, top: 80 });
    expect(readTranslationCardPosition()).toEqual({ left: 120, top: 80 });
    expect(
      window.localStorage.getItem(TRANSLATION_CARD_POSITION_STORAGE_KEY),
    ).toBe('{"left":120,"top":80}');
  });

  it('returns null when nothing was stored', () => {
    expect(readTranslationCardPosition()).toBeNull();
  });

  it('ignores malformed storage instead of throwing', () => {
    window.localStorage.setItem(
      TRANSLATION_CARD_POSITION_STORAGE_KEY,
      'not json',
    );
    expect(readTranslationCardPosition()).toBeNull();
    window.localStorage.setItem(
      TRANSLATION_CARD_POSITION_STORAGE_KEY,
      '{"left":"x","top":1}',
    );
    expect(readTranslationCardPosition()).toBeNull();
    window.localStorage.setItem(
      TRANSLATION_CARD_POSITION_STORAGE_KEY,
      'null',
    );
    expect(readTranslationCardPosition()).toBeNull();
  });
});
