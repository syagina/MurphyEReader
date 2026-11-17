// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AnnotationToolbar } from '@renderer/components/AnnotationToolbar';
import type { AnnotationToolbarProps } from '@renderer/components/AnnotationToolbar';

type Handlers = Pick<
  AnnotationToolbarProps,
  'onCreateNote' | 'onApplyMark' | 'onClearMark'
>;

let handlers: Handlers;

function makeHandlers(): Handlers {
  return {
    onCreateNote: vi.fn(),
    onApplyMark: vi.fn(),
    onClearMark: vi.fn(),
  };
}

function renderToolbar(overrides: Partial<AnnotationToolbarProps> = {}) {
  return render(
    <AnnotationToolbar disabled={false} hasSelection {...handlers} {...overrides} />,
  );
}

function openAnnotationMenu(): void {
  fireEvent.click(screen.getByRole('button', { name: '标注' }));
}

beforeEach(() => {
  handlers = makeHandlers();
});

afterEach(() => {
  cleanup();
});

describe('AnnotationToolbar', () => {
  it('无选区时禁用标注，但便签仍可开启右键模式', () => {
    render(<AnnotationToolbar disabled={false} hasSelection={false} {...handlers} />);
    expect(screen.getByRole('button', { name: '标注' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: '便签' }).hasAttribute('disabled')).toBe(false);
  });

  it('删除线收在标注菜单内，不再作为独立工具栏按钮', () => {
    renderToolbar();
    expect(screen.queryByRole('button', { name: '删除线' })).toBeNull();
    openAnnotationMenu();
    expect(screen.getByRole('button', { name: '删除线' })).toBeTruthy();
  });

  it('标注菜单默认列出全部样式与高亮五色', () => {
    renderToolbar();
    openAnnotationMenu();
    for (const name of ['高亮', '下划线', '双线', '虚线', '波浪线', '删除线']) {
      expect(screen.getByRole('button', { name })).toBeTruthy();
    }
    for (const name of ['高亮黄色', '高亮绿色', '高亮蓝色', '高亮粉色', '高亮紫色']) {
      expect(screen.getByRole('button', { name })).toBeTruthy();
    }
    expect(screen.getByRole('button', { name: '无标记' })).toBeTruthy();
  });

  it('选择高亮颜色立即以高亮样式回调', () => {
    renderToolbar();
    openAnnotationMenu();
    fireEvent.click(screen.getByRole('button', { name: '高亮绿色' }));
    expect(handlers.onApplyMark).toHaveBeenCalledWith('highlight', '#4ade80');
    expect(screen.queryByRole('button', { name: '高亮绿色' })).toBeNull();
  });

  it('切换到下划线后色板包含黑色，点击黑色写入该颜色', () => {
    renderToolbar();
    openAnnotationMenu();
    fireEvent.click(screen.getByRole('button', { name: '下划线' }));
    for (const name of [
      '下划线红色',
      '下划线橙色',
      '下划线黄色',
      '下划线绿色',
      '下划线蓝色',
      '下划线紫色',
      '下划线黑色',
    ]) {
      expect(screen.getByRole('button', { name })).toBeTruthy();
    }
    fireEvent.click(screen.getByRole('button', { name: '下划线黑色' }));
    expect(handlers.onApplyMark).toHaveBeenCalledWith('underline', '#000000');
  });

  it('删除线在菜单内选样式再选颜色', () => {
    renderToolbar();
    openAnnotationMenu();
    fireEvent.click(screen.getByRole('button', { name: '删除线' }));
    fireEvent.click(screen.getByRole('button', { name: '下划线绿色' }));
    expect(handlers.onApplyMark).toHaveBeenCalledWith('strikeout', '#22c55e');
  });

  it('无标记清除当前样式所属的标记族', () => {
    renderToolbar();
    openAnnotationMenu();
    fireEvent.click(screen.getByRole('button', { name: '无标记' }));
    expect(handlers.onClearMark).toHaveBeenCalledWith('highlight');

    openAnnotationMenu();
    fireEvent.click(screen.getByRole('button', { name: '下划线' }));
    fireEvent.click(screen.getByRole('button', { name: '无标记' }));
    expect(handlers.onClearMark).toHaveBeenLastCalledWith('underline');
  });

  it('mousedown 阻止默认以保留选区', () => {
    renderToolbar();
    const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    expect(screen.getByRole('button', { name: '标注' }).dispatchEvent(event)).toBe(false);
  });

  it('无选区时标注菜单不可打开', () => {
    renderToolbar({ hasSelection: false });
    expect(screen.getByRole('button', { name: '标注' }).hasAttribute('disabled')).toBe(true);
    expect(screen.queryByRole('button', { name: '删除线' })).toBeNull();
  });

  it('disabled 时所有操作按钮禁用，包括便签', () => {
    renderToolbar({ disabled: true, hasSelection: false });
    for (const name of ['标注', '便签', '绘制']) {
      expect(screen.getByRole('button', { name }).hasAttribute('disabled')).toBe(true);
    }
  });

  it('根元素标记保留选区', () => {
    const { container } = renderToolbar();
    expect(container.querySelector('[data-keep-selection="true"]')).not.toBeNull();
  });

  it('便签按钮调用 onCreateNote', () => {
    renderToolbar();
    fireEvent.click(screen.getByRole('button', { name: '便签' }));
    expect(handlers.onCreateNote).toHaveBeenCalledTimes(1);
  });

  it('便签模式激活时便签按钮显示按下态', () => {
    renderToolbar({ noteMode: true });
    const noteButton = screen.getByRole('button', { name: '便签' });
    expect(noteButton.getAttribute('aria-pressed')).toBe('true');
    expect(noteButton.className).toContain('active');
    expect(noteButton.getAttribute('title')).toContain('右键');
  });

  it('未开启便签模式时便签按钮不是按下态', () => {
    renderToolbar();
    const noteButton = screen.getByRole('button', { name: '便签' });
    expect(noteButton.getAttribute('aria-pressed')).toBe('false');
    expect(noteButton.className).not.toContain('active');
  });

  it('绘制模式下绘制按钮激活，标注与便签禁用但绘制本身可点', () => {
    const onToggleDrawing = vi.fn();
    renderToolbar({ drawingMode: true, onToggleDrawing });
    const drawButton = screen.getByRole('button', { name: '绘制' });
    expect(drawButton.getAttribute('aria-pressed')).toBe('true');
    expect(drawButton.className).toContain('active');
    expect(drawButton.hasAttribute('disabled')).toBe(false);
    for (const name of ['标注', '便签']) {
      expect(screen.getByRole('button', { name }).hasAttribute('disabled')).toBe(true);
    }
    fireEvent.click(drawButton);
    expect(onToggleDrawing).toHaveBeenCalledTimes(1);
  });

  it('非绘制模式下绘制按钮未按下，点击回调切换', () => {
    const onToggleDrawing = vi.fn();
    renderToolbar({ onToggleDrawing });
    const drawButton = screen.getByRole('button', { name: '绘制' });
    expect(drawButton.getAttribute('aria-pressed')).toBe('false');
    expect(drawButton.className).not.toContain('active');
    fireEvent.click(drawButton);
    expect(onToggleDrawing).toHaveBeenCalledTimes(1);
  });

  it('点击绘制关闭已打开的标注菜单', () => {
    const onToggleDrawing = vi.fn();
    renderToolbar({ onToggleDrawing });
    openAnnotationMenu();
    expect(screen.getByRole('button', { name: '高亮绿色' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '绘制' }));
    expect(screen.queryByRole('button', { name: '高亮绿色' })).toBeNull();
    expect(onToggleDrawing).toHaveBeenCalledTimes(1);
  });

  it('点击工具栏外部关闭标注菜单', () => {
    renderToolbar();
    openAnnotationMenu();
    expect(screen.getByRole('button', { name: '高亮绿色' })).toBeTruthy();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('button', { name: '高亮绿色' })).toBeNull();
  });

  it('点击菜单内部不关闭标注菜单', () => {
    renderToolbar();
    openAnnotationMenu();
    fireEvent.pointerDown(screen.getByRole('button', { name: '下划线' }));
    expect(screen.getByRole('button', { name: '高亮绿色' })).toBeTruthy();
  });

  it('按 Escape 关闭标注菜单', () => {
    renderToolbar();
    openAnnotationMenu();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('button', { name: '高亮绿色' })).toBeNull();
  });

  it('菜单开关通知外部，用于隐藏选区浮动栏', () => {
    const onMenuOpenChange = vi.fn();
    renderToolbar({ onMenuOpenChange });
    expect(onMenuOpenChange).toHaveBeenLastCalledWith(false);
    openAnnotationMenu();
    expect(onMenuOpenChange).toHaveBeenLastCalledWith(true);
    fireEvent.pointerDown(document.body);
    expect(onMenuOpenChange).toHaveBeenLastCalledWith(false);
  });

  it('选区消失后自动关闭菜单', () => {
    const view = renderToolbar();
    openAnnotationMenu();
    expect(screen.getByRole('button', { name: '高亮绿色' })).toBeTruthy();
    view.rerender(
      <AnnotationToolbar disabled={false} hasSelection={false} {...handlers} />,
    );
    expect(screen.queryByRole('button', { name: '高亮绿色' })).toBeNull();
  });
});
