/** Paper-texture strength used by the 纸感 appearance mode, as a percentage. */
export const PAPER_TEXTURE_MIN = 0;
export const PAPER_TEXTURE_MAX = 100;
export const PAPER_TEXTURE_DEFAULT = 45;

/** Clamps the stored texture strength to a whole percentage. */
export function normalizePaperTexture(value: number): number {
  const finite = Number.isFinite(value) ? value : PAPER_TEXTURE_DEFAULT;
  return Math.round(
    Math.min(PAPER_TEXTURE_MAX, Math.max(PAPER_TEXTURE_MIN, finite)),
  );
}
