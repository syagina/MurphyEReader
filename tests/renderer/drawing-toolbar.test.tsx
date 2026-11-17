// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DrawingToolbar } from '@renderer/components/DrawingToolbar';
import type { DrawingToolbarProps } from '@renderer/components/DrawingToolbar';

type Handlers = Pick<
  DrawingToolbarProps,
  | 'onToolChange'
  | 'onColorChange'
  | 'onWidthChange'
  | 'onUndo'
  | 'onRedo'
  | 'onClearPage'
  | 'onExit'
>;

let handlers: Handlers;

function makeHandlers(): Handlers {
  return {
    onToolChange: vi.fn(),
    onColorChange: vi.fn(),
    onWidthChange: vi.fn(),
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    onClearPage: vi.fn(),
    onExit: vi.fn(),
  };
}

function renderToolbar(overrides: Partial<DrawingToolbarProps> = {}) {
  return render(
    <DrawingToolbar
      tool="pen"
      color="#111827"
      width={3}
      canUndo
      canRedo
      {...handlers}
      {...overrides}
    />,
  );
}

beforeEach(() => {
  handlers = makeHandlers();
});

afterEach(() => {
  cleanup();
});

describe('DrawingToolbar', () => {
  it('根元素是绘制工具栏', () => {
    renderToolbar();
    expect(screen.getByRole('toolbar', { name: '绘制工具栏' })).toBeTruthy();
  });

  it('点击直线回调 onToolChange', () => {
    renderToolbar();
    fireEvent.click(screen.getByRole('button', { name: '直线' }));
    expect(handlers.onToolChange).toHaveBeenCalledWith('line');
  });

  it('canUndo=false 时撤销禁用', () => {
    renderToolbar({ canUndo: false });
    expect(
      screen.getByRole('button', { name: '撤销' }).hasAttribute('disabled'),
    ).toBe(true);
    expect(
      screen.getByRole('button', { name: '重做' }).hasAttribute('disabled'),
    ).toBe(false);
  });

  it('canRedo=false 时重做禁用', () => {
    renderToolbar({ canRedo: false });
    expect(
      screen.getByRole('button', { name: '重做' }).hasAttribute('disabled'),
    ).toBe(true);
    expect(
      screen.getByRole('button', { name: '撤销' }).hasAttribute('disabled'),
    ).toBe(false);
  });

  it('点击清空本页回调 onClearPage', () => {
    renderToolbar();
    fireEvent.click(screen.getByRole('button', { name: '清空本页' }));
    expect(handlers.onClearPage).toHaveBeenCalledTimes(1);
  });

  it('点击完成回调 onExit', () => {
    renderToolbar();
    fireEvent.click(screen.getByRole('button', { name: '完成' }));
    expect(handlers.onExit).toHaveBeenCalledTimes(1);
  });

  it('点击红色色块回调 onColorChange', () => {
    renderToolbar();
    fireEvent.click(screen.getByRole('button', { name: '红色' }));
    expect(handlers.onColorChange).toHaveBeenCalledWith('#ef4444');
  });

  it('点击粗细 4 回调 onWidthChange', () => {
    renderToolbar();
    fireEvent.click(screen.getByRole('button', { name: '粗细 4' }));
    expect(handlers.onWidthChange).toHaveBeenCalledWith(4);
  });

  it('宽度选项含默认笔宽 3，且按当前宽度显示按下态', () => {
    renderToolbar();
    const three = screen.getByRole('button', { name: '粗细 3' });
    expect(three.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(three);
    expect(handlers.onWidthChange).toHaveBeenCalledWith(3);
  });

  it('当前工具 aria-pressed=true，其余为 false', () => {
    renderToolbar({ tool: 'line' });
    expect(
      screen.getByRole('button', { name: '直线' }).getAttribute('aria-pressed'),
    ).toBe('true');
    expect(
      screen.getByRole('button', { name: '笔' }).getAttribute('aria-pressed'),
    ).toBe('false');
  });

  it('撤销与重做分别回调', () => {
    renderToolbar();
    fireEvent.click(screen.getByRole('button', { name: '撤销' }));
    fireEvent.click(screen.getByRole('button', { name: '重做' }));
    expect(handlers.onUndo).toHaveBeenCalledTimes(1);
    expect(handlers.onRedo).toHaveBeenCalledTimes(1);
  });

  it('颜色与粗细的选中态跟随 props', () => {
    renderToolbar({ color: '#ef4444', width: 4 });
    expect(
      screen.getByRole('button', { name: '红色' }).getAttribute('aria-pressed'),
    ).toBe('true');
    expect(
      screen.getByRole('button', { name: '黑色' }).getAttribute('aria-pressed'),
    ).toBe('false');
    expect(
      screen.getByRole('button', { name: '粗细 4' }).getAttribute('aria-pressed'),
    ).toBe('true');
    expect(
      screen.getByRole('button', { name: '粗细 1' }).getAttribute('aria-pressed'),
    ).toBe('false');
  });
});
