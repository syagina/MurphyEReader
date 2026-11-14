import { clampPage } from './pdf';

/**
 * Picks the page to show after switching between the original PDF and its
 * translation. When both versions have the same page count the two views are
 * assumed aligned, so the current page carries over; otherwise each version
 * remembers its own last page.
 */
export function resolveToggleTargetPage(input: {
  from: 'original' | 'translated';
  to: 'original' | 'translated';
  currentPage: number;
  lastPageOriginal: number;
  lastPageTranslated: number;
  pageCountOriginal: number;
  pageCountTranslated: number | null;
}): number {
  const targetCount =
    input.to === 'original' ? input.pageCountOriginal : (input.pageCountTranslated ?? 0);
  const samePageCounts =
    input.pageCountTranslated !== null && input.pageCountTranslated === input.pageCountOriginal;
  if (input.from === input.to || samePageCounts) {
    return clampPage(input.currentPage, targetCount);
  }
  const targetLastPage =
    input.to === 'original' ? input.lastPageOriginal : input.lastPageTranslated;
  return clampPage(targetLastPage || 1, targetCount);
}
