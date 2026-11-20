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

/** Per-page measurements behind one completeness decision. */
export interface PageCompleteness {
  pageNo: number;
  letters: number;
  /** CJK characters found in the translated output for this page. */
  cjk: number;
  /** CJK characters per original Latin letter (0 when the page is missing). */
  ratio: number;
  /** Visible translated characters divided by visible original characters. */
  retained: number;
  /** The output has no text for this page at all. */
  missing: boolean;
  incomplete: boolean;
}

export interface CompletenessReport {
  medianRatio: number;
  threshold: number;
  /** One entry per original prose page that was judged. */
  pages: PageCompleteness[];
  incompletePages: number[];
}

/**
 * Judges every prose page and keeps the measurements that explain the verdict.
 * `findIncompletePages` is the boolean-only view; the full report is logged
 * when a job refuses to bind so a failure can be diagnosed without guessing.
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
export function inspectCompleteness(
  originalPages: ReadonlyArray<PageText>,
  translatedPages: ReadonlyArray<PageText>,
): CompletenessReport {
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

  const available = candidates.map((candidate) => {
    const text = output.get(candidate.pageNo);
    return {
      candidate,
      text,
      cjk: text === undefined ? 0 : cjkCount(text),
    };
  });
  const ratios = available
    .filter((entry) => entry.text !== undefined)
    .map((entry) => entry.cjk / entry.candidate.letters);
  const medianRatio = ratios.length === 0 ? 0 : median(ratios);
  const threshold = Math.max(medianRatio * MIN_MEDIAN_SHARE, MIN_ABSOLUTE_RATIO);

  const pages: PageCompleteness[] = available.map(({ candidate, text, cjk }) => {
    const ratio = cjk / candidate.letters;
    const retained =
      text === undefined ? 0 : visibleLength(text) / candidate.visible;
    const missing = text === undefined;
    const incomplete =
      missing ||
      (ratio < threshold && ratio < MIN_CLEAR_TRANSLATION_RATIO) ||
      retained < MIN_RETAINED_RATIO;
    return {
      pageNo: candidate.pageNo,
      letters: candidate.letters,
      cjk,
      ratio,
      retained,
      missing,
      incomplete,
    };
  });

  return {
    medianRatio,
    threshold,
    pages,
    incompletePages: pages
      .filter((entry) => entry.incomplete)
      .map((entry) => entry.pageNo),
  };
}

/** Returns the original page numbers whose Chinese translation is missing. */
export function findIncompletePages(
  originalPages: ReadonlyArray<PageText>,
  translatedPages: ReadonlyArray<PageText>,
): number[] {
  return inspectCompleteness(originalPages, translatedPages).incompletePages;
}
