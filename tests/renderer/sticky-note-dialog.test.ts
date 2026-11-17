import { describe, expect, it } from 'vitest';
import type { StickyNote, StickyNoteAnchor } from '@shared/types';
import {
  buildStickyNoteFormValue,
} from '@renderer/components/StickyNoteDialog';
import type { StickyNoteFormState } from '@renderer/components/StickyNoteDialog';

const textAnchor: StickyNoteAnchor = {
  kind: 'text',
  rects: [{ x: 0.1, y: 0.2, width: 0.3, height: 0.1 }],
};

function makeNote(overrides: Partial<StickyNote> = {}): StickyNote {
  return {
    id: 1,
    paperId: 1,
    pdfVersion: 'original',
    pageNo: 1,
    quote: '引用',
    contentMd: '内容',
    anchor: textAnchor,
    source: 'manual',
    kind: 'note',
    markStyle: 'highlight',
    color: null,
    pin: null,
    popup: null,
    drawing: null,
    createdAt: 1_000,
    updatedAt: 1_000,
    ...overrides,
  };
}

function formState(
  overrides: Partial<StickyNoteFormState> = {},
): StickyNoteFormState {
  return {
    contentMd: '内容',
    markStyle: 'highlight',
    color: '#facc15',
    pinVisible: false,
    pinSide: 'right',
    pinSideTouched: false,
    popupMode: 'anchor',
    ...overrides,
  };
}

describe('buildStickyNoteFormValue', () => {
  it('无内容但有标记时 pin/popup 为空', () => {
    expect(buildStickyNoteFormValue({
      contentMd: '', markStyle: 'underline', color: '#ef4444',
      pinVisible: true, pinSide: 'right', pinSideTouched: false, popupMode: 'right',
    }, null, textAnchor)).toMatchObject({
      markStyle: 'underline', pin: null, popup: null,
    });
  });

  it('有标记的文字便签默认不显示图标', () => {
    expect(buildStickyNoteFormValue({
      contentMd: '内容', markStyle: 'highlight', color: '#facc15',
      pinVisible: false, pinSide: 'right', pinSideTouched: false, popupMode: 'anchor',
    }, null, textAnchor).pin).toBeNull();
  });

  it('整页便签隐藏图标时写入 visible:false', () => {
    expect(buildStickyNoteFormValue({
      contentMd: '页边', markStyle: 'none', color: '#ef4444',
      pinVisible: false, pinSide: 'right', pinSideTouched: false, popupMode: 'anchor',
    }, null, { kind: 'page' }).pin).toMatchObject({ visible: false });
  });

  it('保留已有拖动位置，手动改边时贴边', () => {
    const note = makeNote({ pin: { x: 0.42, y: 0.35, visible: true } });
    expect(buildStickyNoteFormValue({
      contentMd: '内容', markStyle: 'highlight', color: '#facc15',
      pinVisible: true, pinSide: 'left', pinSideTouched: false, popupMode: 'anchor',
    }, note, note.anchor).pin).toEqual({ x: 0.42, y: 0.35, visible: true });
    expect(buildStickyNoteFormValue({
      contentMd: '内容', markStyle: 'highlight', color: '#facc15',
      pinVisible: true, pinSide: 'left', pinSideTouched: true, popupMode: 'anchor',
    }, note, note.anchor).pin).toEqual({ x: 0, y: 0.35, visible: true });
  });

  it('整页锚点忽略状态里的样式与颜色', () => {
    expect(
      buildStickyNoteFormValue(
        formState({ markStyle: 'underline', color: '#ef4444' }),
        null,
        { kind: 'page' },
      ),
    ).toMatchObject({ markStyle: 'none', color: null });
  });

  it('纯空白内容清空 pin/popup 并保留原始内容', () => {
    expect(
      buildStickyNoteFormValue(
        formState({ contentMd: '  \n\t ', pinVisible: true, popupMode: 'right' }),
        null,
        textAnchor,
      ),
    ).toMatchObject({ contentMd: '  \n\t ', pin: null, popup: null });
  });

  it('整页便签内容非空且默认可见右侧未改边时沿用堆叠图标', () => {
    const note = makeNote({
      anchor: { kind: 'page' },
      markStyle: 'none',
      contentMd: '页边',
      pin: null,
    });
    expect(
      buildStickyNoteFormValue(
        formState({
          contentMd: '页边',
          markStyle: 'none',
          color: null,
          pinVisible: true,
          pinSide: 'right',
          pinSideTouched: false,
        }),
        note,
        { kind: 'page' },
      ).pin,
    ).toBeNull();
  });

  it('无标记文字便签的可见图标贴在选区首行右侧', () => {
    expect(
      buildStickyNoteFormValue(
        formState({
          markStyle: 'none',
          color: null,
          pinVisible: true,
          pinSide: 'right',
          pinSideTouched: false,
        }),
        null,
        textAnchor,
      ).pin,
    ).toEqual({ x: 1, y: 0.2, visible: true });
  });

  it('已有自由弹窗位置在选择自由位置时保留', () => {
    const note = makeNote({ popup: { mode: 'free', x: 0.2, y: 0.3 } });
    expect(
      buildStickyNoteFormValue(
        formState({ popupMode: 'free' }),
        note,
        note.anchor,
      ).popup,
    ).toEqual({ mode: 'free', x: 0.2, y: 0.3 });
  });

  it('无正文标记时颜色始终为 null', () => {
    expect(
      buildStickyNoteFormValue(
        formState({ markStyle: 'none', color: '#ef4444' }),
        null,
        textAnchor,
      ).color,
    ).toBeNull();
  });

  it('页面点击放置的图标保留点击位置', () => {
    expect(
      buildStickyNoteFormValue(
        formState({
          contentMd: '页边',
          markStyle: 'none',
          color: null,
          pinVisible: true,
          pinSide: 'right',
          pinSideTouched: false,
        }),
        null,
        { kind: 'page' },
        { x: 0.32, y: 0.64, visible: true },
      ).pin,
    ).toEqual({ x: 0.32, y: 0.64, visible: true });
  });

  it('关闭显示后仍保留点击位置，只把 visible 置为 false', () => {
    expect(
      buildStickyNoteFormValue(
        formState({
          contentMd: '页边',
          markStyle: 'none',
          color: null,
          pinVisible: false,
          pinSide: 'right',
          pinSideTouched: false,
        }),
        null,
        { kind: 'page' },
        { x: 0.2, y: 0.7, visible: true },
      ).pin,
    ).toEqual({ x: 0.2, y: 0.7, visible: false });
  });
});
