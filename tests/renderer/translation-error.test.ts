import { describe, expect, it } from 'vitest';
import {
  TRANSLATION_EMPTY_RESULT,
  TRANSLATION_EMPTY_SELECTION,
  TRANSLATION_FAILED,
  TRANSLATION_NOT_CONFIGURED,
  TRANSLATION_TOO_LONG,
} from '@shared/translation';
import { normalizeTranslationError } from '@renderer/lib/translation-error';

describe('normalizeTranslationError', () => {
  it('strips Electron\'s IPC prefix, including the inner "Error:" marker', () => {
    const error = new Error(
      "Error invoking remote method 'translate:text': Error: 选中文本过长，请分段翻译",
    );

    expect(normalizeTranslationError(error)).toBe(TRANSLATION_TOO_LONG);
  });

  it('strips a prefix that has no inner "Error:" marker', () => {
    expect(
      normalizeTranslationError(
        "Error invoking remote method 'translate:text': 翻译结果为空，请重试",
      ),
    ).toBe(TRANSLATION_EMPTY_RESULT);
  });

  it('keeps known Chinese messages verbatim when there is no prefix', () => {
    expect(normalizeTranslationError(new Error(TRANSLATION_EMPTY_SELECTION))).toBe(
      TRANSLATION_EMPTY_SELECTION,
    );
    expect(normalizeTranslationError(new Error(TRANSLATION_NOT_CONFIGURED))).toBe(
      TRANSLATION_NOT_CONFIGURED,
    );
  });

  it('replaces unknown transport errors with the generic Chinese message', () => {
    expect(
      normalizeTranslationError(new Error('请求失败（HTTP 500）：relay exploded for sk-secret')),
    ).toBe(TRANSLATION_FAILED);
    expect(normalizeTranslationError('boom')).toBe(TRANSLATION_FAILED);
  });

  it('only strips a prefix at the very start of the message', () => {
    expect(
      normalizeTranslationError(
        new Error("前缀 Error invoking remote method 'translate:text': Error: boom"),
      ),
    ).toBe(TRANSLATION_FAILED);
  });
});
