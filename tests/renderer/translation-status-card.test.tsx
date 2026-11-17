// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { TranslationStatusCard } from '@renderer/components/TranslationStatusCard';
import {
  TRANSLATION_CARD_POSITION_STORAGE_KEY,
} from '@renderer/lib/translation-card-position';
import { useTranslationStore } from '@renderer/stores/translation';

const CARD_RECT = { left: 600, top: 500, width: 360, height: 200 };

let setPointerCapture: ReturnType<typeof vi.fn>;
let releasePointerCapture: ReturnType<typeof vi.fn>;
let hasPointerCapture: ReturnType<typeof vi.fn>;

function cardRect(): DOMRect {
  return {
    ...CARD_RECT,
    right: CARD_RECT.left + CARD_RECT.width,
    bottom: CARD_RECT.top + CARD_RECT.height,
    x: CARD_RECT.left,
    y: CARD_RECT.top,
    toJSON: () => ({}),
  } as DOMRect;
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

function renderCard(): {
  container: HTMLElement;
  head: Element;
  card: HTMLElement;
} {
  const { container } = render(<TranslationStatusCard />);
  const head = container.querySelector('.translation-status-head');
  const card = container.querySelector<HTMLElement>(
    '.translation-status-card',
  );
  if (head === null || card === null) {
    throw new Error('translation status card did not render');
  }
  return { container, head, card };
}

beforeEach(() => {
  window.localStorage.clear();
  useTranslationStore.setState({
    job: {
      jobId: 'job-1',
      paperId: 7,
      title: '论文',
      status: 'running',
      startedAt: Date.now(),
      percent: 42,
      line: '正在翻译',
      logs: [],
      error: null,
    },
    logs: [],
    collapsed: false,
    hidden: false,
    donePaper: null,
  });
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
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    function (this: HTMLElement) {
      return this.classList.contains('translation-status-card')
        ? cardRect()
        : ({
            left: 0,
            top: 0,
            width: 0,
            height: 0,
            right: 0,
            bottom: 0,
            x: 0,
            y: 0,
            toJSON: () => ({}),
          } as DOMRect);
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

describe('TranslationStatusCard dragging', () => {
  it('moves the card by its header and persists the drop position', () => {
    const { head, card } = renderCard();
    fireEvent.pointerDown(head, pointerInit(640, 510));
    expect(setPointerCapture).toHaveBeenCalledWith(1);

    fireEvent.pointerMove(head, pointerInit(300, 200));
    expect(card.style.left).toBe('260px');
    expect(card.style.top).toBe('190px');

    fireEvent.pointerUp(head, pointerInit(300, 200));
    expect(
      window.localStorage.getItem(TRANSLATION_CARD_POSITION_STORAGE_KEY),
    ).toBe('{"left":260,"top":190}');
  });

  it('clamps a dragged card to the viewport edge', () => {
    const { head, card } = renderCard();
    fireEvent.pointerDown(head, pointerInit(640, 510));
    fireEvent.pointerMove(head, pointerInit(5000, 5000));
    // 1024 - 360 - 8 and 768 - 200 - 8, the last fully visible position.
    expect(card.style.left).toBe('656px');
    expect(card.style.top).toBe('560px');
  });

  it('clamps a saved position when the card reopens', () => {
    window.localStorage.setItem(
      TRANSLATION_CARD_POSITION_STORAGE_KEY,
      '{"left":-100,"top":-50}',
    );
    const { card } = renderCard();
    expect(card.style.left).toBe('8px');
    expect(card.style.top).toBe('8px');
  });

  it('restores a saved on-screen position', () => {
    window.localStorage.setItem(
      TRANSLATION_CARD_POSITION_STORAGE_KEY,
      '{"left":120,"top":90}',
    );
    const { card } = renderCard();
    expect(card.style.left).toBe('120px');
    expect(card.style.top).toBe('90px');
  });

  it('re-clamps to the viewport when the window shrinks', () => {
    window.localStorage.setItem(
      TRANSLATION_CARD_POSITION_STORAGE_KEY,
      '{"left":120,"top":90}',
    );
    const { card } = renderCard();
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(300);
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(150);
    fireEvent(window, new Event('resize'));
    expect(card.style.left).toBe('8px');
    expect(card.style.top).toBe('8px');
    // The larger-screen position stays saved for the next large window.
    expect(
      window.localStorage.getItem(TRANSLATION_CARD_POSITION_STORAGE_KEY),
    ).toBe('{"left":120,"top":90}');
  });

  it('closes the card without cancelling the running job', () => {
    const { container } = renderCard();
    const close = container.querySelector('[aria-label="关闭翻译窗口"]');
    if (close === null) {
      throw new Error('close button is missing');
    }
    fireEvent.pointerDown(close, pointerInit(640, 510));
    expect(setPointerCapture).not.toHaveBeenCalled();
    fireEvent.click(close);
    expect(useTranslationStore.getState().hidden).toBe(true);
    expect(useTranslationStore.getState().job?.status).toBe('running');
  });

  it('renders nothing while the user has hidden the card', () => {
    useTranslationStore.setState({ hidden: true });
    const { container } = render(<TranslationStatusCard />);
    expect(container.querySelector('.translation-status-card')).toBeNull();
  });
});
