// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { ConfirmDialog } from '@renderer/components/ConfirmDialog';
import { confirm, useConfirmStore } from '@renderer/stores/confirm';

beforeEach(() => {
  useConfirmStore.setState({ requests: [] });
});

afterEach(() => {
  cleanup();
  useConfirmStore.setState({ requests: [] });
  document.body.replaceChildren();
});

describe('ConfirmDialog', () => {
  it('以 alertdialog 显示标题和正文，并把焦点放在取消上', async () => {
    render(<ConfirmDialog />);
    void confirm({
      title: '删除对话',
      message: '确定删除这个对话？此操作不可恢复。',
      confirmLabel: '删除',
      tone: 'danger',
    });

    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(screen.getByText('删除对话')).toBeTruthy();
    expect(screen.getByText('确定删除这个对话？此操作不可恢复。')).toBeTruthy();
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: '取消' }),
    );
  });

  it('点击确定返回 true 并关闭', async () => {
    render(<ConfirmDialog />);
    const answer = confirm({
      title: '删除文献',
      message: '确定删除？',
      confirmLabel: '删除',
    });

    fireEvent.click(await screen.findByRole('button', { name: '删除' }));

    await expect(answer).resolves.toBe(true);
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
  });

  it('取消、Escape 和点击遮罩都返回 false', async () => {
    render(<ConfirmDialog />);

    const cancelled = confirm({ title: '取消测试', message: '取消' });
    fireEvent.click(await screen.findByRole('button', { name: '取消' }));
    await expect(cancelled).resolves.toBe(false);

    const escaped = confirm({ title: 'Esc 测试', message: '按 Escape' });
    await screen.findByText('Esc 测试');
    fireEvent.keyDown(document, { key: 'Escape' });
    await expect(escaped).resolves.toBe(false);

    const overlay = confirm({ title: '遮罩测试', message: '点击遮罩' });
    const dialog = await screen.findByText('遮罩测试');
    fireEvent.click(dialog.parentElement?.parentElement as HTMLElement);
    await expect(overlay).resolves.toBe(false);
  });

  it('关闭后把焦点还给打开前的元素', async () => {
    render(<ConfirmDialog />);
    const textarea = document.createElement('textarea');
    document.body.append(textarea);
    textarea.focus();
    expect(document.activeElement).toBe(textarea);

    const answer = confirm({ title: '删除标注', message: '确定删除？' });
    await waitFor(() => {
      expect(document.activeElement).toBe(
        screen.getByRole('button', { name: '取消' }),
      );
    });

    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    await expect(answer).resolves.toBe(false);
    await waitFor(() => {
      expect(document.activeElement).toBe(textarea);
    });
  });

  it('队列中的请求依次显示并各自返回结果', async () => {
    render(<ConfirmDialog />);

    const first = confirm({ title: '第一个', message: '先显示这个' });
    const second = confirm({ title: '第二个', message: '再显示这个' });

    await screen.findByText('第一个');
    expect(screen.queryByText('第二个')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '确定' }));
    await expect(first).resolves.toBe(true);

    await screen.findByText('第二个');
    expect(screen.queryByText('第一个')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    await expect(second).resolves.toBe(false);
  });
});
