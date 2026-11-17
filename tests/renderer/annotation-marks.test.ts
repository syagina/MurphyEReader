import { describe, expect, it } from 'vitest';
import type {
  AnnotationDrawing,
  AnnotationShape,
  StickyNote,
} from '@shared/types';
import {
  ANNOTATION_DEFAULT_HIGHLIGHT_COLOR,
  ANNOTATION_DEFAULT_MARK_COLOR,
} from '@shared/sticky-notes';
import {
  DEFAULT_DRAWING_COLOR,
  DRAWING_COLORS,
  HIGHLIGHT_COLORS,
  MARK_COLORS,
  colorForNote,
  defaultMarkColor,
} from '@renderer/lib/annotation-colors';
import {
  annotationTypeLabel,
  filterAnnotations,
  findMarkForSelection,
  markFamily,
  sameRects,
} from '@renderer/lib/annotation-marks';

const rects = [{ x: 0.1, y: 0.2, width: 0.3, height: 0.1 }];

function makeNote(
  id: number,
  overrides: Partial<StickyNote> = {},
): StickyNote {
  return {
    id,
    paperId: 1,
    pdfVersion: 'original',
    pageNo: 1,
    quote: `引用 ${id}`,
    contentMd: `内容 ${id}`,
    anchor: { kind: 'text', rects },
    source: 'manual',
    kind: 'note',
    markStyle: 'highlight',
    color: null,
    pin: null,
    popup: null,
    drawing: null,
    createdAt: 1_000 + id,
    updatedAt: 1_000 + id,
    ...overrides,
  };
}

const strokeDrawing: AnnotationDrawing = {
  tool: 'pen',
  color: '#111827',
  width: 2,
  opacity: 1,
  points: [
    [0.1, 0.1],
    [0.2, 0.2],
  ],
};

const highlighterDrawing: AnnotationDrawing = {
  tool: 'highlighter',
  color: '#facc15',
  width: 12,
  opacity: 0.35,
  points: [
    [0.1, 0.1],
    [0.2, 0.2],
  ],
};

function shapeDrawingOf(shape: AnnotationShape): AnnotationDrawing {
  return {
    shape,
    color: '#ef4444',
    width: 2,
    opacity: 1,
    start: [0.1, 0.1],
    end: [0.2, 0.2],
  };
}

const shapeDrawing = shapeDrawingOf('rect');

describe('findMarkForSelection', () => {
  it('同选区同类标记只匹配纯标记，并取最新', () => {
    const older = makeNote(1, { kind: 'mark', contentMd: '', markStyle: 'underline', createdAt: 100 });
    const newer = makeNote(2, { kind: 'mark', contentMd: '', markStyle: 'double-underline', createdAt: 200 });
    expect(findMarkForSelection([older, newer], 1, rects, 'underline')?.id).toBe(2);
  });

  it('不同族或已有内容的便签不参与纯标记匹配', () => {
    const note = makeNote(1, { kind: 'note' });
    const strike = makeNote(2, { kind: 'mark', contentMd: '', markStyle: 'strikeout' });
    expect(findMarkForSelection([note, strike], 1, rects, 'underline')).toBeNull();
  });

  it('只匹配同页、文字锚点、相同顺序矩形', () => {
    const otherPage = makeNote(1, {
      kind: 'mark',
      contentMd: '',
      markStyle: 'underline',
      pageNo: 2,
    });
    const pageAnchor = makeNote(2, {
      kind: 'mark',
      contentMd: '',
      markStyle: 'underline',
      anchor: { kind: 'page' },
    });
    const shifted = makeNote(3, {
      kind: 'mark',
      contentMd: '',
      markStyle: 'underline',
      anchor: { kind: 'text', rects: [{ x: 0.11, y: 0.2, width: 0.3, height: 0.1 }] },
    });
    const match = makeNote(4, {
      kind: 'mark',
      contentMd: '',
      markStyle: 'wavy-underline',
    });

    expect(
      findMarkForSelection(
        [otherPage, pageAnchor, shifted, match],
        1,
        rects,
        'underline',
      )?.id,
    ).toBe(4);
  });

  it('createdAt 相同时取 id 更大的', () => {
    const older = makeNote(1, {
      kind: 'mark',
      contentMd: '',
      markStyle: 'underline',
      createdAt: 500,
    });
    const newer = makeNote(2, {
      kind: 'mark',
      contentMd: '',
      markStyle: 'underline',
      createdAt: 500,
    });
    expect(findMarkForSelection([older, newer], 1, rects, 'underline')?.id).toBe(2);
  });
});

describe('markFamily', () => {
  it('把六种标记归入三族', () => {
    expect(markFamily('highlight')).toBe('highlight');
    expect(markFamily('underline')).toBe('underline');
    expect(markFamily('double-underline')).toBe('underline');
    expect(markFamily('dotted-underline')).toBe('underline');
    expect(markFamily('wavy-underline')).toBe('underline');
    expect(markFamily('strikeout')).toBe('strikeout');
    expect(markFamily('none')).toBeNull();
  });
});

describe('sameRects', () => {
  it('长度、顺序与四边都需在 1e-6 内相等', () => {
    expect(sameRects(rects, [{ x: 0.1, y: 0.2, width: 0.3, height: 0.1 }])).toBe(true);
    expect(
      sameRects(rects, [{ x: 0.1000005, y: 0.2, width: 0.3, height: 0.1 }]),
    ).toBe(true);
    expect(
      sameRects(rects, [{ x: 0.100002, y: 0.2, width: 0.3, height: 0.1 }]),
    ).toBe(false);
    expect(sameRects(rects, [])).toBe(false);
    expect(
      sameRects(rects, [
        { x: 0.1, y: 0.2, width: 0.3, height: 0.1 },
        { x: 0.1, y: 0.2, width: 0.3, height: 0.1 },
      ]),
    ).toBe(false);
  });
});

describe('filterAnnotations', () => {
  it('面板筛选', () => {
    const notes = [
      makeNote(1, { kind: 'note' }),
      makeNote(2, { kind: 'mark', contentMd: '' }),
      makeNote(3, { kind: 'ink', contentMd: '' }),
      makeNote(4, { kind: 'shape', contentMd: '' }),
    ];
    expect(filterAnnotations(notes, 'note')).toHaveLength(1);
    expect(filterAnnotations(notes, 'mark')).toHaveLength(1);
    expect(filterAnnotations(notes, 'drawing')).toHaveLength(2);
    expect(filterAnnotations(notes, 'all')).toHaveLength(4);
  });

  it('drawing 筛选只含 ink 与 shape', () => {
    const notes = [
      makeNote(1, { kind: 'note' }),
      makeNote(2, { kind: 'ink', contentMd: '', drawing: strokeDrawing }),
      makeNote(3, { kind: 'shape', contentMd: '', drawing: shapeDrawing }),
    ];
    expect(filterAnnotations(notes, 'drawing').map((note) => note.id)).toEqual([2, 3]);
  });
});

describe('annotationTypeLabel', () => {
  it('便签与各类标记', () => {
    expect(annotationTypeLabel(makeNote(1, { kind: 'note' }))).toBe('便签');
    expect(annotationTypeLabel(makeNote(2, { kind: 'mark', contentMd: '' }))).toBe('高亮');
    expect(
      annotationTypeLabel(
        makeNote(3, { kind: 'mark', contentMd: '', markStyle: 'underline' }),
      ),
    ).toBe('下划线');
    expect(
      annotationTypeLabel(
        makeNote(4, { kind: 'mark', contentMd: '', markStyle: 'strikeout' }),
      ),
    ).toBe('删除线');
  });

  it('绘制类型按工具与形状细分', () => {
    expect(
      annotationTypeLabel(
        makeNote(1, { kind: 'ink', contentMd: '', drawing: strokeDrawing }),
      ),
    ).toBe('自由笔');
    expect(
      annotationTypeLabel(
        makeNote(2, {
          kind: 'ink',
          contentMd: '',
          drawing: highlighterDrawing,
        }),
      ),
    ).toBe('荧光笔');
    const shapeLabels: Array<[AnnotationShape, string]> = [
      ['line', '直线'],
      ['rect', '矩形'],
      ['ellipse', '椭圆'],
      ['arrow', '箭头'],
    ];
    for (const [shape, label] of shapeLabels) {
      expect(
        annotationTypeLabel(
          makeNote(3, {
            kind: 'shape',
            contentMd: '',
            drawing: shapeDrawingOf(shape),
          }),
        ),
      ).toBe(label);
    }
  });

  it('绘制数据损坏时回退为损坏提示', () => {
    expect(
      annotationTypeLabel(makeNote(1, { kind: 'ink', contentMd: '', drawing: null })),
    ).toBe('绘制数据损坏');
    expect(
      annotationTypeLabel(makeNote(2, { kind: 'shape', contentMd: '', drawing: null })),
    ).toBe('绘制数据损坏');
  });
});

describe('annotation-colors', () => {
  it('固定高亮色板使用设计给定顺序', () => {
    expect(HIGHLIGHT_COLORS).toEqual([
      '#facc15',
      '#4ade80',
      '#60a5fa',
      '#f472b6',
      '#c084fc',
    ]);
    expect(MARK_COLORS).toContain(ANNOTATION_DEFAULT_MARK_COLOR);
    expect(DRAWING_COLORS).toContain(DEFAULT_DRAWING_COLOR);
  });

  it('默认色按标记样式选择', () => {
    expect(defaultMarkColor('highlight')).toBe(ANNOTATION_DEFAULT_HIGHLIGHT_COLOR);
    expect(defaultMarkColor('underline')).toBe(ANNOTATION_DEFAULT_MARK_COLOR);
    expect(defaultMarkColor('strikeout')).toBe(ANNOTATION_DEFAULT_MARK_COLOR);
    expect(defaultMarkColor('none')).toBe(ANNOTATION_DEFAULT_MARK_COLOR);
  });

  it('colorForNote 优先便签自带颜色', () => {
    expect(colorForNote(makeNote(1))).toBe(ANNOTATION_DEFAULT_HIGHLIGHT_COLOR);
    expect(colorForNote(makeNote(2, { color: '#123456' }))).toBe('#123456');
    expect(colorForNote(makeNote(3, { markStyle: 'strikeout' }))).toBe(
      ANNOTATION_DEFAULT_MARK_COLOR,
    );
  });
});
