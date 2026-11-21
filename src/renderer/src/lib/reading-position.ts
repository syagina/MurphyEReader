import type { Paper, PdfVersion } from '@shared/types';
import { clampPage } from './pdf';

/** A reading position: 1-based page plus the fraction scrolled past its top. */
export interface ReadingPosition {
  page: number;
  offset: number;
}

/** One page's top and height in the reading container's scroll coordinates. */
export interface PageGeometry {
  page: number;
  top: number;
  height: number;
}

/** The largest stored offset; 1 belongs to the next page's top. */
export const MAX_READING_OFFSET = 0.999999;

/** Clamps an intra-page fraction into `[0, MAX_READING_OFFSET]`. */
export function clampOffset(offset: number): number {
  if (!Number.isFinite(offset)) {
    return 0;
  }
  return Math.min(MAX_READING_OFFSET, Math.max(0, offset));
}

/** Clamps a page and offset into a valid position for `pageCount`. */
export function positionAt(
  page: number,
  offset: number,
  pageCount: number,
): ReadingPosition {
  if (pageCount <= 0) {
    return { page: 1, offset: 0 };
  }
  return {
    page: clampPage(page, pageCount),
    offset: clampOffset(offset),
  };
}

/**
 * Maps the reading progress of one layout onto another. Equal page counts
 * return the source position exactly, so floating-point drift can never move
 * the reader when the two layouts share pagination.
 */
export function mapReadingPosition(
  from: ReadingPosition,
  fromPageCount: number,
  toPageCount: number,
): ReadingPosition {
  if (fromPageCount <= 0 || toPageCount <= 0) {
    return { page: 1, offset: 0 };
  }
  const source = positionAt(from.page, from.offset, fromPageCount);
  if (fromPageCount === toPageCount) {
    return source;
  }
  const progress = (source.page - 1 + source.offset) / fromPageCount;
  const raw = Math.min(1, Math.max(0, progress)) * toPageCount;
  const page = Math.min(toPageCount, Math.max(1, Math.floor(raw) + 1));
  return {
    page,
    offset: clampOffset(raw - (page - 1)),
  };
}

/** The page count that describes a version's own layout. */
export function pageCountFor(
  paper: Pick<
    Paper,
    'pageCountOriginal' | 'pageCountTranslated' | 'pageCountBilingual'
  >,
  version: PdfVersion,
): number {
  if (version === 'original') {
    return paper.pageCountOriginal;
  }
  if (version === 'translated') {
    return paper.pageCountTranslated ?? 0;
  }
  return paper.pageCountBilingual ?? paper.pageCountTranslated ?? 0;
}

/**
 * Resolves the page/offset under the reading area's top edge from page
 * geometry built in scroll coordinates. A top edge in the gap between pages
 * belongs to the next page at offset 0.
 */
export function positionFromGeometry(
  geometry: readonly PageGeometry[],
  scrollTop: number,
): ReadingPosition {
  if (geometry.length === 0) {
    return { page: 1, offset: 0 };
  }
  const y = Number.isFinite(scrollTop) ? Math.max(0, scrollTop) : 0;
  let low = 0;
  let high = geometry.length - 1;
  let found = 0;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (geometry[mid].top <= y) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  const entry = geometry[found];
  if (y < entry.top) {
    return { page: entry.page, offset: 0 };
  }
  if (entry.height > 0 && y < entry.top + entry.height) {
    return {
      page: entry.page,
      offset: clampOffset((y - entry.top) / entry.height),
    };
  }
  const next = geometry[found + 1];
  if (next !== undefined) {
    return { page: next.page, offset: 0 };
  }
  return { page: entry.page, offset: MAX_READING_OFFSET };
}
