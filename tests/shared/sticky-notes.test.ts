import { describe, expect, it } from 'vitest';
import {
  ANNOTATION_DEFAULT_HIGHLIGHT_COLOR,
  ANNOTATION_DEFAULT_MARK_COLOR,
  STICKY_NOTE_SOURCE_LABELS,
  parseAnnotationColor,
  parseAnnotationDrawing,
  parseAnnotationKind,
  parseAnnotationMarkStyle,
  parseAnnotationPin,
  parseAnnotationPopup,
  pdfVersionLabel,
  validateStickyNoteCreateInput,
  validateStickyNoteUpdatePatch,
} from '@shared/sticky-notes';
import type { AnnotationDrawing, StickyNoteCreateInput } from '@shared/types';

function makeInput(
  overrides: Partial<StickyNoteCreateInput> = {},
): StickyNoteCreateInput {
  return {
    paperId: 1,
    pdfVersion: 'original',
    pageNo: 2,
    quote: '选中原文',
    contentMd: '便签内容',
    anchor: {
      kind: 'text',
      rects: [{ x: 0.1, y: 0.2, width: 0.3, height: 0.04 }],
    },
    source: 'manual',
    ...overrides,
  };
}

function makeRect(index: number) {
  return { x: index / 1000, y: 0.1, width: 0.01, height: 0.01 };
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

describe('pdfVersionLabel', () => {
  it('返回三种版本的中文标签', () => {
    expect(pdfVersionLabel('original')).toBe('原文');
    expect(pdfVersionLabel('translated')).toBe('仅译文');
    expect(pdfVersionLabel('bilingual')).toBe('中英对照');
  });
});

describe('STICKY_NOTE_SOURCE_LABELS', () => {
  it('返回三种来源的中文标签', () => {
    expect(STICKY_NOTE_SOURCE_LABELS).toEqual({
      manual: '手动',
      translation: '翻译',
      ai: 'AI',
    });
  });
});

describe('validateStickyNoteCreateInput', () => {
  it('接受完整的文字锚点输入并补齐默认字段', () => {
    const input = makeInput();
    expect(validateStickyNoteCreateInput(input)).toEqual({
      ...input,
      kind: 'note',
      markStyle: 'highlight',
      color: null,
      pin: null,
      popup: null,
      drawing: null,
    });
  });

  it('接受带内容的整页锚点', () => {
    const input = makeInput({
      quote: '',
      contentMd: '页边内容',
      anchor: { kind: 'page' },
      source: 'ai',
    });
    expect(validateStickyNoteCreateInput(input)).toEqual({
      ...input,
      kind: 'note',
      markStyle: 'none',
      color: null,
      pin: null,
      popup: null,
      drawing: null,
    });
  });

  it('旧 payload 补齐默认字段', () => {
    expect(validateStickyNoteCreateInput(makeInput())).toMatchObject({
      kind: 'note', markStyle: 'highlight', color: null,
      pin: null, popup: null, drawing: null,
    });
  });

  it('无内容但有标记归一化为纯标记', () => {
    expect(
      validateStickyNoteCreateInput(makeInput({ contentMd: '', markStyle: 'underline' })),
    ).toMatchObject({ kind: 'mark', markStyle: 'underline' });
  });

  it('无内容且无标记拒绝', () => {
    expect(() =>
      validateStickyNoteCreateInput(makeInput({ contentMd: '', markStyle: 'none' })),
    ).toThrow(/内容|标记/);
  });

  it('整页便签强制不做正文标记', () => {
    expect(
      validateStickyNoteCreateInput(makeInput({
        anchor: { kind: 'page' }, contentMd: '页边内容', markStyle: 'highlight',
      })),
    ).toMatchObject({ kind: 'note', markStyle: 'none', color: null });
  });

  it('合法绘制输入归一化为 ink', () => {
    expect(
      validateStickyNoteCreateInput(makeInput({
        kind: 'ink',
        quote: '',
        contentMd: '',
        anchor: { kind: 'page' },
        markStyle: 'none',
        drawing: strokeDrawing,
      })),
    ).toMatchObject({
      kind: 'ink', markStyle: 'none', color: null, drawing: strokeDrawing,
    });
  });

  it('未给 kind 时按 drawing 推断绘制类型', () => {
    expect(
      validateStickyNoteCreateInput(makeInput({
        quote: '',
        contentMd: '',
        anchor: { kind: 'page' },
        markStyle: 'none',
        drawing: strokeDrawing,
      })),
    ).toMatchObject({ kind: 'ink' });
  });

  it('ink 缺少 drawing 时拒绝', () => {
    expect(() =>
      validateStickyNoteCreateInput(makeInput({
        kind: 'ink',
        quote: '',
        contentMd: '',
        anchor: { kind: 'page' },
        markStyle: 'none',
      })),
    ).toThrow(/绘制/);
  });

  it('note 或 mark 带 drawing 时拒绝', () => {
    expect(() =>
      validateStickyNoteCreateInput(makeInput({ drawing: strokeDrawing })),
    ).toThrow(/绘制/);
  });

  it('ink 带内容时拒绝', () => {
    expect(() =>
      validateStickyNoteCreateInput(makeInput({
        kind: 'ink',
        quote: '',
        anchor: { kind: 'page' },
        markStyle: 'none',
        drawing: strokeDrawing,
      })),
    ).toThrow(/内容/);
  });

  it('校验标注样式、颜色、图标与弹窗', () => {
    expect(() =>
      validateStickyNoteCreateInput(makeInput({ markStyle: 'other' as never })),
    ).toThrow(/样式/);
    expect(
      validateStickyNoteCreateInput(makeInput({ color: '#FACC15' })).color,
    ).toBe('#facc15');
    expect(() =>
      validateStickyNoteCreateInput(makeInput({ color: 'yellow' })),
    ).toThrow(/颜色/);
    expect(() =>
      validateStickyNoteCreateInput(
        makeInput({ pin: { x: 1.2, y: 0.1, visible: true } }),
      ),
    ).toThrow(/图标/);
    expect(() =>
      validateStickyNoteCreateInput(
        makeInput({ popup: { mode: 'free', x: -0.1, y: 0.1 } as never }),
      ),
    ).toThrow(/弹窗/);
  });

  it('拒绝非法绘制数据', () => {
    const makeInk = (drawing: unknown) =>
      makeInput({
        kind: 'ink',
        quote: '',
        contentMd: '',
        anchor: { kind: 'page' },
        markStyle: 'none',
        drawing: drawing as AnnotationDrawing,
      });

    expect(() =>
      validateStickyNoteCreateInput(makeInk({ ...strokeDrawing, width: 0.4 })),
    ).toThrow(/绘制/);
    expect(() =>
      validateStickyNoteCreateInput(
        makeInk({ ...strokeDrawing, points: [[0.1, 0.1]] }),
      ),
    ).toThrow(/绘制/);
  });

  it('拒绝非法版本、页码、来源与 paperId', () => {
    expect(() =>
      validateStickyNoteCreateInput(makeInput({ pdfVersion: 'other' as never })),
    ).toThrow(/版本/);
    expect(() =>
      validateStickyNoteCreateInput(makeInput({ pageNo: 0 })),
    ).toThrow(/页码/);
    expect(() =>
      validateStickyNoteCreateInput(makeInput({ pageNo: 1.5 })),
    ).toThrow(/页码/);
    expect(() =>
      validateStickyNoteCreateInput(makeInput({ source: 'other' as never })),
    ).toThrow(/来源/);
    expect(() =>
      validateStickyNoteCreateInput(makeInput({ paperId: 0 })),
    ).toThrow(/文献/);
  });

  it('拒绝超长引用与内容', () => {
    expect(() =>
      validateStickyNoteCreateInput(makeInput({ quote: 'a'.repeat(50_001) })),
    ).toThrow(/引用/);
    expect(() =>
      validateStickyNoteCreateInput(makeInput({ contentMd: 'a'.repeat(200_001) })),
    ).toThrow(/内容/);
  });

  it('拒绝空矩形列表、超过 500 个矩形与非法矩形', () => {
    expect(() =>
      validateStickyNoteCreateInput(
        makeInput({ anchor: { kind: 'text', rects: [] } }),
      ),
    ).toThrow(/矩形/);
    expect(() =>
      validateStickyNoteCreateInput(
        makeInput({
          anchor: {
            kind: 'text',
            rects: Array.from({ length: 501 }, (_, index) => makeRect(index)),
          },
        }),
      ),
    ).toThrow(/矩形/);

    for (const rect of [
      { x: -0.1, y: 0.1, width: 0.1, height: 0.1 },
      { x: 0.1, y: 0.1, width: 0, height: 0.1 },
      { x: 0.1, y: 0.1, width: 0.1, height: 0 },
      { x: 0.9, y: 0.1, width: 0.2, height: 0.1 },
      { x: 0.1, y: 0.9, width: 0.1, height: 0.2 },
      { x: Number.NaN, y: 0.1, width: 0.1, height: 0.1 },
    ]) {
      expect(() =>
        validateStickyNoteCreateInput(
          makeInput({ anchor: { kind: 'text', rects: [rect] } }),
        ),
      ).toThrow(/矩形/);
    }
  });

  it('拒绝未知锚点类型与非对象输入', () => {
    expect(() =>
      validateStickyNoteCreateInput(makeInput({ anchor: { kind: 'other' } as never })),
    ).toThrow(/锚点/);
    expect(() => validateStickyNoteCreateInput(null)).toThrow(/输入/);
    expect(() => validateStickyNoteCreateInput('x')).toThrow(/输入/);
  });
});

describe('validateStickyNoteUpdatePatch', () => {
  it('接受内容并只返回 contentMd', () => {
    expect(validateStickyNoteUpdatePatch({ contentMd: '新内容' })).toEqual({
      contentMd: '新内容',
    });
  });

  it('接受部分标注字段与显式 null', () => {
    expect(
      validateStickyNoteUpdatePatch({
        markStyle: 'underline',
        color: '#EF4444',
        pin: null,
        popup: { mode: 'right' },
      }),
    ).toEqual({
      markStyle: 'underline',
      color: '#ef4444',
      pin: null,
      popup: { mode: 'right' },
    });
  });

  it('拒绝未知字段与空 patch', () => {
    expect(() =>
      validateStickyNoteUpdatePatch({ contentMd: '新内容', quote: '忽略' }),
    ).toThrow(/字段/);
    expect(() => validateStickyNoteUpdatePatch({})).toThrow(/字段/);
  });

  it('拒绝非对象、非文本内容与超长内容', () => {
    expect(() => validateStickyNoteUpdatePatch(null)).toThrow(/输入/);
    expect(() => validateStickyNoteUpdatePatch({ contentMd: 1 })).toThrow(/内容/);
    expect(() =>
      validateStickyNoteUpdatePatch({ contentMd: 'a'.repeat(200_001) }),
    ).toThrow(/内容/);
  });
});

describe('标注解析', () => {
  it('解析损坏 JSON 时降级', () => {
    expect(parseAnnotationPin('{bad')).toBeNull();
    expect(parseAnnotationPopup('{bad')).toBeNull();
    expect(parseAnnotationDrawing('{bad')).toBeNull();
    expect(parseAnnotationMarkStyle('other')).toBe('highlight');
  });

  it('解析合法 pin、popup 与 drawing', () => {
    expect(
      parseAnnotationPin(JSON.stringify({ x: 0.25, y: 0.5, visible: true })),
    ).toEqual({ x: 0.25, y: 0.5, visible: true });
    expect(parseAnnotationPopup(JSON.stringify({ mode: 'free', x: 0.3, y: 0.4 })))
      .toEqual({ mode: 'free', x: 0.3, y: 0.4 });
    expect(parseAnnotationDrawing(JSON.stringify(strokeDrawing))).toEqual(
      strokeDrawing,
    );
    expect(parseAnnotationPin(null)).toBeNull();
    expect(parseAnnotationPopup(null)).toBeNull();
    expect(parseAnnotationDrawing(null)).toBeNull();
  });

  it('颜色统一小写，非法颜色为 null', () => {
    expect(parseAnnotationColor('#FACC15')).toBe('#facc15');
    expect(parseAnnotationColor('yellow')).toBeNull();
    expect(parseAnnotationColor(null)).toBeNull();
  });

  it('kind 合法时信任，否则按内容、样式与绘制推导', () => {
    expect(parseAnnotationKind('note', '', 'none', null)).toBe('note');
    expect(parseAnnotationKind('note', '内容', 'none', null)).toBe('note');
    expect(parseAnnotationKind('other', '内容', 'none', null)).toBe('note');
    expect(parseAnnotationKind('other', '', 'underline', null)).toBe('mark');
    expect(parseAnnotationKind('other', '', 'none', strokeDrawing)).toBe('ink');
    expect(
      parseAnnotationKind('other', '', 'none', {
        shape: 'rect',
        color: '#111827',
        width: 2,
        opacity: 1,
        start: [0.1, 0.1],
        end: [0.2, 0.2],
      }),
    ).toBe('shape');
    expect(parseAnnotationKind('other', '', 'none', null)).toBe('note');
  });
});

describe('标注默认颜色', () => {
  it('使用设计规定的默认色', () => {
    expect(ANNOTATION_DEFAULT_HIGHLIGHT_COLOR).toBe('#facc15');
    expect(ANNOTATION_DEFAULT_MARK_COLOR).toBe('#ef4444');
  });
});
