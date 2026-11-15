import { describe, expect, it } from 'vitest';
import {
  TRANSLATION_MAX_CHARS,
  TRANSLATION_TARGET_LABELS,
  detectTranslationTarget,
  translationCjkRatio,
} from '@shared/translation';

describe('translation constants', () => {
  it('caps free-selection translation at 6000 characters', () => {
    expect(TRANSLATION_MAX_CHARS).toBe(6000);
  });

  it('labels both target languages', () => {
    expect(TRANSLATION_TARGET_LABELS).toEqual({
      'zh-CN': '简体中文',
      en: 'English',
    });
  });
});

describe('translationCjkRatio', () => {
  it('is 1 for pure CJK and 0 for pure Latin text', () => {
    expect(translationCjkRatio('请解释这个损失函数')).toBe(1);
    expect(translationCjkRatio('Please explain the loss function.')).toBe(0);
  });

  it('ignores whitespace (including the full-width space) in the denominator', () => {
    expect(translationCjkRatio('中文 abc')).toBe(0.4);
    expect(translationCjkRatio('中　文')).toBe(1);
  });

  it('returns 0 for empty or whitespace-only text', () => {
    expect(translationCjkRatio('')).toBe(0);
    expect(translationCjkRatio('   \n\t')).toBe(0);
  });

  it('counts astral code points once instead of per UTF-16 unit', () => {
    // U+20000 is a CJK extension character outside the three configured BMP
    // ranges; one emoji plus one Han character must still yield 1/2.
    expect(translationCjkRatio('😀中')).toBe(0.5);
  });
});

describe('detectTranslationTarget', () => {
  it('translates English prose into Simplified Chinese', () => {
    expect(detectTranslationTarget('Please explain the loss function.')).toBe('zh-CN');
  });

  it('translates Chinese prose into English', () => {
    expect(detectTranslationTarget('请解释这个损失函数。')).toBe('en');
  });

  it('treats a mostly-Latin mixed sentence as English source', () => {
    expect(detectTranslationTarget('模型 model 的 loss 是 0.5')).toBe('zh-CN');
  });

  it('switches to English at exactly 30% CJK', () => {
    expect(detectTranslationTarget('abcdefg中文字')).toBe('en');
    expect(detectTranslationTarget('abcdefgh中文字')).toBe('zh-CN');
  });
});
