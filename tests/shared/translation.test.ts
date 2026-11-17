import { describe, expect, it } from 'vitest';
import {
  TRANSLATION_MAX_CHARS,
  TRANSLATION_NOT_CONFIGURED,
  TRANSLATION_QPS_DEFAULT,
  TRANSLATION_TARGET_LABELS,
  TRANSLATION_WORKERS_DEFAULT,
  detectTranslationTarget,
  formatTranslationElapsed,
  formatTranslationLogs,
  localizeTranslationLine,
  normalizeTranslationQps,
  normalizeTranslationWorkers,
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

describe('normalizeTranslationQps', () => {
  it('defaults non-finite values to 128 and clamps to 1–512', () => {
    expect(TRANSLATION_QPS_DEFAULT).toBe(128);
    expect(normalizeTranslationQps(Number.NaN)).toBe(128);
    expect(normalizeTranslationQps(Number.POSITIVE_INFINITY)).toBe(128);
    expect(normalizeTranslationQps(0)).toBe(1);
    expect(normalizeTranslationQps(128)).toBe(128);
    expect(normalizeTranslationQps(512)).toBe(512);
    expect(normalizeTranslationQps(999)).toBe(512);
  });

  it('rounds to the nearest integer', () => {
    expect(normalizeTranslationQps(4.4)).toBe(4);
    expect(normalizeTranslationQps(4.6)).toBe(5);
  });
});

describe('normalizeTranslationWorkers', () => {
  it('defaults non-finite values to 128 and clamps to 1–512', () => {
    expect(TRANSLATION_WORKERS_DEFAULT).toBe(128);
    expect(normalizeTranslationWorkers(Number.NaN)).toBe(128);
    expect(normalizeTranslationWorkers(Number.POSITIVE_INFINITY)).toBe(128);
    expect(normalizeTranslationWorkers(0)).toBe(1);
    expect(normalizeTranslationWorkers(128)).toBe(128);
    expect(normalizeTranslationWorkers(512)).toBe(512);
    expect(normalizeTranslationWorkers(999)).toBe(512);
  });

  it('rounds to the nearest integer', () => {
    expect(normalizeTranslationWorkers(4.4)).toBe(4);
    expect(normalizeTranslationWorkers(4.6)).toBe(5);
  });
});

describe('formatTranslationElapsed', () => {
  it('uses seconds below one minute and clamps negatives', () => {
    expect(formatTranslationElapsed(0)).toBe('0 秒');
    expect(formatTranslationElapsed(45_900)).toBe('45 秒');
    expect(formatTranslationElapsed(-5_000)).toBe('0 秒');
  });

  it('uses minutes and seconds below one hour', () => {
    expect(formatTranslationElapsed(200_000)).toBe('3 分 20 秒');
    expect(formatTranslationElapsed(180_000)).toBe('3 分钟');
  });

  it('uses hours and minutes from one hour up', () => {
    expect(formatTranslationElapsed(3_900_000)).toBe('1 小时 5 分');
    expect(formatTranslationElapsed(3_600_000)).toBe('1 小时');
  });
});

describe('localizeTranslationLine', () => {
  it('strips ANSI codes and maps BabelDOC phases to Chinese', () => {
    expect(localizeTranslationLine('\u001b[32mParsing PDF...\u001b[0m')).toBe(
      '正在解析 PDF…',
    );
    expect(localizeTranslationLine('Translating paragraphs')).toBe(
      '正在调用 AI 逐段翻译…',
    );
    expect(localizeTranslationLine('Typesetting output')).toBe(
      '正在按原文版式排版…',
    );
    expect(localizeTranslationLine('Saving file')).toBe('正在保存译本文件…');
    expect(localizeTranslationLine('Done.')).toBe('BabelDOC 处理完成');
  });

  it('names the BabelDOC stage shown by progress lines', () => {
    expect(localizeTranslationLine('Automatic Term Extraction')).toBe(
      '正在提取专业术语…',
    );
    expect(localizeTranslationLine('Parse Page Layout')).toBe(
      '正在分析页面版面…',
    );
    expect(localizeTranslationLine('doclayout:Loading ONNX model...')).toBe(
      '正在加载版面分析模型…',
    );
  });

  it('reads both percent and rich-progress fraction formats', () => {
    expect(localizeTranslationLine('translating 42/100')).toBe(
      'BabelDOC 翻译进度：42%',
    );
    expect(localizeTranslationLine('typesetting 80/100')).toBe(
      'BabelDOC 排版进度：80%',
    );
    expect(localizeTranslationLine('working 35%')).toBe('BabelDOC 处理进度：35%');
    expect(localizeTranslationLine('Automatic Term Extraction 42%')).toBe(
      'BabelDOC 术语提取进度：42%',
    );
  });

  it('turns relay markers into retry hints instead of raw errors', () => {
    expect(
      localizeTranslationLine('paperlens_empty_translation: upstream returned nothing'),
    ).toBe('AI 返回了空翻译，正在自动重试…');
    expect(localizeTranslationLine('error: paperlens_upstream_unreachable')).toBe(
      '无法连接 AI 接口，正在自动重试…',
    );
    expect(localizeTranslationLine('WARNING RateLimitError: retrying')).toBe(
      'AI 接口繁忙或触发限流，正在自动重试…',
    );
  });

  it('labels real errors and unknown technical output in Chinese', () => {
    expect(localizeTranslationLine('ERROR: failed to parse page 5')).toContain(
      'BabelDOC 报告错误：',
    );
    expect(localizeTranslationLine('some internal detail')).toBe(
      'BabelDOC 技术信息：some internal detail',
    );
  });

  it('hides Rich logging tracebacks caused by the Windows GBK console', () => {
    expect(localizeTranslationLine('--- Logging error ---')).toBe(
      'BabelDOC 日志编码提示（不影响翻译）',
    );
    expect(
      localizeTranslationLine(
        "UnicodeEncodeError: 'gbk' codec can't encode character '\\xce'",
      ),
    ).toBe('');
    expect(localizeTranslationLine('Traceback (most recent call last)')).toBe('');
    expect(
      localizeTranslationLine('INFO:babeldoc.docvision.base_ base_doclayout.py:43'),
    ).toBe('');
  });

  it('collapses the broken Rich deprecation warning into one notice', () => {
    const notice = 'BabelDOC 提示：水印输出模式已弃用（不影响翻译）';
    expect(localizeTranslationLine('atermark output mode is deprecated')).toBe(
      notice,
    );
    expect(localizeTranslationLine('adds a watermark; it')).toBe(notice);
    expect(localizeTranslationLine('still controls output')).toBe(notice);
  });

  it('leaves Chinese lines untouched and trims control characters', () => {
    expect(localizeTranslationLine('AI 已返回 8 段，等待返回 2 段')).toBe(
      'AI 已返回 8 段，等待返回 2 段',
    );
    expect(localizeTranslationLine('\u0007')).toBe('');
  });
});

describe('formatTranslationLogs', () => {
  it('localizes, drops logging noise, and collapses consecutive duplicates', () => {
    expect(
      formatTranslationLogs([
        'Parsing PDF...',
        'Parsing PDF...',
        "UnicodeEncodeError: 'gbk' codec can't encode character",
        'Saving file',
      ]),
    ).toEqual(['正在解析 PDF…', '正在保存译本文件…']);
  });

  it('keeps repeated non-consecutive messages', () => {
    expect(
      formatTranslationLogs([
        'Translating paragraphs',
        'Saving file',
        'Translating paragraphs',
      ]),
    ).toEqual([
      '正在调用 AI 逐段翻译…',
      '正在保存译本文件…',
      '正在调用 AI 逐段翻译…',
    ]);
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
