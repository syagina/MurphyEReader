import type { TranslationTarget } from './types';

/** Longest selection accepted by free-selection translation, in code points. */
export const TRANSLATION_MAX_CHARS = 6000;

/** Whole-paper translation speed settings exposed in the settings dialog. */
export const TRANSLATION_QPS_MIN = 1;
export const TRANSLATION_QPS_MAX = 512;
export const TRANSLATION_QPS_DEFAULT = 128;

/** Parallel BabelDOC workers, configured independently of the request rate. */
export const TRANSLATION_WORKERS_MIN = 1;
export const TRANSLATION_WORKERS_MAX = 512;
export const TRANSLATION_WORKERS_DEFAULT = 128;

/** Clamps the configured request rate to BabelDOC's positive-integer range. */
export function normalizeTranslationQps(value: number): number {
  if (!Number.isFinite(value)) {
    return TRANSLATION_QPS_DEFAULT;
  }
  return Math.round(
    Math.min(TRANSLATION_QPS_MAX, Math.max(TRANSLATION_QPS_MIN, value)),
  );
}

/** Clamps the configured worker-pool size to a positive integer. */
export function normalizeTranslationWorkers(value: number): number {
  if (!Number.isFinite(value)) {
    return TRANSLATION_WORKERS_DEFAULT;
  }
  return Math.round(
    Math.min(
      TRANSLATION_WORKERS_MAX,
      Math.max(TRANSLATION_WORKERS_MIN, value),
    ),
  );
}

/** Exact user-facing messages of free-selection translation. */
export const TRANSLATION_EMPTY_SELECTION = '请先选择要翻译的文本';
export const TRANSLATION_TOO_LONG = '选中文本过长，请分段翻译';
export const TRANSLATION_NOT_CONFIGURED = '请先在设置中配置 AI 接口';
export const TRANSLATION_EMPTY_RESULT = '翻译结果为空，请重试';
export const TRANSLATION_FAILED = '翻译失败，请稍后重试';

/** Exact user-facing messages of whole-paper BabelDOC translation. */
export const TRANSLATION_ENGINE_MISSING = '未检测到 BabelDOC，请在设置中安装或指定路径';
export const TRANSLATION_ALREADY_CHINESE = '这篇看起来已是中文文献';
export const TRANSLATION_NO_TEXT_LAYER =
  '该文献是扫描件，没有文字层，无法翻译；请先自行 OCR 生成可搜索 PDF 后重试';
export const TRANSLATION_ORIGINAL_MISSING = '原文文件不存在';
export const TRANSLATION_OUTPUT_MISSING = '未找到翻译输出';
export const TRANSLATION_OUTPUT_AMBIGUOUS = '翻译输出不唯一';
export const TRANSLATION_OUTPUT_INVALID = '翻译输出文件无效';
export const TRANSLATION_OUTPUT_INCOMPLETE = '翻译结果不完整，请重新翻译';
export const TRANSLATION_PAPER_EMPTY_RESULT =
  'AI 多次返回空翻译结果，请稍后重试或更换模型';
/** Shown after an existing lossy mono binding was switched to its dual. */
export const TRANSLATION_REPAIRED_NOTICE =
  '检测到旧译本缺少部分内容，已自动切换到双语对照版';

/** Human-readable names used in prompts and the translation card. */
export const TRANSLATION_TARGET_LABELS: Record<TranslationTarget, string> = {
  'zh-CN': '简体中文',
  en: 'English',
};

/** Formats a running translation's elapsed time for the status card. */
export function formatTranslationElapsed(milliseconds: number): string {
  const total = Math.max(0, Math.floor(milliseconds / 1000));
  if (total < 60) {
    return `${total} 秒`;
  }
  const minutes = Math.floor(total / 60);
  if (minutes < 60) {
    const seconds = total % 60;
    return seconds === 0 ? `${minutes} 分钟` : `${minutes} 分 ${seconds} 秒`;
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} 小时` : `${hours} 小时 ${rest} 分`;
}

// eslint-disable-next-line no-control-regex
const ANSI_ESCAPE = /\u001b\[[0-?]*[ -/]*[@-~]/g;
const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

/** Stages BabelDOC reports while working through a paper. */
export type TranslationStage =
  | 'model'
  | 'parse'
  | 'scan'
  | 'layout'
  | 'table'
  | 'paragraph'
  | 'formula'
  | 'term'
  | 'translate'
  | 'typeset'
  | 'drawing'
  | 'save';

const TRANSLATION_STAGE_LABELS: Record<TranslationStage, string> = {
  model: '正在加载版面分析模型…',
  parse: '正在解析 PDF…',
  scan: '正在检测扫描页…',
  layout: '正在分析页面版面…',
  table: '正在解析表格…',
  paragraph: '正在解析段落…',
  formula: '正在解析公式与样式…',
  term: '正在提取专业术语…',
  translate: '正在调用 AI 逐段翻译…',
  typeset: '正在按原文版式排版…',
  drawing: '正在生成绘图指令…',
  save: '正在保存译本文件…',
};

const TRANSLATION_STAGE_PROGRESS_LABELS: Record<TranslationStage, string> = {
  model: '模型加载进度',
  parse: 'PDF 解析进度',
  scan: '扫描页检测进度',
  layout: '版面分析进度',
  table: '表格解析进度',
  paragraph: '段落解析进度',
  formula: '公式解析进度',
  term: '术语提取进度',
  translate: '翻译进度',
  typeset: '排版进度',
  drawing: '绘图指令进度',
  save: '保存进度',
};

const TRANSLATION_STAGE_PATTERNS: ReadonlyArray<
  readonly [RegExp, TranslationStage]
> = [
  [
    /loading onnx|available provider|cpu(?:execution)?provider|doclayout:|^model\.{2,}$/i,
    'model',
  ],
  [/automatic term extraction|term extraction|glossary|术语提取/i, 'term'],
  [/generate drawing instructions|drawing instructions/i, 'drawing'],
  [/typeset|typesetting/i, 'typeset'],
  [
    /translate paragraphs|translating paragraphs|\btranslating\b|\btranslate\b/i,
    'translate',
  ],
  [/parse page layout|layout analy|layout analysis|page layout/i, 'layout'],
  [/parse table|parsing table|table processing/i, 'table'],
  [/parse paragraphs|parsing paragraphs|paragraph extraction/i, 'paragraph'],
  [/parse formulas|formulas and styles|formula processing/i, 'formula'],
  [/detectscannedfile|detect scanned|scanned file/i, 'scan'],
  [/parse pdf|parsing pdf|intermediate representation/i, 'parse'],
  [
    /saving file|saving output|writing output|export(?:ing)? (?:file|output)/i,
    'save',
  ],
];

function cleanTranslationLine(line: string): string {
  return line
    .replace(ANSI_ESCAPE, '')
    .replace(CONTROL_CHARS, '')
    .replace(/^\[\d{2}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}\]\s*/, '')
    .trim();
}

/** Detects the BabelDOC stage named by a raw progress/log line. */
export function translationStage(line: string): TranslationStage | null {
  const text = cleanTranslationLine(line);
  if (text === '' || /[㐀-䶿一-鿿]/.test(text) || isRichLoggingNoise(text)) {
    return null;
  }
  for (const [pattern, stage] of TRANSLATION_STAGE_PATTERNS) {
    if (pattern.test(text)) {
      return stage;
    }
  }
  return null;
}

/** Short Chinese phrase for the heartbeat, optionally with stage progress. */
export function translationStageText(
  stage: TranslationStage,
  percent: number | null,
): string {
  const label = TRANSLATION_STAGE_LABELS[stage].replace(/…$/, '');
  return percent === null ? `${label}…` : `${label}：${percent}%…`;
}

function translationLinePercent(text: string): number | null {
  const percent = /(\d{1,3})\s*%/.exec(text);
  if (percent !== null) {
    return Math.min(100, Number(percent[1]));
  }
  // BabelDOC's rich progress prints `translate ... 42/100` in pipes.
  const fraction = /\b(\d{1,3})\s*\/\s*100\b/.exec(text);
  return fraction === null ? null : Math.min(100, Number(fraction[1]));
}

/**
 * Rich/Python logging noise on Chinese Windows: a GBK encoding failure inside
 * Rich's logging handler, plus its traceback and source-location lines. None
 * of it affects the translation itself.
 */
function isRichLoggingNoise(text: string): boolean {
  if (
    /UnicodeEncodeError|codec can't encode|_windows_renderer|rich[\\/](?:logging|console|_win32_console|__init__)\.py/i.test(
      text,
    )
  ) {
    return true;
  }
  if (/^Traceback \(most recent call last\)/i.test(text)) {
    return true;
  }
  if (/^File ".+", line \d+, in /.test(text)) {
    return true;
  }
  if (/^\s*\^+\s*$/.test(text)) {
    return true;
  }
  if (/^(?:self|await|return|raise|with|response|result|cache)\s*[.(]/i.test(text)) {
    return true;
  }
  // Rich prints the logging call site as e.g. `INFO:babeldoc.foo:bar.py:43`.
  return /^(?:INFO|WARNING|ERROR|DEBUG|CRITICAL)(?::|\s)+.*\.py:\d+$/i.test(
    text,
  );
}

/**
 * Turns BabelDOC's English progress output into a short Chinese status line.
 * Already-Chinese lines (including our own heartbeat) pass through unchanged;
 * unknown technical output stays visible with a Chinese label so failures can
 * still be diagnosed. Known Rich/Python logging noise is hidden because it is
 * a Windows encoding artifact, not a translation failure.
 */
export function localizeTranslationLine(line: string): string {
  const text = cleanTranslationLine(line);
  if (text === '' || /[㐀-䶿一-鿿]/.test(text)) {
    return text;
  }
  if (/paperlens_empty_translation/i.test(text)) {
    return 'AI 返回了空翻译，正在自动重试…';
  }
  if (/paperlens_upstream_unreachable/i.test(text)) {
    return '无法连接 AI 接口，正在自动重试…';
  }
  if (/---\s*Logging error\s*---/i.test(text)) {
    return 'BabelDOC 日志编码提示（不影响翻译）';
  }
  if (isRichLoggingNoise(text)) {
    return '';
  }
  if (
    /watermark|deprecated|adds a watermark|still controls output|file names and count/i.test(
      text,
    )
  ) {
    return 'BabelDOC 提示：水印输出模式已弃用（不影响翻译）';
  }
  if (/\b429\b|rate ?limit|too many requests|retry(?:ing)?\b/i.test(text)) {
    return 'AI 接口繁忙或触发限流，正在自动重试…';
  }
  // Checked before progress patterns: a failure line often mentions parsing
  // or translation too and must not read as progress.
  if (/error|fail|exception|traceback/i.test(text)) {
    return `BabelDOC 报告错误：${text}`;
  }
  if (/\b(?:done|finished|complete)\b/i.test(text)) {
    return 'BabelDOC 处理完成';
  }
  const stage = translationStage(text);
  const percent = translationLinePercent(text);
  if (percent !== null) {
    return stage === null
      ? `BabelDOC 处理进度：${percent}%`
      : `BabelDOC ${TRANSLATION_STAGE_PROGRESS_LABELS[stage]}：${percent}%`;
  }
  if (stage !== null) {
    return TRANSLATION_STAGE_LABELS[stage];
  }
  return `BabelDOC 技术信息：${text}`;
}

/**
 * Localizes a batch of raw log lines and collapses consecutive duplicates.
 * Empty results are omission lines (Rich logging noise), not log content.
 */
export function formatTranslationLogs(lines: readonly string[]): string[] {
  const formatted: string[] = [];
  for (const line of lines) {
    const localized = localizeTranslationLine(line);
    if (localized === '' || formatted[formatted.length - 1] === localized) {
      continue;
    }
    formatted.push(localized);
  }
  return formatted;
}

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
