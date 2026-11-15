import { describe, expect, it } from 'vitest';
import {
  TRANSLATION_MAX_CHARS,
  TRANSLATION_NOT_CONFIGURED,
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

  it('exposes the exact unconfigured-AI message shared by service and renderer', () => {
    expect(TRANSLATION_NOT_CONFIGURED).toBe('请先在设置中配置 AI 接口');
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
    // The emoji is U+1F600, outside the configured CJK ranges, and counts as a
    // single code point; one Han character out of two therefore yields 1/2.
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
