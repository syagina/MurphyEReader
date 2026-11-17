// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Onboarding } from '@renderer/components/Onboarding';

afterEach(cleanup);

function setup() {
  const onFinish = vi.fn();
  const onOpenSettings = vi.fn();
  render(<Onboarding onFinish={onFinish} onOpenSettings={onOpenSettings} />);
  return { onFinish, onOpenSettings };
}

describe('Onboarding', () => {
  it('渲染第 1 步、四个步骤和跳过按钮', () => {
    setup();
    expect(
      screen.getByRole('heading', { name: '把论文收进一个井井有条的文献库' }),
    ).toBeTruthy();
    for (const label of ['文献库', '阅读与翻译', '智慧阅读与标注', '开始使用']) {
      expect(screen.getByRole('button', { name: new RegExp(label) })).toBeTruthy();
    }
    expect(screen.getByRole('button', { name: '跳过引导' })).toBeTruthy();
  });

  it('下一步/上一步/步骤栏都能切换', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: /下一步/ }));
    expect(
      screen.getByRole('heading', {
        name: '保留排版的整篇翻译，原文译文随时对照',
      }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /智慧阅读与标注/ }));
    expect(
      screen.getByRole('heading', { name: '边读边问，边读边标' }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '上一步' }));
    expect(
      screen.getByRole('heading', {
        name: '保留排版的整篇翻译，原文译文随时对照',
      }),
    ).toBeTruthy();
  });

  it('跳过调用 onFinish("skip")', () => {
    const { onFinish } = setup();
    fireEvent.click(screen.getByRole('button', { name: '跳过引导' }));
    expect(onFinish).toHaveBeenCalledWith('skip');
  });

  it('最后一步完成调用 onFinish("done")，并隐藏跳过', () => {
    const { onFinish } = setup();
    fireEvent.click(screen.getByRole('button', { name: /开始使用/ }));
    expect(screen.queryByRole('button', { name: '跳过引导' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '进入文献库' }));
    expect(onFinish).toHaveBeenCalledWith('done');
  });

  it('最后一步的两个配置按钮打开对应设置页', () => {
    const { onOpenSettings } = setup();
    fireEvent.click(screen.getByRole('button', { name: /开始使用/ }));
    fireEvent.click(screen.getByRole('button', { name: '配置 AI 接口' }));
    fireEvent.click(screen.getByRole('button', { name: '安装翻译引擎' }));
    expect(onOpenSettings).toHaveBeenNthCalledWith(1, 'ai');
    expect(onOpenSettings).toHaveBeenNthCalledWith(2, 'engine');
  });

  it('Esc、左右方向键只作用于引导层', () => {
    const { onFinish } = setup();
    const dialog = screen.getByRole('dialog');
    fireEvent.keyDown(dialog, { key: 'ArrowRight' });
    expect(
      screen.getByRole('heading', {
        name: '保留排版的整篇翻译，原文译文随时对照',
      }),
    ).toBeTruthy();
    fireEvent.keyDown(dialog, { key: 'ArrowLeft' });
    expect(
      screen.getByRole('heading', { name: '把论文收进一个井井有条的文献库' }),
    ).toBeTruthy();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onFinish).toHaveBeenCalledWith('skip');
  });

  it('Tab 焦点不会离开引导层', () => {
    setup();
    const dialog = screen.getByRole('dialog');
    const buttons = dialog.querySelectorAll('button');
    const last = buttons[buttons.length - 1] as HTMLButtonElement;
    last.focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('根节点是模态对话框', () => {
    setup();
    expect(screen.getByRole('dialog').getAttribute('aria-modal')).toBe('true');
  });
});
