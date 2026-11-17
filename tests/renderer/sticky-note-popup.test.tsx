// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type { StickyNote } from '@shared/types';
import { StickyNotePopup } from '@renderer/components/StickyNotePopup';
import type { StickyNotePopupProps } from '@renderer/components/StickyNotePopup';

function makeNote(overrides: Partial<StickyNote> = {}): StickyNote {
  return {
    id: 1,
    paperId: 1,
    pdfVersion: 'original',
    pageNo: 1,
    quote: '引用文本',
    contentMd: '内容',
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
    createdAt: 1_000,
    updatedAt: 1_000,
    ...overrides,
  };
}

function makeProps(
  overrides: Partial<StickyNotePopupProps> = {},
): StickyNotePopupProps {
  return {
    note: makeNote(),
    top: 10,
    left: 20,
    onClose: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    onMoveFree: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
}

function rect(
  left: number,
  top: number,
  width: number,
  height: number,
): DOMRect {
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
}

function addReadingArea(
  left: number,
  top: number,
  width: number,
  height: number,
): HTMLElement {
  const area = document.createElement('div');
  area.setAttribute('data-reading-area', 'true');
  area.getBoundingClientRect = () => rect(left, top, width, height);
  document.body.appendChild(area);
  return area;
}

let setPointerCapture: ReturnType<typeof vi.fn>;
let releasePointerCapture: ReturnType<typeof vi.fn>;
let hasPointerCapture: ReturnType<typeof vi.fn>;

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
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
  for (const name of [
    'setPointerCapture',
    'releasePointerCapture',
    'hasPointerCapture',
  ]) {
    delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name];
  }
});

describe('StickyNotePopup', () => {
  it('查看态只显示内容与编辑/关闭/删除，不显示样式、颜色、页边或位置控件', () => {
    render(<StickyNotePopup {...makeProps()} />);
    expect(screen.getByText('引用文本')).toBeTruthy();
    expect(screen.getByText('内容')).toBeTruthy();
    for (const name of ['编辑', '关闭', '删除']) {
      expect(screen.getByRole('button', { name })).toBeTruthy();
    }
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByRole('radiogroup', { name: '弹窗位置' })).toBeNull();
    expect(screen.queryByRole('button', { name: '高亮绿色' })).toBeNull();
    expect(screen.queryByText(/第 1 页/)).toBeNull();
  });

  it('编辑/关闭/删除分别调用对应回调', () => {
    const base = makeProps();
    render(<StickyNotePopup {...base} />);
    fireEvent.click(screen.getByRole('button', { name: '编辑' }));
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    fireEvent.click(screen.getByRole('button', { name: '删除' }));
    expect(base.onEdit).toHaveBeenCalledTimes(1);
    expect(base.onClose).toHaveBeenCalledTimes(1);
    expect(base.onDelete).toHaveBeenCalledTimes(1);
  });

  it('纯标记也可打开编辑且不渲染空正文', () => {
    const base = makeProps({
      note: makeNote({ kind: 'mark', contentMd: '' }),
    });
    render(<StickyNotePopup {...base} />);
    expect(screen.getByRole('button', { name: '编辑' })).toBeTruthy();
    expect(screen.queryByText('内容')).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '编辑' }));
    expect(base.onEdit).toHaveBeenCalledTimes(1);
  });

  it('整页便签同样只显示内容与操作按钮', () => {
    const base = makeProps({
      note: makeNote({
        anchor: { kind: 'page' },
        markStyle: 'none',
        contentMd: '页边内容',
      }),
    });
    render(<StickyNotePopup {...base} />);
    expect(screen.getByText('页边内容')).toBeTruthy();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByRole('radiogroup', { name: '弹窗位置' })).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('自由模式标题栏可拖动，按阅读区域归一化位置', async () => {
    const base = makeProps({
      note: makeNote({ popup: { mode: 'free', x: 0.5, y: 0.25 } }),
    });
    const { container } = render(<StickyNotePopup {...base} />);
    const card = container.querySelector<HTMLElement>('.sticky-note-popup');
    if (card === null) {
      throw new Error('popup card not found');
    }
    card.getBoundingClientRect = () => rect(20, 10, 380, 200);
    addReadingArea(0, 0, 1_000, 800);

    const handle = container.querySelector<HTMLElement>(
      '[data-popup-drag-handle]',
    );
    expect(handle).not.toBeNull();
    if (handle === null) {
      return;
    }
    fireEvent.pointerDown(handle, {
      pointerId: 1,
      button: 0,
      buttons: 1,
      clientX: 100,
      clientY: 100,
    });
    fireEvent.pointerMove(handle, {
      pointerId: 1,
      buttons: 1,
      clientX: 240,
      clientY: 190,
    });
    fireEvent.pointerUp(handle, {
      pointerId: 1,
      button: 0,
      buttons: 0,
      clientX: 240,
      clientY: 190,
    });

    await waitFor(() => {
      expect(base.onMoveFree).toHaveBeenCalledTimes(1);
    });
    // (20, 10) + (140, 90) = (160, 100) → (0.16, 0.125) of the reading area.
    expect(base.onMoveFree).toHaveBeenCalledWith(0.16, 0.125);
  });

  it('自由模式无阅读区域时不移动', async () => {
    const base = makeProps({
      note: makeNote({ popup: { mode: 'free', x: 0.5, y: 0.25 } }),
    });
    const { container } = render(<StickyNotePopup {...base} />);
    const handle = container.querySelector<HTMLElement>(
      '[data-popup-drag-handle]',
    );
    if (handle === null) {
      throw new Error('drag handle not found');
    }
    fireEvent.pointerDown(handle, {
      pointerId: 1,
      button: 0,
      buttons: 1,
      clientX: 100,
      clientY: 100,
    });
    fireEvent.pointerUp(handle, {
      pointerId: 1,
      button: 0,
      buttons: 0,
      clientX: 120,
      clientY: 120,
    });
    await waitFor(() => {
      expect(setPointerCapture).toHaveBeenCalled();
    });
    expect(base.onMoveFree).not.toHaveBeenCalled();
  });

  it('跟随标记模式同样可以拖动并保存为自由位置', async () => {
    const base = makeProps();
    const { container } = render(<StickyNotePopup {...base} />);
    const card = container.querySelector<HTMLElement>('.sticky-note-popup');
    if (card === null) {
      throw new Error('popup card not found');
    }
    card.getBoundingClientRect = () => rect(20, 10, 380, 200);
    addReadingArea(0, 0, 1_000, 800);
    const handle = container.querySelector<HTMLElement>(
      '[data-popup-drag-handle]',
    );
    expect(handle).not.toBeNull();
    if (handle === null) {
      return;
    }
    fireEvent.pointerDown(handle, {
      pointerId: 1,
      button: 0,
      buttons: 1,
      clientX: 100,
      clientY: 100,
    });
    fireEvent.pointerMove(handle, {
      pointerId: 1,
      buttons: 1,
      clientX: 240,
      clientY: 190,
    });
    fireEvent.pointerUp(handle, {
      pointerId: 1,
      button: 0,
      buttons: 0,
      clientX: 240,
      clientY: 190,
    });
    await waitFor(() => {
      expect(base.onMoveFree).toHaveBeenCalledWith(0.16, 0.125);
    });
  });

  it('自由拖动忽略控件内的 pointerdown', () => {
    const base = makeProps({
      note: makeNote({ popup: { mode: 'free', x: 0.5, y: 0.25 } }),
    });
    const { container } = render(<StickyNotePopup {...base} />);
    const handle = container.querySelector<HTMLElement>(
      '[data-popup-drag-handle]',
    );
    const card = container.querySelector<HTMLElement>('.sticky-note-popup');
    if (handle === null || card === null) {
      throw new Error('drag surface not found');
    }
    for (const tag of ['button', 'select', 'input', 'textarea']) {
      const control = document.createElement(tag);
      handle.appendChild(control);
      fireEvent.pointerDown(control, {
        pointerId: 1,
        button: 0,
        clientX: 100,
        clientY: 100,
      });
      fireEvent.pointerMove(handle, {
        pointerId: 1,
        clientX: 160,
        clientY: 150,
      });
      expect(card.style.left).toBe('20px');
      expect(card.style.top).toBe('10px');
      control.remove();
    }
    expect(setPointerCapture).not.toHaveBeenCalled();
    expect(base.onMoveFree).not.toHaveBeenCalled();
  });

  it('pointercancel 撤销拖动预览', () => {
    const base = makeProps({
      note: makeNote({ popup: { mode: 'free', x: 0.5, y: 0.25 } }),
    });
    const { container } = render(<StickyNotePopup {...base} />);
    const card = container.querySelector<HTMLElement>('.sticky-note-popup');
    const handle = container.querySelector<HTMLElement>(
      '[data-popup-drag-handle]',
    );
    if (card === null || handle === null) {
      throw new Error('drag surface not found');
    }
    fireEvent.pointerDown(handle, {
      pointerId: 1,
      button: 0,
      clientX: 100,
      clientY: 100,
    });
    fireEvent.pointerMove(handle, {
      pointerId: 1,
      clientX: 160,
      clientY: 150,
    });
    expect(card.style.left).toBe('80px');
    expect(card.style.top).toBe('60px');

    fireEvent.pointerCancel(handle, { pointerId: 1 });
    expect(card.style.left).toBe('20px');
    expect(card.style.top).toBe('10px');
    expect(base.onMoveFree).not.toHaveBeenCalled();
  });

  it('弹窗根节点是标题为标注的对话框', () => {
    render(<StickyNotePopup {...makeProps()} />);
    expect(screen.getByRole('dialog', { name: '标注' })).toBeTruthy();
  });
});
