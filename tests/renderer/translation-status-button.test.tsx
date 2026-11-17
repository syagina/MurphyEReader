// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { TranslationJobInfo } from '@shared/types';
import { TranslationStatusButton } from '@renderer/components/TranslationStatusButton';
import { useTranslationStore } from '@renderer/stores/translation';

function setJob(
  status: TranslationJobInfo['status'],
  hidden: boolean,
): void {
  useTranslationStore.setState({
    job: {
      jobId: 'job-1',
      paperId: 7,
      title: '样本论文',
      status,
      startedAt: 1,
      percent: null,
      line: '',
      logs: [],
      error: null,
    },
    logs: [],
    collapsed: false,
    hidden,
    donePaper: null,
  });
}

beforeEach(() => {
  setJob('running', false);
});

afterEach(() => {
  cleanup();
});

describe('TranslationStatusButton', () => {
  it('is absent while the card is visible', () => {
    const { container } = render(<TranslationStatusButton />);
    expect(container.querySelector('button')).toBeNull();
  });

  it('appears when the card is hidden and reopens it', () => {
    setJob('running', true);
    render(<TranslationStatusButton />);
    const button = screen.getByRole('button', { name: '翻译中' });
    expect(button.className).toContain('running');
    fireEvent.click(button);
    expect(useTranslationStore.getState().hidden).toBe(false);
    expect(screen.queryByRole('button', { name: '翻译中' })).toBeNull();
  });

  it('shows the terminal status instead of the running label', () => {
    setJob('done', true);
    render(<TranslationStatusButton />);
    expect(screen.getByRole('button', { name: '翻译完成' })).toBeTruthy();
  });

  it('is absent without a job', () => {
    useTranslationStore.setState({ job: null, hidden: true });
    const { container } = render(<TranslationStatusButton />);
    expect(container.querySelector('button')).toBeNull();
  });
});
