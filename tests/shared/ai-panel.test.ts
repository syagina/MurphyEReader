import { describe, expect, it } from 'vitest';
import {
  AI_PANEL_DEFAULT_WIDTH,
  AI_PANEL_MAX_WIDTH,
  AI_PANEL_MIN_WIDTH,
  aiPanelMaxWidth,
  clampAiPanelWidth,
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
