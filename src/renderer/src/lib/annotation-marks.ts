import {
  isAnnotationShapeData,
  isAnnotationStroke,
} from '@shared/sticky-notes';
import type {
  AnnotationMarkStyle,
  AnnotationShape,
  StickyNote,
  StickyNoteRect,
} from '@shared/types';

export type AnnotationMarkFamily = 'highlight' | 'underline' | 'strikeout';

export type AnnotationFilter = 'all' | 'note' | 'mark' | 'drawing';

export const MARK_STYLE_LABELS: Record<AnnotationMarkStyle, string> = {
  highlight: '高亮',
  underline: '下划线',
  'double-underline': '双下划线',
  'dotted-underline': '虚线下划线',
  'wavy-underline': '波浪下划线',
  strikeout: '删除线',
  none: '无标记',
};

const SHAPE_LABELS: Record<AnnotationShape, string> = {
  line: '直线',
  rect: '矩形',
  ellipse: '椭圆',
  arrow: '箭头',
};

const RECT_EPSILON = 1e-6;

/** Which mutually-exclusive family a mark style belongs to. */
export function markFamily(
  style: AnnotationMarkStyle,
): AnnotationMarkFamily | null {
  if (style === 'highlight') {
    return 'highlight';
  }
  if (style === 'strikeout') {
    return 'strikeout';
  }
  if (style === 'none') {
    return null;
  }
  return 'underline';
}

function sameRect(a: StickyNoteRect, b: StickyNoteRect): boolean {
  return (
    Math.abs(a.x - b.x) <= RECT_EPSILON &&
    Math.abs(a.y - b.y) <= RECT_EPSILON &&
    Math.abs(a.x + a.width - (b.x + b.width)) <= RECT_EPSILON &&
    Math.abs(a.y + a.height - (b.y + b.height)) <= RECT_EPSILON
  );
}

/** Same rect count, same order, all four edges within 1e-6. */
export function sameRects(
  a: readonly StickyNoteRect[],
  b: readonly StickyNoteRect[],
): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return a.every((rect, index) => sameRect(rect, b[index]));
}

function newerFirst(a: StickyNote, b: StickyNote): number {
  return b.createdAt - a.createdAt || b.id - a.id;
}

/** Newest pure text mark on `pageNo` with the same rects and mark family. */
export function findMarkForSelection(
  notes: readonly StickyNote[],
  pageNo: number,
  rects: readonly StickyNoteRect[],
  family: AnnotationMarkFamily,
): StickyNote | null {
  const candidates = notes
    .filter(
      (note) =>
        note.kind === 'mark' &&
        note.anchor.kind === 'text' &&
        note.pageNo === pageNo &&
        markFamily(note.markStyle) === family &&
        sameRects(note.anchor.rects, rects),
    )
    .sort(newerFirst);
  return candidates[0] ?? null;
}

/** Annotation-panel filtering by kind. */
export function filterAnnotations(
  notes: readonly StickyNote[],
  filter: AnnotationFilter,
): StickyNote[] {
  return notes.filter((note) => {
    if (filter === 'all') {
      return true;
    }
    if (filter === 'note') {
      return note.kind === 'note';
    }
    if (filter === 'mark') {
      return note.kind === 'mark';
    }
    return note.kind === 'ink' || note.kind === 'shape';
  });
}

/** Human-readable type / style label for a panel row. */
export function annotationTypeLabel(note: StickyNote): string {
  if (note.kind === 'ink' || note.kind === 'shape') {
    const drawing = note.drawing;
    if (drawing === null) {
      return '绘制数据损坏';
    }
    if (note.kind === 'ink') {
      return isAnnotationStroke(drawing)
        ? drawing.tool === 'pen'
          ? '自由笔'
          : '荧光笔'
        : '绘制数据损坏';
    }
    return isAnnotationShapeData(drawing)
      ? SHAPE_LABELS[drawing.shape]
      : '绘制数据损坏';
  }
  if (note.kind === 'mark') {
    return MARK_STYLE_LABELS[note.markStyle];
  }
  return '便签';
}
