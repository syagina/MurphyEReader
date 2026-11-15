import type { TranslationTarget } from './types';

/** Longest selection accepted by free-selection translation, in code points. */
export const TRANSLATION_MAX_CHARS = 6000;

/** Exact user-facing messages of free-selection translation. */
export const TRANSLATION_EMPTY_SELECTION = '请先选择要翻译的文本';
export const TRANSLATION_TOO_LONG = '选中文本过长，请分段翻译';
export const TRANSLATION_NOT_CONFIGURED = '请先在设置中配置 AI 接口';
export const TRANSLATION_EMPTY_RESULT = '翻译结果为空，请重试';
export const TRANSLATION_FAILED = '翻译失败，请稍后重试';

/** Human-readable names used in prompts and the translation card. */
export const TRANSLATION_TARGET_LABELS: Record<TranslationTarget, string> = {
  'zh-CN': '简体中文',
  en: 'English',
};

/** Below this share of CJK code points the text is treated as English. */
const CJK_TARGET_THRESHOLD = 0.3;

const CJK_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x3400, 0x4dbf],
  [0x4e00, 0x9fff],
  [0xf900, 0xfaff],
];

function isCjkCodePoint(codePoint: number): boolean {
  return CJK_RANGES.some(([start, end]) => codePoint >= start && codePoint <= end);
}

/**
 * Share of CJK code points among all non-whitespace code points. Iteration is
 * by code point so astral characters count once; empty text has ratio 0.
 */
export function translationCjkRatio(text: string): number {
  let total = 0;
  let cjk = 0;
  for (const char of text) {
    if (/\s/u.test(char)) {
      continue;
    }
    total += 1;
    if (isCjkCodePoint(char.codePointAt(0) ?? 0)) {
      cjk += 1;
    }
  }
  return total === 0 ? 0 : cjk / total;
}

/**
 * Chinese-heavy text is translated into English; anything else is translated
 * into Simplified Chinese.
 */
export function detectTranslationTarget(text: string): TranslationTarget {
  return translationCjkRatio(text) >= CJK_TARGET_THRESHOLD ? 'en' : 'zh-CN';
}
