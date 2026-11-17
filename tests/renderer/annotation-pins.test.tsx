// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import type { StickyNote } from '@shared/types';
import { AnnotationPins } from '@renderer/components/AnnotationPins';
import type { AnnotationPinsProps } from '@renderer/components/AnnotationPins';
import {
  PAGE_NOTE_ICON_GAP,
  PAGE_NOTE_ICON_MARGIN,
  PAGE_NOTE_ICON_SIZE,
} from '@renderer/lib/sticky-note-geometry';

const PAGE_WIDTH = 600;
const PAGE_HEIGHT = 800;

let setPointerCapture: ReturnType<typeof vi.fn>;
let releasePointerCapture: ReturnType<typeof vi.fn>;
let hasPointerCapture: ReturnType<typeof vi.fn>;

function makeNote(overrides: Partial<StickyNote> = {}): StickyNote {
  const id = overrides.id ?? 1;
  return {
    id,
    paperId: 1,
    pdfVersion: 'original',
    pageNo: 1,
    quote: '引用',
    contentMd: '内容',
    anchor: { kind: 'page' },
    source: 'manual',
    kind: 'note',
    markStyle: 'none',
    color: null,
    pin: null,
    popup: null,
    drawing: null,
    createdAt: 1_000 + id,
    updatedAt: 1_000 + id,
    ...overrides,
  };
}

function pointerInit(
  clientX: number,
  clientY: number,
  overrides: Partial<PointerEventInit> = {},
): PointerEventInit {
  return {
    pointerId: 1,
    button: 0,
    buttons: 1,
    clientX,
    clientY,
    ...overrides,
  };
}

function renderPins(
  notes: StickyNote[],
  overrides: Partial<AnnotationPinsProps> = {},
) {
  const onOpen = vi.fn();
  const onMove = vi.fn(() => Promise.resolve(true));
  const view = render(
    <AnnotationPins
      notes={notes}
      pageWidth={PAGE_WIDTH}
      pageHeight={PAGE_HEIGHT}
      activeNoteId={null}
      disabled={false}
      onOpen={onOpen}
      onMove={onMove}
      {...overrides}
    />,
  );
  return { ...view, onOpen, onMove };
}

function getPin(container: HTMLElement, id: number): HTMLButtonElement {
  const pin = container.querySelector<HTMLButtonElement>(
    `[data-sticky-note-id="${id}"]`,
  );
  if (pin === null) {
    throw new Error(`pin ${id} not found`);
  }
  return pin;
}

beforeEach(() => {
  setPointerCapture = vi.fn();
  releasePointerCapture = vi.fn();
  hasPointerCapture = vi.fn(() => true);
  // jsdom does not implement pointer capture; provide the surface the
  // component uses without changing its behavior.
  Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
    configurable: true,
    value: setPointerCapture,
  });
  Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', {
    configurable: true,
    value: releasePointerCapture,
  });
  Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', {
    configurable: true,
    value: hasPointerCapture,
  });
  // The pin layer rect is the page, each pin button is its icon-sized box.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    function (this: HTMLElement) {
      const isLayer = this.classList.contains('annotation-pins');
      const left = isLayer ? 0 : Number.parseFloat(this.style.left) || 0;
      const top = isLayer ? 0 : Number.parseFloat(this.style.top) || 0;
      const width = isLayer ? PAGE_WIDTH : PAGE_NOTE_ICON_SIZE;
      const height = isLayer ? PAGE_HEIGHT : PAGE_NOTE_ICON_SIZE;
      return {
        left,
        top,
        width,
        height,
        right: left + width,
        bottom: top + height,
        x: left,
        y: top,
        toJSON: () => ({}),
      } as DOMRect;
    },
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  for (const name of [
    'setPointerCapture',
    'releasePointerCapture',
    'hasPointerCapture',
  ]) {
    delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name];
  }
});

describe('AnnotationPins', () => {
  it('可见 pin 占用默认堆叠槽位，后续整页便签从第 2 个槽位开始', () => {
    const pinned = makeNote({
      id: 1,
      createdAt: 1_000,
      pin: { x: 0.5, y: 0.5, visible: true },
    });
    const stacked = makeNote({ id: 2, createdAt: 2_000 });
    const { container } = renderPins([stacked, pinned]);

    expect(getPin(container, 1).style.left).toBe('300px');
    expect(getPin(container, 1).style.top).toBe('400px');
    expect(getPin(container, 2).style.left).toBe(
      `${PAGE_WIDTH - PAGE_NOTE_ICON_MARGIN - PAGE_NOTE_ICON_SIZE}px`,
    );
    expect(getPin(container, 2).style.top).toBe(
      `${PAGE_NOTE_ICON_MARGIN + PAGE_NOTE_ICON_SIZE + PAGE_NOTE_ICON_GAP}px`,
    );
  });

  it('同一页面的便签按创建顺序编号，隐藏的图标不占序号', () => {
    const hidden = makeNote({
      id: 1,
      createdAt: 500,
      pin: { x: 0.2, y: 0.2, visible: false },
    });
    const second = makeNote({ id: 2, createdAt: 2_000 });
    const first = makeNote({ id: 3, createdAt: 1_000 });
    const { container } = renderPins([second, hidden, first]);

    expect(getPin(container, 3).querySelector('text')?.textContent).toBe('1');
    expect(getPin(container, 2).querySelector('text')?.textContent).toBe('2');
    expect(container.querySelector('[data-sticky-note-id="1"]')).toBeNull();
  });

  it('隐藏 pin 的便签不渲染图标但仍占用默认堆叠槽位', () => {
    const hidden = makeNote({
      id: 1,
      createdAt: 1_000,
      pin: { x: 0.2, y: 0.2, visible: false },
    });
    const stacked = makeNote({ id: 2, createdAt: 2_000 });
    const { container } = renderPins([stacked, hidden]);

    expect(container.querySelectorAll('.annotation-pin')).toHaveLength(1);
    expect(getPin(container, 2).style.top).toBe(
      `${PAGE_NOTE_ICON_MARGIN + PAGE_NOTE_ICON_SIZE + PAGE_NOTE_ICON_GAP}px`,
    );
  });

  it('按下抬起未超过 3px 视为点击，只打开便签', () => {
    const note = makeNote();
    const { container, onOpen, onMove } = renderPins([note]);
    const pin = getPin(container, 1);

    fireEvent.pointerDown(pin, pointerInit(582, 18));
    fireEvent.pointerUp(pin, pointerInit(584, 20, { buttons: 0 }));

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith(note);
    expect(onMove).not.toHaveBeenCalled();
  });

  it('移动超过 3px 视为拖动，保存归一化位置且不打开便签', () => {
    const note = makeNote();
    const { container, onOpen, onMove } = renderPins([note]);
    const pin = getPin(container, 1);

    fireEvent.pointerDown(pin, pointerInit(582, 18));
    fireEvent.pointerMove(pin, pointerInit(582, 300));
    expect(pin.style.top).toBe('290px');
    fireEvent.pointerUp(pin, pointerInit(582, 300, { buttons: 0 }));

    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onMove).toHaveBeenCalledWith(note, {
      x: 0.9567,
      y: 0.3625,
      visible: true,
    });
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('disabled 时点击、拖动和键盘都不响应', () => {
    const { container, onOpen, onMove } = renderPins([makeNote()], {
      disabled: true,
    });
    const pin = getPin(container, 1);

    expect(pin.disabled).toBe(true);
    fireEvent.pointerDown(pin, pointerInit(582, 18));
    fireEvent.pointerMove(pin, pointerInit(582, 300));
    fireEvent.pointerUp(pin, pointerInit(582, 300, { buttons: 0 }));
    fireEvent.keyDown(pin, { key: 'Enter' });
    fireEvent.keyDown(pin, { key: ' ' });

    expect(onOpen).not.toHaveBeenCalled();
    expect(onMove).not.toHaveBeenCalled();
  });

  it('Enter 和空格打开便签并阻止默认行为，指针点击不会重复打开', () => {
    const note = makeNote();
    const { container, onOpen } = renderPins([note]);
    const pin = getPin(container, 1);

    expect(fireEvent.keyDown(pin, { key: 'Enter' })).toBe(false);
    expect(fireEvent.keyDown(pin, { key: ' ' })).toBe(false);
    expect(onOpen).toHaveBeenCalledTimes(2);
    expect(onOpen).toHaveBeenNthCalledWith(1, note);
    expect(onOpen).toHaveBeenNthCalledWith(2, note);

    // A pointer click carries a click count and is opened by pointerup only.
    fireEvent.click(pin, { detail: 1 });
    expect(onOpen).toHaveBeenCalledTimes(2);
    // Assistive-technology/programmatic clicks have detail 0.
    fireEvent.click(pin, { detail: 0 });
    expect(onOpen).toHaveBeenCalledTimes(3);
  });

  it('丢失指针捕获会放弃拖动，之后的点击仍然可用', () => {
    const note = makeNote();
    const { container, onOpen, onMove } = renderPins([note]);
    const pin = getPin(container, 1);

    fireEvent.pointerDown(pin, pointerInit(582, 18));
    fireEvent.pointerMove(pin, pointerInit(582, 300));
    expect(pin.style.top).toBe('290px');
    fireEvent.lostPointerCapture(pin, { pointerId: 1 });
    expect(pin.style.top).toBe('8px');

    fireEvent.pointerUp(pin, pointerInit(582, 300, { buttons: 0 }));
    expect(onMove).not.toHaveBeenCalled();

    fireEvent.pointerDown(pin, pointerInit(582, 18));
    fireEvent.pointerUp(pin, pointerInit(582, 18, { buttons: 0 }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('拖动结束后吞掉图标外的兼容 mouseup，页面不会命中文字标记', () => {
    const { container } = renderPins([makeNote()]);
    const pin = getPin(container, 1);

    fireEvent.pointerDown(pin, pointerInit(582, 18));
    fireEvent.pointerMove(pin, pointerInit(582, 300));
    fireEvent.pointerUp(pin, pointerInit(582, 300, { buttons: 0 }));

    const pageMouseUp = vi.fn();
    document.addEventListener('mouseup', pageMouseUp);
    try {
      fireEvent.mouseUp(document.body);
    } finally {
      document.removeEventListener('mouseup', pageMouseUp);
    }
    expect(pageMouseUp).not.toHaveBeenCalled();
  });
});
