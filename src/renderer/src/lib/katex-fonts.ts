/** Font families KaTeX's stylesheet declares, used to make exports wait for glyphs. */
export const KATEX_FONT_FAMILIES = [
  'KaTeX_Main',
  'KaTeX_Math',
  'KaTeX_AMS',
  'KaTeX_Caligraphic',
  'KaTeX_Fraktur',
  'KaTeX_SansSerif',
  'KaTeX_Size1',
  'KaTeX_Size2',
  'KaTeX_Size3',
  'KaTeX_Size4',
  'KaTeX_Typewriter',
] as const;

/** Resolves once every declared KaTeX family has settled (missing ones ignored). */
export async function loadKatexFonts(): Promise<void> {
  await Promise.allSettled(
    KATEX_FONT_FAMILIES.map((family) => document.fonts.load(`16px "${family}"`)),
  );
  await document.fonts.ready;
}

/** Waits for the next paint so called code sees the current layout. */
export function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}
