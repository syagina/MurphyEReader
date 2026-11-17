import type {
  AnnotationDrawing,
  AnnotationKind,
  AnnotationMarkStyle,
  AnnotationPin,
  AnnotationPopupPlacement,
  AnnotationShape,
  AnnotationShapeData,
  AnnotationStroke,
  PdfVersion,
  StickyNoteAnchor,
  StickyNoteCreateData,
  StickyNoteRect,
  StickyNoteSource,
  StickyNoteUpdatePatch,
} from './types';

export const PDF_VERSION_LABELS: Record<PdfVersion, string> = {
  original: '原文',
  translated: '仅译文',
  bilingual: '中英对照',
};

export function pdfVersionLabel(version: PdfVersion): string {
  return PDF_VERSION_LABELS[version];
}

export const STICKY_NOTE_SOURCE_LABELS: Record<StickyNoteSource, string> = {
  manual: '手动',
  translation: '翻译',
  ai: 'AI',
};

export const STICKY_NOTE_LIMITS = {
  quote: 50_000,
  contentMd: 200_000,
  rects: 500,
} as const;

export const ANNOTATION_DEFAULT_HIGHLIGHT_COLOR = '#facc15';
export const ANNOTATION_DEFAULT_MARK_COLOR = '#ef4444';

const RECT_EPSILON = 1e-6;
const PDF_VERSIONS: readonly PdfVersion[] = ['original', 'translated', 'bilingual'];
const STICKY_NOTE_SOURCES: readonly StickyNoteSource[] = [
  'manual',
  'translation',
  'ai',
];
const ANNOTATION_KINDS: readonly AnnotationKind[] = [
  'note',
  'mark',
  'ink',
  'shape',
];
const ANNOTATION_MARK_STYLES: readonly AnnotationMarkStyle[] = [
  'highlight',
  'underline',
  'double-underline',
  'dotted-underline',
  'wavy-underline',
  'strikeout',
  'none',
];
const ANNOTATION_SHAPES: readonly AnnotationShape[] = [
  'line',
  'rect',
  'ellipse',
  'arrow',
];
const ANNOTATION_UPDATE_KEYS: readonly (keyof StickyNoteUpdatePatch)[] = [
  'contentMd',
  'markStyle',
  'color',
  'pin',
  'popup',
];
const ANNOTATION_STROKE_MAX_POINTS = 4_000;
const ANNOTATION_WIDTH_MIN = 0.5;
const ANNOTATION_WIDTH_MAX = 32;
const ANNOTATION_OPACITY_MIN = 0;
const ANNOTATION_OPACITY_MAX = 1;
const ANNOTATION_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

export function isPdfVersion(value: unknown): value is PdfVersion {
  return typeof value === 'string' && PDF_VERSIONS.includes(value as PdfVersion);
}

export function isStickyNoteSource(value: unknown): value is StickyNoteSource {
  return (
    typeof value === 'string' &&
    STICKY_NOTE_SOURCES.includes(value as StickyNoteSource)
  );
}

export function isStickyNoteRect(value: unknown): value is StickyNoteRect {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const rect = value as Record<string, unknown>;
  const { x, y, width, height } = rect;
  if (
    typeof x !== 'number' ||
    typeof y !== 'number' ||
    typeof width !== 'number' ||
    typeof height !== 'number'
  ) {
    return false;
  }
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height)
  ) {
    return false;
  }
  if (x < 0 || y < 0 || width <= 0 || height <= 0) {
    return false;
  }
  if (
    x + width > 1 + RECT_EPSILON ||
    y + height > 1 + RECT_EPSILON
  ) {
    return false;
  }
  return true;
}

export function isStickyNoteAnchor(value: unknown): value is StickyNoteAnchor {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const anchor = value as Record<string, unknown>;
  if (anchor.kind === 'page') {
    return true;
  }
  if (anchor.kind !== 'text' || !Array.isArray(anchor.rects)) {
    return false;
  }
  if (anchor.rects.length === 0 || anchor.rects.length > STICKY_NOTE_LIMITS.rects) {
    return false;
  }
  return anchor.rects.every(isStickyNoteRect);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNormalizedUnit(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
  );
}

function isNormalizedPoint(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    isNormalizedUnit(value[0]) &&
    isNormalizedUnit(value[1])
  );
}

function isAnnotationWidth(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= ANNOTATION_WIDTH_MIN &&
    value <= ANNOTATION_WIDTH_MAX
  );
}

function isAnnotationOpacity(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= ANNOTATION_OPACITY_MIN &&
    value <= ANNOTATION_OPACITY_MAX
  );
}

export function isAnnotationColor(value: unknown): value is string {
  return typeof value === 'string' && ANNOTATION_COLOR_PATTERN.test(value);
}

export function isAnnotationKind(value: unknown): value is AnnotationKind {
  return (
    typeof value === 'string' &&
    ANNOTATION_KINDS.includes(value as AnnotationKind)
  );
}

export function isAnnotationMarkStyle(
  value: unknown,
): value is AnnotationMarkStyle {
  return (
    typeof value === 'string' &&
    ANNOTATION_MARK_STYLES.includes(value as AnnotationMarkStyle)
  );
}

export function isAnnotationShape(value: unknown): value is AnnotationShape {
  return (
    typeof value === 'string' &&
    ANNOTATION_SHAPES.includes(value as AnnotationShape)
  );
}

export function isAnnotationPin(value: unknown): value is AnnotationPin {
  if (!isRecord(value)) {
    return false;
  }
  return (
    isNormalizedUnit(value.x) &&
    isNormalizedUnit(value.y) &&
    typeof value.visible === 'boolean'
  );
}

export function isAnnotationPopupPlacement(
  value: unknown,
): value is AnnotationPopupPlacement {
  if (!isRecord(value)) {
    return false;
  }
  if (value.mode === 'anchor' || value.mode === 'right') {
    return true;
  }
  return (
    value.mode === 'free' &&
    isNormalizedUnit(value.x) &&
    isNormalizedUnit(value.y)
  );
}

export function isAnnotationStroke(value: unknown): value is AnnotationStroke {
  if (!isRecord(value)) {
    return false;
  }
  if (value.tool !== 'pen' && value.tool !== 'highlighter') {
    return false;
  }
  if (!isAnnotationColor(value.color)) {
    return false;
  }
  if (
    !isAnnotationWidth(value.width) ||
    !isAnnotationOpacity(value.opacity)
  ) {
    return false;
  }
  if (!Array.isArray(value.points)) {
    return false;
  }
  if (
    value.points.length < 2 ||
    value.points.length > ANNOTATION_STROKE_MAX_POINTS
  ) {
    return false;
  }
  return value.points.every(isNormalizedPoint);
}

export function isAnnotationShapeData(
  value: unknown,
): value is AnnotationShapeData {
  if (!isRecord(value)) {
    return false;
  }
  return (
    isAnnotationShape(value.shape) &&
    isAnnotationColor(value.color) &&
    isAnnotationWidth(value.width) &&
    isAnnotationOpacity(value.opacity) &&
    isNormalizedPoint(value.start) &&
    isNormalizedPoint(value.end)
  );
}

export function isAnnotationDrawing(
  value: unknown,
): value is AnnotationDrawing {
  return isAnnotationStroke(value) || isAnnotationShapeData(value);
}

function copyAnnotationPin(pin: AnnotationPin): AnnotationPin {
  return { x: pin.x, y: pin.y, visible: pin.visible };
}

function copyAnnotationPopup(
  popup: AnnotationPopupPlacement,
): AnnotationPopupPlacement {
  return popup.mode === 'free'
    ? { mode: 'free', x: popup.x, y: popup.y }
    : { mode: popup.mode };
}

function copyAnnotationDrawing(drawing: AnnotationDrawing): AnnotationDrawing {
  if (isAnnotationStroke(drawing)) {
    return {
      tool: drawing.tool,
      color: drawing.color,
      width: drawing.width,
      opacity: drawing.opacity,
      points: drawing.points.map(([x, y]) => [x, y] as [number, number]),
    };
  }
  return {
    shape: drawing.shape,
    color: drawing.color,
    width: drawing.width,
    opacity: drawing.opacity,
    start: [drawing.start[0], drawing.start[1]],
    end: [drawing.end[0], drawing.end[1]],
  };
}

function inputError(message: string): never {
  throw new Error(message);
}

function parseAnnotationJson(raw: string | null): unknown {
  if (typeof raw !== 'string') {
    return null;
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

/** Parses stored kind, falling back to derivation when the value is unknown. */
export function parseAnnotationKind(
  raw: string | null,
  contentMd: string,
  markStyle: AnnotationMarkStyle,
  drawing: AnnotationDrawing | null,
): AnnotationKind {
  if (isAnnotationKind(raw)) {
    return raw;
  }
  if (contentMd.trim() !== '') {
    return 'note';
  }
  if (drawing !== null) {
    return isAnnotationShapeData(drawing) ? 'shape' : 'ink';
  }
  return markStyle !== 'none' ? 'mark' : 'note';
}

/** Parses stored mark style, degrading unknown values to highlight. */
export function parseAnnotationMarkStyle(
  raw: string | null,
): AnnotationMarkStyle {
  return isAnnotationMarkStyle(raw) ? raw : 'highlight';
}

/** Parses a stored color, degrading invalid values to null and lowercasing. */
export function parseAnnotationColor(raw: string | null): string | null {
  return isAnnotationColor(raw) ? raw.toLowerCase() : null;
}

/** Parses stored pin JSON, degrading corrupt data to null. */
export function parseAnnotationPin(raw: string | null): AnnotationPin | null {
  const value = parseAnnotationJson(raw);
  return isAnnotationPin(value) ? copyAnnotationPin(value) : null;
}

/** Parses stored popup JSON, degrading corrupt data to null. */
export function parseAnnotationPopup(
  raw: string | null,
): AnnotationPopupPlacement | null {
  const value = parseAnnotationJson(raw);
  return isAnnotationPopupPlacement(value) ? copyAnnotationPopup(value) : null;
}

/** Parses stored drawing JSON, degrading corrupt data to null. */
export function parseAnnotationDrawing(
  raw: string | null,
): AnnotationDrawing | null {
  const value = parseAnnotationJson(raw);
  return isAnnotationDrawing(value) ? copyAnnotationDrawing(value) : null;
}

/**
 * Validates and copies a renderer payload before it reaches the database.
 * Database rows are trusted, but their anchor JSON is still parsed defensively
 * by `parseStickyNoteAnchor`.
 */
export function validateStickyNoteCreateInput(
  value: unknown,
): StickyNoteCreateData {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    inputError('标注输入无效');
  }
  const input = value as Record<string, unknown>;

  if (
    typeof input.paperId !== 'number' ||
    !Number.isInteger(input.paperId) ||
    input.paperId <= 0
  ) {
    inputError('标注的文献 ID 无效');
  }
  if (!isPdfVersion(input.pdfVersion)) {
    inputError('标注的 PDF 版本无效');
  }
  if (
    typeof input.pageNo !== 'number' ||
    !Number.isInteger(input.pageNo) ||
    input.pageNo < 1
  ) {
    inputError('标注的页码无效');
  }
  if (typeof input.quote !== 'string') {
    inputError('标注引用必须是文本');
  }
  if (input.quote.length > STICKY_NOTE_LIMITS.quote) {
    inputError(`标注引用不能超过 ${STICKY_NOTE_LIMITS.quote} 个字符`);
  }
  if (typeof input.contentMd !== 'string') {
    inputError('标注内容必须是文本');
  }
  if (input.contentMd.length > STICKY_NOTE_LIMITS.contentMd) {
    inputError(`标注内容不能超过 ${STICKY_NOTE_LIMITS.contentMd} 个字符`);
  }
  if (!isStickyNoteSource(input.source)) {
    inputError('标注来源无效');
  }
  if (!isStickyNoteAnchor(input.anchor)) {
    if (
      typeof input.anchor === 'object' &&
      input.anchor !== null &&
      (input.anchor as Record<string, unknown>).kind === 'text'
    ) {
      inputError('标注的选区矩形无效');
    }
    inputError('标注锚点无效');
  }

  const anchor: StickyNoteAnchor =
    input.anchor.kind === 'page'
      ? { kind: 'page' }
      : {
          kind: 'text',
          rects: input.anchor.rects.map((rect) => ({
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
          })),
        };
  const quote = input.quote;
  const contentMd = input.contentMd;

  let drawing: AnnotationDrawing | null = null;
  const rawDrawing = input.drawing;
  if (rawDrawing !== undefined && rawDrawing !== null) {
    if (!isAnnotationDrawing(rawDrawing)) {
      inputError('绘制数据无效');
    }
    drawing = copyAnnotationDrawing(rawDrawing);
  }

  let declaredKind: AnnotationKind | null = null;
  const rawKind = input.kind;
  if (rawKind !== undefined) {
    if (!isAnnotationKind(rawKind)) {
      inputError('标注类型无效');
    }
    declaredKind = rawKind;
  }

  const drawingKind: AnnotationKind | null =
    declaredKind === 'ink' || declaredKind === 'shape'
      ? declaredKind
      : declaredKind === null && drawing !== null
        ? isAnnotationShapeData(drawing)
          ? 'shape'
          : 'ink'
        : null;

  let markStyle: AnnotationMarkStyle;
  const rawMarkStyle = input.markStyle;
  if (rawMarkStyle === undefined) {
    markStyle = drawingKind === null ? 'highlight' : 'none';
  } else if (!isAnnotationMarkStyle(rawMarkStyle)) {
    inputError('标注样式无效');
  } else {
    markStyle = rawMarkStyle;
  }

  let color: string | null = null;
  const rawColor = input.color;
  if (rawColor !== undefined && rawColor !== null) {
    if (typeof rawColor !== 'string' || !isAnnotationColor(rawColor)) {
      inputError('标注颜色无效');
    }
    color = rawColor.toLowerCase();
  }

  let pin: AnnotationPin | null = null;
  const rawPin = input.pin;
  if (rawPin !== undefined && rawPin !== null) {
    if (!isAnnotationPin(rawPin)) {
      inputError('标注图标位置无效');
    }
    pin = copyAnnotationPin(rawPin);
  }

  let popup: AnnotationPopupPlacement | null = null;
  const rawPopup = input.popup;
  if (rawPopup !== undefined && rawPopup !== null) {
    if (!isAnnotationPopupPlacement(rawPopup)) {
      inputError('标注弹窗位置无效');
    }
    popup = copyAnnotationPopup(rawPopup);
  }

  const hasContent = contentMd.trim() !== '';
  let kind: AnnotationKind;

  if (drawingKind !== null) {
    kind = drawingKind;
    if (drawing === null) {
      inputError('绘制标注缺少绘制数据');
    }
    if (
      (kind === 'ink' && !isAnnotationStroke(drawing)) ||
      (kind === 'shape' && !isAnnotationShapeData(drawing))
    ) {
      inputError('绘制标注数据无效');
    }
    if (hasContent) {
      inputError('绘制标注不能包含内容');
    }
    if (quote.trim() !== '') {
      inputError('绘制标注不能包含引用');
    }
    if (anchor.kind !== 'page') {
      inputError('绘制标注必须使用整页锚点');
    }
    if (markStyle !== 'none') {
      inputError('绘制标注不能使用正文标记');
    }
    if (color !== null) {
      inputError('绘制标注不能设置正文标记颜色');
    }
    if (pin !== null || popup !== null) {
      inputError('绘制标注不能设置图标或弹窗');
    }
  } else {
    if (drawing !== null) {
      inputError('便签或标记不能包含绘制数据');
    }
    if (hasContent) {
      kind = 'note';
    } else if (markStyle !== 'none') {
      kind = 'mark';
    } else {
      inputError('请填写内容或选择一种正文标记');
    }
    if (anchor.kind === 'page') {
      if (kind !== 'note') {
        inputError('整页标注必须填写内容');
      }
      markStyle = 'none';
      color = null;
    } else if (kind === 'mark' && (pin !== null || popup !== null)) {
      inputError('纯标记不能设置图标或弹窗');
    }
    if (markStyle === 'none' && color !== null) {
      inputError('无正文标记时不能设置颜色');
    }
  }

  return {
    paperId: input.paperId,
    pdfVersion: input.pdfVersion,
    pageNo: input.pageNo,
    quote,
    contentMd,
    anchor,
    source: input.source,
    kind,
    markStyle,
    color,
    pin,
    popup,
    drawing,
  };
}

export function validateStickyNoteUpdatePatch(
  value: unknown,
): StickyNoteUpdatePatch {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    inputError('标注更新输入无效');
  }
  const patch = value as Record<string, unknown>;
  const has = (key: string): boolean =>
    Object.prototype.hasOwnProperty.call(patch, key);

  for (const key of Object.keys(patch)) {
    if (!(ANNOTATION_UPDATE_KEYS as readonly string[]).includes(key)) {
      inputError('标注更新字段无效');
    }
  }
  if (!ANNOTATION_UPDATE_KEYS.some((key) => has(key))) {
    inputError('标注更新字段无效');
  }

  const result: StickyNoteUpdatePatch = {};

  if (has('contentMd')) {
    if (typeof patch.contentMd !== 'string') {
      inputError('标注内容必须是文本');
    }
    if (patch.contentMd.length > STICKY_NOTE_LIMITS.contentMd) {
      inputError(`标注内容不能超过 ${STICKY_NOTE_LIMITS.contentMd} 个字符`);
    }
    result.contentMd = patch.contentMd;
  }
  if (has('markStyle')) {
    if (!isAnnotationMarkStyle(patch.markStyle)) {
      inputError('标注样式无效');
    }
    result.markStyle = patch.markStyle;
  }
  if (has('color')) {
    const color = patch.color;
    if (color !== null && !isAnnotationColor(color)) {
      inputError('标注颜色无效');
    }
    result.color = color === null ? null : color.toLowerCase();
  }
  if (has('pin')) {
    const pin = patch.pin;
    if (pin !== null && !isAnnotationPin(pin)) {
      inputError('标注图标位置无效');
    }
    result.pin = pin === null ? null : copyAnnotationPin(pin);
  }
  if (has('popup')) {
    const popup = patch.popup;
    if (popup !== null && !isAnnotationPopupPlacement(popup)) {
      inputError('标注弹窗位置无效');
    }
    result.popup = popup === null ? null : copyAnnotationPopup(popup);
  }

  return result;
}

/** Parses stored anchor JSON, degrading corrupt data to a page marker. */
export function parseStickyNoteAnchor(raw: string): StickyNoteAnchor {
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    return { kind: 'page' };
  }
  return isStickyNoteAnchor(value) ? value : { kind: 'page' };
}
