import { describe, expect, it } from 'vitest';
import {
  AI_FLOATING_DEFAULT_HEIGHT,
  AI_FLOATING_DEFAULT_WIDTH,
  AI_FLOATING_MARGIN,
  AI_FLOATING_MIN_HEIGHT,
  AI_FLOATING_MIN_WIDTH,
  AI_PANEL_DEFAULT_WIDTH,
  AI_PANEL_MAX_WIDTH,
  AI_PANEL_MIN_WIDTH,
  aiPanelMaxWidth,
  clampAiFloatingBounds,
  clampAiPanelWidth,
  defaultAiFloatingBounds,
  moveAiFloatingBounds,
  resizeAiFloatingBounds,
  resizeAiPanelWidth,
} from '@shared/ai-panel';

describe('AI 面板宽度常量', () => {
  it('最小 320、最大 900、默认 360', () => {
    expect(AI_PANEL_MIN_WIDTH).toBe(320);
    expect(AI_PANEL_MAX_WIDTH).toBe(900);
    expect(AI_PANEL_DEFAULT_WIDTH).toBe(360);
  });
});

describe('aiPanelMaxWidth', () => {
  it('宽窗口时上限为 900', () => {
    expect(aiPanelMaxWidth(1600)).toBe(900);
  });

  it('上限取窗口宽度的 70% 并向下取整', () => {
    expect(aiPanelMaxWidth(1000)).toBe(700);
    expect(aiPanelMaxWidth(1285)).toBe(899);
  });

  it('窗口过窄时上限不低于最小宽度', () => {
    expect(aiPanelMaxWidth(400)).toBe(320);
    expect(aiPanelMaxWidth(0)).toBe(320);
  });
});

describe('clampAiPanelWidth', () => {
  it('低于最小宽度时夹紧到 320', () => {
    expect(clampAiPanelWidth(300, 1600)).toBe(320);
  });

  it('高于最大宽度时夹紧到 900', () => {
    expect(clampAiPanelWidth(1000, 1600)).toBe(900);
  });

  it('宽窗口下上限为窗口宽度的 70%', () => {
    expect(clampAiPanelWidth(1000, 1000)).toBe(700);
  });

  it('极窄窗口时以最小宽度为准', () => {
    expect(clampAiPanelWidth(1000, 400)).toBe(320);
  });

  it('非有限宽度回退到默认宽度', () => {
    expect(clampAiPanelWidth(Number.NaN, 1600)).toBe(360);
    expect(clampAiPanelWidth(Number.POSITIVE_INFINITY, 1600)).toBe(360);
    expect(clampAiPanelWidth(Number.NEGATIVE_INFINITY, 1600)).toBe(360);
  });

  it('结果四舍五入为整数', () => {
    expect(clampAiPanelWidth(360.6, 1600)).toBe(361);
    expect(clampAiPanelWidth(400.4, 1600)).toBe(400);
  });
});

describe('resizeAiPanelWidth', () => {
  it('指针右移收窄、左移加宽，并夹紧在允许范围内', () => {
    expect(resizeAiPanelWidth(360, 100, 1600)).toBe(320);
    expect(resizeAiPanelWidth(360, -100, 1600)).toBe(460);
    expect(resizeAiPanelWidth(880, -100, 1600)).toBe(900);
  });
});

describe('浮动面板几何', () => {
  it('默认位置靠右上，并完整落在窗口内', () => {
    const bounds = defaultAiFloatingBounds(1440, 900);

    expect(bounds).toEqual({
      x: 1440 - AI_FLOATING_DEFAULT_WIDTH - AI_FLOATING_MARGIN,
      y: 64,
      width: AI_FLOATING_DEFAULT_WIDTH,
      height: AI_FLOATING_DEFAULT_HEIGHT,
    });
  });

  it('窗口较小时缩小默认尺寸但仍保留最小尺寸', () => {
    const bounds = defaultAiFloatingBounds(500, 400);

    expect(bounds.width).toBe(420);
    expect(bounds.height).toBe(368);
    expect(bounds.x).toBe(500 - 420 - AI_FLOATING_MARGIN);
    expect(bounds.y).toBe(AI_FLOATING_MARGIN);
  });

  it('夹紧越界位置和过小/过大的尺寸', () => {
    expect(
      clampAiFloatingBounds({ x: -100, y: -100, width: 100, height: 100 }, 1200, 800),
    ).toEqual({
      x: AI_FLOATING_MARGIN,
      y: AI_FLOATING_MARGIN,
      width: AI_FLOATING_MIN_WIDTH,
      height: AI_FLOATING_MIN_HEIGHT,
    });

    expect(
      clampAiFloatingBounds({ x: 5000, y: 5000, width: 2000, height: 2000 }, 1200, 800),
    ).toEqual({
      x: AI_FLOATING_MARGIN,
      y: AI_FLOATING_MARGIN,
      width: 1200 - AI_FLOATING_MARGIN * 2,
      height: 800 - AI_FLOATING_MARGIN * 2,
    });
  });

  it('拖动只改变位置，尺寸保持不变', () => {
    const start = { x: 700, y: 100, width: 420, height: 500 };

    const moved = moveAiFloatingBounds(start, 100, 50, 1440, 900);
    expect(moved).toEqual({ x: 800, y: 150, width: 420, height: 500 });

    const clamped = moveAiFloatingBounds(start, 1000, 1000, 1440, 900);
    expect(clamped.x).toBe(1440 - 420 - AI_FLOATING_MARGIN);
    expect(clamped.y).toBe(900 - 500 - AI_FLOATING_MARGIN);
    expect(clamped.width).toBe(420);
    expect(clamped.height).toBe(500);
  });

  it('右下角缩放按增量调整宽高，并遵守最小尺寸和窗口边界', () => {
    const start = { x: 700, y: 100, width: 420, height: 500 };

    expect(resizeAiFloatingBounds(start, 100, 50, 1440, 900)).toEqual({
      x: 700,
      y: 100,
      width: 520,
      height: 550,
    });

    const tiny = resizeAiFloatingBounds(start, -500, -500, 1440, 900);
    expect(tiny.width).toBe(AI_FLOATING_MIN_WIDTH);
    expect(tiny.height).toBe(AI_FLOATING_MIN_HEIGHT);
  });
});
