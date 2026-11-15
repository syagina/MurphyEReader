export const AI_PANEL_MIN_WIDTH = 320;
export const AI_PANEL_MAX_WIDTH = 900;
export const AI_PANEL_DEFAULT_WIDTH = 360;

export function aiPanelMaxWidth(windowWidth: number): number {
  return Math.max(
    AI_PANEL_MIN_WIDTH,
    Math.min(AI_PANEL_MAX_WIDTH, Math.floor(windowWidth * 0.7)),
  );
}

export function clampAiPanelWidth(width: number, windowWidth: number): number {
  const finite = Number.isFinite(width) ? width : AI_PANEL_DEFAULT_WIDTH;
  return Math.round(
    Math.min(aiPanelMaxWidth(windowWidth), Math.max(AI_PANEL_MIN_WIDTH, finite)),
  );
}
