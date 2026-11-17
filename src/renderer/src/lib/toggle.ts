import type { PdfVersion } from '@shared/types';
import { clampPage } from './pdf';

/**
 * Picks the page to show after switching between the original PDF and its
 * translation. When both versions have the same page count the two views are
 * assumed aligned, so the current page carries over; otherwise each version
 * remembers its own last page. Switching between the two translated layouts
 * always carries the current page because they describe the same document.
 */
export function resolveToggleTargetPage(input: {
  from: PdfVersion;
  to: PdfVersion;
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
  const betweenTranslations = input.from !== 'original' && input.to !== 'original';
  if (input.from === input.to || samePageCounts || betweenTranslations) {
    return clampPage(input.currentPage, targetCount);
  }
  const targetLastPage =
    input.to === 'original' ? input.lastPageOriginal : input.lastPageTranslated;
  return clampPage(targetLastPage || 1, targetCount);
}
