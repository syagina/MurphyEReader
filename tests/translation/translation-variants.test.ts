import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  isBilingualTranslationPath,
  translationVariantPaths,
} from '@main/translation/translation-variants';

// Real managed paths come from path.join, so build them the same way here.
const ROOT = join('C:/papers', '样本论文 (2)');
const MONO = join(ROOT, 'translated.zh-CN.mono.pdf');
const DUAL = join(ROOT, 'translated.zh-CN.dual.pdf');

describe('translationVariantPaths', () => {
  it('derives the bilingual sibling from a canonical mono primary', () => {
    expect(translationVariantPaths({ filePathTranslated: MONO })).toEqual({
      translated: MONO,
      bilingual: DUAL,
    });
  });

  it('offers only the bilingual view when the primary is the dual output', () => {
    // The mono output was lossy in this case, so it must not be offered.
    expect(translationVariantPaths({ filePathTranslated: DUAL })).toEqual({
      translated: null,
      bilingual: DUAL,
    });
  });

  it('has no bilingual sibling for a custom attached translation', () => {
    const custom = join('C:/downloads', '译文.pdf');
    expect(translationVariantPaths({ filePathTranslated: custom })).toEqual({
      translated: custom,
      bilingual: null,
    });
  });

  it('returns no views when no translation is bound', () => {
    expect(translationVariantPaths({ filePathTranslated: null })).toEqual({
      translated: null,
      bilingual: null,
    });
    expect(translationVariantPaths({ filePathTranslated: '' })).toEqual({
      translated: null,
      bilingual: null,
    });
  });

  it('matches canonical names case-insensitively', () => {
    expect(isBilingualTranslationPath(DUAL.toUpperCase())).toBe(true);
    expect(isBilingualTranslationPath(MONO)).toBe(false);
  });
});
