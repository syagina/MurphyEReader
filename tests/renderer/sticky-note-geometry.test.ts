import { describe, expect, it } from 'vitest';
import type { StickyNote } from '@shared/types';
import {
  PAGE_NOTE_ICON_GAP,
  PAGE_NOTE_ICON_MARGIN,
  PAGE_NOTE_ICON_SIZE,
  anchorPopupPosition,
  clampPinPosition,
  freePopupPosition,
  hitTestTextNote,
  normalizeSelectionRects,
  normalizedPopupPosition,
  noteAnchorPoint,
  pageNoteIconOffset,
  pageNoteIconRect,
  pinForForm,
  pinPositionFromDrag,
  pinRectForNote,
  popupForMode,
  rectsToCss,
  rightPopupPosition,
  textNotePopupAnchor,
} from '@renderer/lib/sticky-note-geometry';

const page = { left: 100, top: 50, width: 200, height: 100 };

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
    anchor: {
      kind: 'text',
      rects: [{ x: 0.1, y: 0.2, width: 0.3, height: 0.1 }],
    },
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

describe('normalizeSelectionRects', () => {
  it('裁剪页面外部分并归一化为 0..1', () => {
    expect(
      normalizeSelectionRects(page, [
        { left: 100, top: 50, width: 20, height: 10 },
        { left: 90, top: 40, width: 20, height: 15 },
      ]),
    ).toEqual([
      { x: 0, y: 0, width: 0.1, height: 0.1 },
      { x: 0, y: 0, width: 0.05, height: 0.05 },
    ]);
  });

  it('过滤零宽、零高与完全在页面外的矩形', () => {
    expect(
      normalizeSelectionRects(page, [
        { left: 120, top: 60, width: 0, height: 10 },
        { left: 120, top: 60, width: 10, height: 0 },
        { left: 400, top: 300, width: 20, height: 20 },
        { left: 0, top: 0, width: -10, height: -10 },
        { left: 120, top: 60, width: 20, height: 10 },
      ]),
    ).toEqual([{ x: 0.1, y: 0.1, width: 0.1, height: 0.1 }]);
  });

  it('同一选区随页面等比缩放时归一化结果不变', () => {
    const small = { left: 10, top: 20, width: 200, height: 100 };
    const large = { left: 10, top: 20, width: 400, height: 200 };

    expect(
      normalizeSelectionRects(small, [
        { left: 50, top: 40, width: 100, height: 50 },
      ]),
    ).toEqual(
      normalizeSelectionRects(large, [
        { left: 90, top: 60, width: 200, height: 100 },
      ]),
    );
  });

  it('保留 4 位小数并钳制到页面边界', () => {
    const narrow = { left: 0, top: 0, width: 300, height: 300 };
    expect(
      normalizeSelectionRects(narrow, [
        { left: 10, top: 20, width: 100, height: 100 },
        { left: 299.9, top: 299.9, width: 10, height: 10 },
      ]),
    ).toEqual([
      { x: 0.0333, y: 0.0667, width: 0.3333, height: 0.3333 },
      { x: 0.9997, y: 0.9997, width: 0.0003, height: 0.0003 },
    ]);
  });

  it('四边相差不超过 0.5px 的重复矩形去重，相邻行不合并', () => {
    expect(
      normalizeSelectionRects(page, [
        { left: 110, top: 60, width: 20, height: 10 },
        { left: 110.4, top: 60.3, width: 19.7, height: 9.6 },
        { left: 110, top: 70.1, width: 20, height: 10 },
      ]),
    ).toEqual([
      { x: 0.05, y: 0.1, width: 0.1, height: 0.1 },
      { x: 0.05, y: 0.201, width: 0.1, height: 0.1 },
    ]);
  });

  it('最多保留 500 个矩形', () => {
    const wide = { left: 0, top: 0, width: 10_000, height: 100 };
    const rects = Array.from({ length: 600 }, (_, index) => ({
      left: index * 15,
      top: 0,
      width: 10,
      height: 10,
    }));

    expect(normalizeSelectionRects(wide, rects)).toHaveLength(500);
  });

  it('页面宽高非正时返回空数组', () => {
    expect(
      normalizeSelectionRects({ left: 0, top: 0, width: 0, height: 100 }, [
        { left: 0, top: 0, width: 10, height: 10 },
      ]),
    ).toEqual([]);
  });
});

describe('rectsToCss', () => {
  it('把归一化矩形转换为百分比样式', () => {
    expect(
      rectsToCss([{ x: 0.1, y: 0.2, width: 0.3, height: 0.04 }]),
    ).toEqual([
      { left: '10.0000%', top: '20.0000%', width: '30.0000%', height: '4.0000%' },
    ]);
  });
});

describe('hitTestTextNote', () => {
  it('返回包含点击位置的最新便签', () => {
    const older = makeNote(1, { createdAt: 1000 });
    const newer = makeNote(2, { createdAt: 2000 });
    const text = { x: 0.2, y: 0.25 };

    expect(hitTestTextNote([newer, older], text)?.id).toBe(2);
    expect(hitTestTextNote([older], text)?.id).toBe(1);
  });

  it('点击空白、整页锚点或矩形外时返回 null', () => {
    const pageNote = makeNote(1, { anchor: { kind: 'page' } });
    const textNote = makeNote(2);

    expect(hitTestTextNote([pageNote, textNote], { x: 0.5, y: 0.5 })).toBeNull();
    expect(hitTestTextNote([textNote], { x: 0.05, y: 0.05 })).toBeNull();
  });

  it('边界上的点算命中', () => {
    const note = makeNote(1, {
      anchor: { kind: 'text', rects: [{ x: 0.1, y: 0.1, width: 0.2, height: 0.2 }] },
    });
    expect(hitTestTextNote([note], { x: 0.1, y: 0.3 })?.id).toBe(1);
  });
});

describe('整页便签图标', () => {
  it('图标尺寸固定且按创建顺序向下排列', () => {
    expect(PAGE_NOTE_ICON_SIZE).toBe(18);
    expect(pageNoteIconOffset(0)).toBe(PAGE_NOTE_ICON_MARGIN);
    expect(pageNoteIconOffset(1)).toBe(
      PAGE_NOTE_ICON_MARGIN + PAGE_NOTE_ICON_SIZE + PAGE_NOTE_ICON_GAP,
    );
    expect(pageNoteIconRect(600, 0)).toEqual({
      left: 600 - PAGE_NOTE_ICON_MARGIN - PAGE_NOTE_ICON_SIZE,
      top: PAGE_NOTE_ICON_MARGIN,
      width: PAGE_NOTE_ICON_SIZE,
      height: PAGE_NOTE_ICON_SIZE,
    });
  });
});

describe('noteAnchorPoint', () => {
  it('文字便签取第一个矩形顶部中心', () => {
    const note = makeNote(1, {
      anchor: { kind: 'text', rects: [{ x: 0.1, y: 0.2, width: 0.3, height: 0.1 }] },
    });
    expect(noteAnchorPoint(note, { width: 600, height: 800 })).toEqual({
      x: 150,
      y: 160,
    });
  });

  it('整页便签取图标中心', () => {
    const note = makeNote(1, { anchor: { kind: 'page' } });
    expect(noteAnchorPoint(note, { width: 600, height: 800 }, 1)).toEqual({
      x: 600 - PAGE_NOTE_ICON_MARGIN - PAGE_NOTE_ICON_SIZE / 2,
      y: pageNoteIconOffset(1) + PAGE_NOTE_ICON_SIZE / 2,
    });
  });

  it('文字锚点没有矩形时返回 null', () => {
    const note = makeNote(1, { anchor: { kind: 'text', rects: [] } });
    expect(noteAnchorPoint(note, { width: 600, height: 800 })).toBeNull();
  });

  it('可见 pin 越界时先夹紧图标框再取中心', () => {
    expect(
      noteAnchorPoint(
        makeNote(1, { pin: { x: 1, y: 1, visible: true } }),
        { width: 600, height: 800 },
      ),
    ).toEqual({ x: 591, y: 791 });
    expect(
      noteAnchorPoint(
        makeNote(2, { pin: { x: -1, y: -1, visible: true } }),
        { width: 600, height: 800 },
      ),
    ).toEqual({ x: 9, y: 9 });
  });

  it('可见 pin 的中心与 pinRectForNote 的图标框一致', () => {
    const note = makeNote(1, { pin: { x: 1.4, y: -0.2, visible: true } });
    const size = { width: 600, height: 800 };
    const icon = pinRectForNote(note, size);
    expect(icon).not.toBeNull();
    expect(noteAnchorPoint(note, size)).toEqual({
      x: (icon?.left ?? 0) + PAGE_NOTE_ICON_SIZE / 2,
      y: (icon?.top ?? 0) + PAGE_NOTE_ICON_SIZE / 2,
    });
  });
});

describe('textNotePopupAnchor', () => {
  const size = { width: 600, height: 800 };

  it('有正文标记的便签即使有可见 pin 仍取第一个文字矩形', () => {
    const note = makeNote(1, { pin: { x: 0.5, y: 0.25, visible: true } });
    const anchor = textNotePopupAnchor(note, size);
    expect(anchor?.x).toBe(150);
    // Right mode keeps Task 12's vertical centre of the first rect.
    expect(anchor?.rightY).toBe(200);
    expect(anchor?.bottom).toBeCloseTo(240, 10);
  });

  it('无正文标记时按可见 pin 中心定位，底边下移半个图标', () => {
    const note = makeNote(1, {
      markStyle: 'none',
      color: null,
      pin: { x: 0.5, y: 0.25, visible: true },
    });
    expect(textNotePopupAnchor(note, size)).toEqual({
      x: 309,
      rightY: 209,
      bottom: 218,
    });
  });

  it('无正文标记但 pin 隐藏或为空时回退到第一个文字矩形', () => {
    const hidden = makeNote(1, {
      markStyle: 'none',
      color: null,
      pin: { x: 0.8, y: 0.8, visible: false },
    });
    const hiddenAnchor = textNotePopupAnchor(hidden, size);
    expect(hiddenAnchor?.x).toBe(150);
    expect(hiddenAnchor?.rightY).toBe(200);
    expect(hiddenAnchor?.bottom).toBeCloseTo(240, 10);
    const absent = makeNote(2, { markStyle: 'none', color: null, pin: null });
    const absentAnchor = textNotePopupAnchor(absent, size);
    expect(absentAnchor?.x).toBe(150);
    expect(absentAnchor?.rightY).toBe(200);
    expect(absentAnchor?.bottom).toBeCloseTo(240, 10);
  });

  it('无文字矩形且无可见 pin 时返回 null', () => {
    expect(
      textNotePopupAnchor(
        makeNote(1, { anchor: { kind: 'text', rects: [] } }),
        size,
      ),
    ).toBeNull();
  });
});

describe('标注命中过滤', () => {
  it('便签命中忽略无标记便签、绘制与隐藏标记，便签标记优先于更新的纯标记', () => {
    const note = makeNote(1, { kind: 'note' });
    const pure = makeNote(2, { kind: 'mark', contentMd: '', createdAt: 9_000 });
    const noMark = makeNote(3, { kind: 'note', markStyle: 'none' });
    const ink = makeNote(4, { kind: 'ink', markStyle: 'none' });
    const shape = makeNote(5, { kind: 'shape', markStyle: 'none' });
    expect(hitTestTextNote([pure, noMark, ink, shape, note], { x: 0.2, y: 0.25 })?.id).toBe(1);
  });
});

describe('页边图标几何', () => {
  it('页边图标拖动在 50%/200% 缩放下归一化一致', () => {
    const small = { left: 0, top: 0, width: 200, height: 100 };
    const large = { left: 0, top: 0, width: 800, height: 400 };
    expect(pinPositionFromDrag(small, { x: 50, y: 30 }, { x: 0, y: 0 }))
      .toEqual({ x: 0.25, y: 0.3 });
    expect(pinPositionFromDrag(large, { x: 200, y: 120 }, { x: 0, y: 0 }))
      .toEqual({ x: 0.25, y: 0.3 });
  });

  it('页边图标夹紧到页内', () => {
    expect(clampPinPosition({ x: 1, y: 1, visible: true }, { width: 600, height: 800 }))
      .toEqual({ x: 0.97, y: 0.9775, visible: true });
  });

  it('页边图标默认位置与表单开关', () => {
    const pageNote = makeNote(1, { anchor: { kind: 'page' }, pin: null });
    expect(pinRectForNote(pageNote, { width: 600, height: 800 }, 0)?.left).toBe(574);
    expect(pinRectForNote(pageNote, { width: 600, height: 800 }, 1)).toEqual({
      left: 600 - PAGE_NOTE_ICON_MARGIN - PAGE_NOTE_ICON_SIZE,
      top: PAGE_NOTE_ICON_MARGIN + PAGE_NOTE_ICON_SIZE + PAGE_NOTE_ICON_GAP,
      width: PAGE_NOTE_ICON_SIZE,
      height: PAGE_NOTE_ICON_SIZE,
    });
    expect(pinForForm(pageNote, pageNote.anchor, {
      visible: true, side: 'right', sideTouched: false,
    })).toBeNull();
    expect(pinForForm(pageNote, pageNote.anchor, {
      visible: false, side: 'right', sideTouched: false,
    })).toMatchObject({ visible: false });
  });

  it('可见 pin 越界时夹紧到页内', () => {
    expect(
      pinRectForNote(
        makeNote(1, { pin: { x: 1, y: 1, visible: true } }),
        { width: 600, height: 800 },
      ),
    ).toEqual({ left: 582, top: 782, width: 18, height: 18 });
  });

  it('文字便签默认无图标，可见 pin 优先于选区', () => {
    const textNote = makeNote(1);
    expect(pinRectForNote(textNote, { width: 600, height: 800 })).toBeNull();
    expect(pinForForm(textNote, textNote.anchor, {
      visible: true, side: 'left', sideTouched: false,
    })).toEqual({ x: 0, y: 0.2, visible: true });
    expect(
      pinRectForNote(
        makeNote(2, { pin: { x: 0.5, y: 0.25, visible: true } }),
        { width: 600, height: 800 },
      ),
    ).toEqual({
      left: 300,
      top: 200,
      width: PAGE_NOTE_ICON_SIZE,
      height: PAGE_NOTE_ICON_SIZE,
    });
    expect(
      pinRectForNote(
        makeNote(3, { pin: { x: 0.5, y: 0.25, visible: false } }),
        { width: 600, height: 800 },
      ),
    ).toBeNull();
  });

  it('已有 pin 时只改可见性或按显式左右改 x', () => {
    const note = makeNote(1, { pin: { x: 0.4, y: 0.6, visible: true } });
    expect(pinForForm(note, note.anchor, {
      visible: false, side: 'left', sideTouched: false,
    })).toEqual({ x: 0.4, y: 0.6, visible: false });
    expect(pinForForm(note, note.anchor, {
      visible: true, side: 'left', sideTouched: true,
    })).toEqual({ x: 0, y: 0.6, visible: true });
    expect(pinForForm(note, note.anchor, {
      visible: true, side: 'right', sideTouched: true,
    })).toEqual({ x: 1, y: 0.6, visible: true });
  });
});

describe('弹窗几何', () => {
  it('弹窗三种位置与自由位置夹紧', () => {
    expect(popupForMode(null, 'free')).toEqual({ mode: 'free', x: 0.5, y: 0.25 });
    const bounds = { left: 0, top: 0, width: 1000, height: 800 };
    expect(anchorPopupPosition({ x: 500, y: 160 }, bounds, { width: 380, height: 480 }))
      .toEqual({ left: 310, top: 168 });
    expect(rightPopupPosition(200, bounds, { width: 380, height: 480 }))
      .toEqual({ left: 612, top: 8 });
    expect(freePopupPosition({ x: 0.5, y: 0.25 }, bounds, { width: 380, height: 480 }))
      .toEqual({ left: 500, top: 200 });
    expect(normalizedPopupPosition(500, 200, bounds, { width: 380, height: 480 }))
      .toEqual({ x: 0.5, y: 0.25 });
  });

  it('自由弹窗位置越界时夹紧并保留已有 free 坐标', () => {
    const bounds = { left: 100, top: 50, width: 1000, height: 800 };
    const popup = { width: 380, height: 480 };
    expect(freePopupPosition({ x: 1, y: 1 }, bounds, popup)).toEqual({
      left: 712,
      top: 362,
    });
    expect(
      popupForMode(
        makeNote(1, { popup: { mode: 'free', x: 0.2, y: 0.3 } }),
        'free',
      ),
    ).toEqual({ mode: 'free', x: 0.2, y: 0.3 });
    expect(popupForMode(makeNote(2), 'right')).toEqual({ mode: 'right' });
  });

  it('锚点弹窗下方放不下时翻到上方', () => {
    const bounds = { left: 0, top: 0, width: 1000, height: 800 };
    const popup = { width: 380, height: 480 };
    expect(anchorPopupPosition({ x: 500, y: 700 }, bounds, popup)).toEqual({
      left: 310,
      top: 212,
    });
  });

  it('锚点弹窗上下都放不下时夹紧下方位置', () => {
    const bounds = { left: 0, top: 0, width: 1000, height: 500 };
    const popup = { width: 380, height: 480 };
    expect(anchorPopupPosition({ x: 500, y: 250 }, bounds, popup)).toEqual({
      left: 310,
      top: 12,
    });
  });

  it('锚点弹窗水平越界时夹紧', () => {
    const bounds = { left: 0, top: 0, width: 1000, height: 800 };
    const popup = { width: 380, height: 480 };
    expect(anchorPopupPosition({ x: 900, y: 100 }, bounds, popup)).toEqual({
      left: 612,
      top: 108,
    });
  });
});
