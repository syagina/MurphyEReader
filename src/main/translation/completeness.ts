import type { PageText } from '@shared/types';

/** Pages with fewer Latin letters than this are covers, figures or captions. */
const MIN_PAGE_LETTERS = 500;

/**
 * Share of visible characters that must be Latin letters for a page to count as
 * prose. Equation- and table-heavy pages legitimately translate very little and
 * must not trigger the fallback.
 */
const MIN_PROSE_SHARE = 0.6;

/** A page this far below the document's median translation ratio is lossy. */
const MIN_MEDIAN_SHARE = 0.5;

/** Even a document-wide collapse must leave at least this many CJK per letter. */
const MIN_ABSOLUTE_RATIO = 0.02;

/**
 * A page with this many CJK characters per original Latin letter is clearly
 * translated even when it sits below the document median. Bibliography pages
 * keep author names, journal titles and years in Latin, so their ratio is
 * naturally lower than body prose and must not be mistaken for a loss.
 */
const MIN_CLEAR_TRANSLATION_RATIO = 0.5;

/** Mono output that keeps under a tenth of the original characters is unusable. */
const MIN_RETAINED_RATIO = 0.1;

function latinLetterCount(text: string): number {
  let count = 0;
  for (const char of text) {
    if (/[A-Za-z]/.test(char)) {
      count += 1;
    }
  }
  return count;
}

function cjkCount(text: string): number {
  let count = 0;
  for (const char of text) {
    const codePoint = char.codePointAt(0) ?? 0;
    if (
      (codePoint >= 0x3400 && codePoint <= 0x4dbf) ||
      (codePoint >= 0x4e00 && codePoint <= 0x9fff) ||
      (codePoint >= 0xf900 && codePoint <= 0xfaff)
    ) {
      count += 1;
    }
  }
  return count;
}

function visibleLength(text: string): number {
  return text.replace(/\s/g, '').length;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

interface Candidate {
  pageNo: number;
  letters: number;
  visible: number;
}

/**
 * Returns the original page numbers whose Chinese translation is missing.
 *
 * BabelDOC accepts an empty model response as a valid translation: mono output
 * then drops the original paragraph and draws nothing, while dual output keeps
 * the original but leaves the translation column blank. The cache used to store
 * those empty responses, so every later run reproduced the gap.
 *
 * The check compares CJK characters in the output with Latin letters in the
 * original, relative to the document-wide median. That is independent of the
 * provider's translation length and catches a page whose translated share
 * collapsed even though some original text (formulas, citations) remained.
 * Every page is judged, bibliography included, because the whole document is
 * sent to BabelDOC.
 */
export function findIncompletePages(
  originalPages: ReadonlyArray<PageText>,
  translatedPages: ReadonlyArray<PageText>,
): number[] {
  const output = new Map(
    translatedPages.map((page) => [page.pageNo, page.text]),
  );

  const candidates: Candidate[] = [];
  for (const page of originalPages) {
    const letters = latinLetterCount(page.text);
    const visible = visibleLength(page.text);
    if (letters < MIN_PAGE_LETTERS || visible === 0) {
      continue;
    }
    if (letters / visible < MIN_PROSE_SHARE) {
      continue;
    }
    candidates.push({ pageNo: page.pageNo, letters, visible });
  }

  const ratios: number[] = [];
  for (const candidate of candidates) {
    const text = output.get(candidate.pageNo);
    if (text !== undefined) {
      ratios.push(cjkCount(text) / candidate.letters);
    }
  }
  const medianRatio = ratios.length === 0 ? 0 : median(ratios);
  const threshold = Math.max(medianRatio * MIN_MEDIAN_SHARE, MIN_ABSOLUTE_RATIO);

  const incomplete: number[] = [];
  for (const candidate of candidates) {
    const text = output.get(candidate.pageNo);
    if (text === undefined) {
      incomplete.push(candidate.pageNo);
      continue;
    }
    const ratio = cjkCount(text) / candidate.letters;
    if (ratio < threshold && ratio < MIN_CLEAR_TRANSLATION_RATIO) {
      incomplete.push(candidate.pageNo);
      continue;
    }
    if (visibleLength(text) < candidate.visible * MIN_RETAINED_RATIO) {
      incomplete.push(candidate.pageNo);
    }
  }
  return incomplete;
}
