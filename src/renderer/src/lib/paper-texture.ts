import {
  PAPER_TEXTURE_DEFAULT,
  normalizePaperTexture,
} from '@shared/appearance';

export const PAPER_TEXTURE_STORAGE_KEY = 'paperlens-paper-texture';
/** Read by the paper-mode grain rules in styles.css. */
export const PAPER_TEXTURE_CSS_VAR = '--paper-texture-strength';

/** Texture strength cached from the last session, read before settings load. */
export function readStoredPaperTexture(): number {
  try {
    const stored = window.localStorage.getItem(PAPER_TEXTURE_STORAGE_KEY);
    return stored === null
      ? PAPER_TEXTURE_DEFAULT
      : normalizePaperTexture(Number(stored));
  } catch {
    return PAPER_TEXTURE_DEFAULT;
  }
}

/** Applies the grain strength and mirrors it for the next first paint. */
export function applyPaperTexture(value: number): void {
  const normalized = normalizePaperTexture(value);
  document.documentElement.style.setProperty(
    PAPER_TEXTURE_CSS_VAR,
    String(normalized),
  );
  try {
    window.localStorage.setItem(
      PAPER_TEXTURE_STORAGE_KEY,
      String(normalized),
    );
  } catch {
    // Storage can be unavailable; the current page still gets the texture.
  }
}
