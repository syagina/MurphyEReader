import { win32 } from 'node:path';
import { PDFDocument, PDFDict, PDFHexString, PDFName, PDFString } from 'pdf-lib';
import type { PDFPage } from 'pdf-lib';
import type {
  AnnotationShape,
  AnnotationShapeData,
  AnnotationStroke,
  StickyNote,
} from '@shared/types';
import {
  ANNOTATION_DEFAULT_HIGHLIGHT_COLOR,
  ANNOTATION_DEFAULT_MARK_COLOR,
  isAnnotationShapeData,
  isAnnotationStroke,
} from '@shared/sticky-notes';
import {
  displayNormalizedToPdfPoint,
  displayPageSize,
  displayRectToPdfQuad,
  normalizeRotation,
  quadToRect,
} from './annotation-rotation';
import type { PageRect, PdfPoint, PdfQuad, Rotation } from './annotation-rotation';

export interface AnnotatedPdfResult {
  bytes: Uint8Array;
  /** Notes that became annotations; a double underline still counts once. */
  exported: number;
  /** Notes that could not be rendered or whose page is outside the document. */
  skipped: number;
}

const MAX_CONTENTS_LENGTH = 10_000;
const TRUNCATION_SUFFIX = '…（内容过长，已截断）';
const PIN_INSET = 24;
const PIN_STEP = 24;
const PIN_RADIUS = 10;
const HIGHLIGHT_OPACITY = 0.35;
/** The second underline sits this many PDF points above the first one. */
const DOUBLE_UNDERLINE_OFFSET = 2;

type BodyMarkStyle = Exclude<StickyNote['markStyle'], 'none'>;

const MARK_SUBTYPES: Record<BodyMarkStyle, string> = {
  highlight: 'Highlight',
  underline: 'Underline',
  'double-underline': 'Underline',
  'dotted-underline': 'Underline',
  'wavy-underline': 'Squiggly',
  strikeout: 'StrikeOut',
};

/** A line and an arrow share `/Line`; the arrow only adds its `/LE` array. */
const SHAPE_SUBTYPES: Record<AnnotationShape, string> = {
  line: 'Line',
  arrow: 'Line',
  rect: 'Square',
  ellipse: 'Circle',
};

/** Windows path identity: case-insensitive and separator-insensitive. */
export function samePath(a: string, b: string): boolean {
  return normalizeForCompare(a) === normalizeForCompare(b);
}

function normalizeForCompare(filePath: string): string {
  return win32.normalize(filePath.replace(/\//g, '\\')).toLowerCase();
}

/**
 * Refuses to write an exported copy over any PDF the library manages.
 * `managedPaths` may contain nulls for unbound or absent variants.
 */
export function assertNotManagedPdfTarget(
  target: string,
  managedPaths: Array<string | null | undefined>,
): void {
  const managed = managedPaths.some(
    (path) => path !== null && path !== undefined && path !== '' && samePath(path, target),
  );
  if (managed) {
    throw new Error('不能覆盖文献库中的 PDF，请选择其他文件名');
  }
}

/**
 * Converts the app's Markdown subset to plain text for a PDF annotation.
 * Formatting markers are dropped; code is kept, and citation markers such as
 * `[p.3]` survive as readable text.
 */
export function markdownToPlainText(markdown: string): string {
  const withoutFences = markdown.replace(/```[^\n]*\n?/g, '').replace(/```/g, '');
  const lines = withoutFences.split('\n').map((line) =>
    line
      .replace(/^\s{0,3}#{1,6}\s+/, '')
      .replace(/^\s{0,3}>\s?/, '')
      .replace(/^\s*[-*+]\s+/, '')
      .replace(/^\s*\d+[.)]\s+/, '')
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/__([^_]+)__/g, '$1')
      .replace(/\*([^*\n]+)\*/g, '$1')
      .replace(/_([^_\n]+)_/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\$([^$\n]+)\$/g, '$1'),
  );
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function annotationContents(note: StickyNote): string {
  const text = ['【原文】', note.quote.trim(), '', '【标注】', markdownToPlainText(note.contentMd)]
    .join('\n')
    .trimEnd();
  if (text.length <= MAX_CONTENTS_LENGTH) {
    return text;
  }
  return `${text.slice(0, MAX_CONTENTS_LENGTH)}${TRUNCATION_SUFFIX}`;
}

/** The visible page area, preferring a valid CropBox over the MediaBox. */
function pageRect(page: PDFPage): PageRect {
  const crop = page.getCropBox();
  if (crop.width > 0 && crop.height > 0) {
    return crop;
  }
  return page.getMediaBox();
}

/** A body mark's PDF subtype, or null when the note has no body mark. */
function markSubtype(style: StickyNote['markStyle']): string | null {
  return style === 'none' ? null : MARK_SUBTYPES[style];
}

/** The note's own color, falling back to the default for its mark style. */
function annotationColor(note: StickyNote): string {
  return (
    note.color ??
    (note.markStyle === 'highlight'
      ? ANNOTATION_DEFAULT_HIGHLIGHT_COLOR
      : ANNOTATION_DEFAULT_MARK_COLOR)
  );
}

/** `#rrggbb` to the three 0..1 channels a PDF `/C` entry expects. */
function hexToRgb01(hex: string): [number, number, number] {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (match === null) {
    return [1, 0, 0];
  }
  return [
    Number.parseInt(match[1] ?? 'ff', 16) / 255,
    Number.parseInt(match[2] ?? 'ff', 16) / 255,
    Number.parseInt(match[3] ?? 'ff', 16) / 255,
  ];
}

/** `/NM` value; double underlines distinguish their two PDF annotations. */
function annotationNm(id: number, suffix: string): string {
  return suffix === ''
    ? `paperlens-annotation-${id}`
    : `paperlens-annotation-${id}-${suffix}`;
}

/**
 * Maps every anchor rect from display coordinates to PDF quads.
 * `shiftBottomUp` moves the display bottom edge up by
 * `DOUBLE_UNDERLINE_OFFSET` PDF points for the second underline.
 */
function markQuads(
  note: StickyNote,
  area: PageRect,
  rotation: Rotation,
  shiftBottomUp: boolean,
): PdfQuad[] {
  if (note.anchor.kind !== 'text') {
    return [];
  }
  const display = displayPageSize(area, rotation);
  const offset =
    shiftBottomUp && display.height > 0 ? DOUBLE_UNDERLINE_OFFSET / display.height : 0;
  return note.anchor.rects.map((rect) =>
    displayRectToPdfQuad(area, rotation, {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: Math.max(rect.height - offset, 0),
    }),
  );
}

/**
 * Adds one text-markup annotation for a note's body mark.
 * The note's contents go on the `-a`/single annotation, never on `-b`; a pure
 * mark carries no `/Contents` at all.
 */
function markAnnotationForNote(
  note: StickyNote,
  page: PDFPage,
  area: PageRect,
  rotation: Rotation,
  now: Date,
  suffix: string,
): void {
  const subtype = markSubtype(note.markStyle);
  if (subtype === null) {
    return;
  }
  const quads = markQuads(note, area, rotation, suffix === 'b');
  const bounds = quadToRect(quads.flat());
  const context = page.doc.context;
  const annotation = context.obj({
    Type: PDFName.of('Annot'),
    Subtype: PDFName.of(subtype),
    Rect: [bounds.x, bounds.y, bounds.x + bounds.width, bounds.y + bounds.height],
    QuadPoints: quads.flat().flat(),
    C: hexToRgb01(annotationColor(note)),
    F: 4,
    T: PDFHexString.fromText('MurphyEReader'),
    NM: PDFString.of(annotationNm(note.id, suffix)),
    M: PDFString.fromDate(now),
    P: page.ref,
  });
  if (note.markStyle === 'highlight') {
    annotation.set(PDFName.of('CA'), context.obj(HIGHLIGHT_OPACITY));
  }
  if (note.markStyle === 'dotted-underline') {
    // `/S /D` is the standard dashed border name; external readers may render
    // it as a solid line.
    annotation.set(
      PDFName.of('BS'),
      context.obj({ W: 1, S: PDFName.of('D'), D: [2, 2] }),
    );
  }
  if (note.kind === 'note' && suffix !== 'b') {
    annotation.set(PDFName.of('Contents'), PDFHexString.fromText(annotationContents(note)));
  }
  page.node.addAnnot(context.register(annotation));
}

/**
 * Where a `/Text` annotation's icon goes, in normalized display coordinates:
 * a visible pin wins; otherwise a text note uses its first anchor rect's center
 * and a page note uses the default top-right stack, `stackIndex` slots down.
 */
function textCenterNormalized(
  note: StickyNote,
  area: PageRect,
  rotation: Rotation,
  stackIndex: number,
): PdfPoint | null {
  const display = displayPageSize(area, rotation);
  if (note.pin !== null && note.pin.visible) {
    // The 20x20 icon's top-left is clamped inside the displayed page, matching
    // the in-app pin geometry, so a pin on the margin never lands off-page.
    const maxLeft = Math.max(1 - (PIN_RADIUS * 2) / display.width, 0);
    const maxTop = Math.max(1 - (PIN_RADIUS * 2) / display.height, 0);
    const left = Math.min(Math.max(note.pin.x, 0), maxLeft);
    const top = Math.min(Math.max(note.pin.y, 0), maxTop);
    return [left + PIN_RADIUS / display.width, top + PIN_RADIUS / display.height];
  }
  if (note.anchor.kind === 'text') {
    const rect = note.anchor.rects[0];
    if (rect === undefined) {
      return null;
    }
    return [rect.x + rect.width / 2, rect.y + rect.height / 2];
  }
  return [
    1 - PIN_INSET / display.width,
    (PIN_INSET + stackIndex * PIN_STEP) / display.height,
  ];
}

/**
 * Adds a `/Text` page-margin annotation for a note without a body mark.
 * Returns false when the note has no usable position.
 */
function textAnnotationForNote(
  note: StickyNote,
  page: PDFPage,
  area: PageRect,
  rotation: Rotation,
  now: Date,
  stackIndex: number,
): boolean {
  const normalizedCenter = textCenterNormalized(note, area, rotation, stackIndex);
  if (normalizedCenter === null) {
    return false;
  }
  const [centerX, centerY] = displayNormalizedToPdfPoint(area, rotation, normalizedCenter);
  const context = page.doc.context;
  const annotation = context.obj({
    Type: PDFName.of('Annot'),
    Subtype: PDFName.of('Text'),
    Rect: [
      centerX - PIN_RADIUS,
      centerY - PIN_RADIUS,
      centerX + PIN_RADIUS,
      centerY + PIN_RADIUS,
    ],
    Name: PDFName.of('Comment'),
    Open: false,
    F: 4,
    T: PDFHexString.fromText('MurphyEReader'),
    Contents: PDFHexString.fromText(annotationContents(note)),
    NM: PDFString.of(annotationNm(note.id, '')),
    M: PDFString.fromDate(now),
    P: page.ref,
  });
  page.node.addAnnot(context.register(annotation));
  return true;
}

/**
 * Maps one stored drawing point to PDF user space. Drawing coordinates are
 * stored in the PDF visual box's bottom-left normalized frame, so the page
 * rotation never applies and no inverse transform is needed (design §7).
 */
function drawingPoint(area: PageRect, point: readonly [number, number]): PdfPoint {
  return [area.x + point[0] * area.width, area.y + point[1] * area.height];
}

/**
 * The keys every ink/shape annotation shares. Drawings never carry
 * `/Contents`; `color` is the drawing's own color, not the note-level one.
 */
function drawingAnnotationBase(
  note: StickyNote,
  page: PDFPage,
  now: Date,
  subtype: string,
  color: string,
  bounds: PageRect,
): PDFDict {
  return page.doc.context.obj({
    Type: PDFName.of('Annot'),
    Subtype: PDFName.of(subtype),
    Rect: [bounds.x, bounds.y, bounds.x + bounds.width, bounds.y + bounds.height],
    C: hexToRgb01(color),
    F: 4,
    T: PDFHexString.fromText('MurphyEReader'),
    NM: PDFString.of(annotationNm(note.id, '')),
    M: PDFString.fromDate(now),
    P: page.ref,
  });
}

/** Adds one `/Ink` annotation for a freehand pen stroke or highlighter. */
function addInkAnnotation(
  note: StickyNote,
  drawing: AnnotationStroke,
  page: PDFPage,
  area: PageRect,
  now: Date,
): void {
  const context = page.doc.context;
  const points = drawing.points.map((point) => drawingPoint(area, point));
  const annotation = drawingAnnotationBase(
    note,
    page,
    now,
    'Ink',
    drawing.color,
    quadToRect(points),
  );
  annotation.set(PDFName.of('InkList'), context.obj([points.flat()]));
  annotation.set(PDFName.of('BS'), context.obj({ W: drawing.width }));
  if (drawing.tool === 'highlighter') {
    annotation.set(PDFName.of('CA'), context.obj(HIGHLIGHT_OPACITY));
  }
  page.node.addAnnot(context.register(annotation));
}

/** Adds one line/arrow/square/circle annotation for a geometric shape. */
function addShapeAnnotation(
  note: StickyNote,
  drawing: AnnotationShapeData,
  page: PDFPage,
  area: PageRect,
  now: Date,
): void {
  const context = page.doc.context;
  const start = drawingPoint(area, drawing.start);
  const end = drawingPoint(area, drawing.end);
  const annotation = drawingAnnotationBase(
    note,
    page,
    now,
    SHAPE_SUBTYPES[drawing.shape],
    drawing.color,
    quadToRect([start, end]),
  );
  if (drawing.shape === 'line' || drawing.shape === 'arrow') {
    annotation.set(
      PDFName.of('L'),
      context.obj([start[0], start[1], end[0], end[1]]),
    );
    if (drawing.shape === 'arrow') {
      // `/None` for the start cap, `/OpenArrow` for the end cap.
      annotation.set(
        PDFName.of('LE'),
        context.obj([PDFName.of('None'), PDFName.of('OpenArrow')]),
      );
    }
  }
  annotation.set(PDFName.of('BS'), context.obj({ W: drawing.width }));
  page.node.addAnnot(context.register(annotation));
}

/**
 * Writes the drawing on an ink/shape note. Returns false when the drawing is
 * missing, damaged, or does not match the note kind (an ink note must carry a
 * stroke and a shape note must carry shape data).
 */
function drawingAnnotationForNote(
  note: StickyNote,
  page: PDFPage,
  area: PageRect,
  now: Date,
): boolean {
  const drawing = note.drawing;
  if (drawing === null) {
    return false;
  }
  const isStroke = isAnnotationStroke(drawing);
  const isShape = isAnnotationShapeData(drawing);
  if (note.kind === 'ink') {
    if (!isStroke || isShape) {
      return false;
    }
    addInkAnnotation(note, drawing, page, area, now);
    return true;
  }
  if (!isShape) {
    return false;
  }
  addShapeAnnotation(note, drawing, page, area, now);
  return true;
}

/**
 * The in-app page-note slot order: every page-anchored note on a page sorted
 * by creation time then id. A note with a visible pin still occupies its slot,
 * so export stack indices match what the renderer shows.
 */
function pageStackIndices(
  notes: StickyNote[],
  pageCount: number,
): Map<number, number> {
  const byPage = new Map<number, StickyNote[]>();
  for (const note of notes) {
    if (
      note.kind !== 'note' ||
      note.anchor.kind !== 'page' ||
      note.pageNo < 1 ||
      note.pageNo > pageCount
    ) {
      continue;
    }
    const pageNotes = byPage.get(note.pageNo);
    if (pageNotes === undefined) {
      byPage.set(note.pageNo, [note]);
    } else {
      pageNotes.push(note);
    }
  }
  const indices = new Map<number, number>();
  for (const pageNotes of byPage.values()) {
    pageNotes.sort((a, b) => a.createdAt - b.createdAt || a.id - b.id);
    pageNotes.forEach((note, index) => {
      indices.set(note.id, index);
    });
  }
  return indices;
}

/**
 * Copies the source PDF and writes standard PDF annotations for `notes`.
 * The returned bytes are a new document; `source` is never mutated.
 *
 * Body marks become text-markup annotations mapped through the page rotation.
 * Ink and shape notes become `/Ink`, `/Line`, `/Square` or `/Circle`
 * annotations placed in the stored PDF bottom-left normalized frame.
 * A note without a body mark becomes a `/Text` annotation at its visible pin,
 * its anchor, or the default top-right page stack. Notes that cannot be
 * rendered are counted in `skipped` without aborting the export.
 */
export async function buildAnnotatedPdf(
  source: Uint8Array,
  notes: StickyNote[],
): Promise<AnnotatedPdfResult> {
  const pdf = await PDFDocument.load(source);
  const pageCount = pdf.getPageCount();
  const now = new Date();
  const stackIndexByNoteId = pageStackIndices(notes, pageCount);
  let exported = 0;
  let skipped = 0;

  for (const note of notes) {
    if (note.pageNo < 1 || note.pageNo > pageCount) {
      skipped += 1;
      continue;
    }
    if (note.kind === 'ink' || note.kind === 'shape') {
      const page = pdf.getPage(note.pageNo - 1);
      if (drawingAnnotationForNote(note, page, pageRect(page), now)) {
        exported += 1;
      } else {
        skipped += 1;
      }
      continue;
    }
    const page = pdf.getPage(note.pageNo - 1);
    const area = pageRect(page);
    const rotation = normalizeRotation(page.getRotation().angle);
    // Defensive: a legacy page-anchored note can still carry the v4
    // `mark_style` default. Only a text anchor can own a body mark.
    const hasBodyMark =
      note.markStyle !== 'none' && note.anchor.kind === 'text';

    if (hasBodyMark) {
      if (note.anchor.kind !== 'text' || note.anchor.rects.length === 0) {
        skipped += 1;
        continue;
      }
      if (note.markStyle === 'double-underline') {
        markAnnotationForNote(note, page, area, rotation, now, 'a');
        markAnnotationForNote(note, page, area, rotation, now, 'b');
      } else {
        markAnnotationForNote(note, page, area, rotation, now, '');
      }
      exported += 1;
      continue;
    }

    if (note.kind === 'mark') {
      // A pure mark without a mark style has nothing to render.
      skipped += 1;
      continue;
    }

    const usesDefaultStack =
      note.anchor.kind === 'page' && (note.pin === null || !note.pin.visible);
    const stackIndex = usesDefaultStack
      ? (stackIndexByNoteId.get(note.id) ?? 0)
      : 0;
    if (textAnnotationForNote(note, page, area, rotation, now, stackIndex)) {
      exported += 1;
    } else {
      skipped += 1;
    }
  }

  if (exported === 0) {
    throw new Error('当前版本没有可导出的标注');
  }

  const bytes = await pdf.save();
  return { bytes, exported, skipped };
}
