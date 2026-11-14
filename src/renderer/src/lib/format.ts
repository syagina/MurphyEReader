import type { Paper } from '@shared/types';

/**
 * Builds the secondary line of a library entry: authors and year joined by
 * ` · `, skipping an empty author string or a missing year.
 */
export function formatPaperMeta(paper: Pick<Paper, 'authors' | 'year'>): string {
  const parts: string[] = [];
  const authors = paper.authors.trim();
  if (authors !== '') {
    parts.push(authors);
  }
  if (paper.year !== null) {
    parts.push(String(paper.year));
  }
  return parts.length === 0 ? '未知作者' : parts.join(' · ');
}

/** Formats a millisecond timestamp as `YYYY-MM-DD HH:mm` in local time. */
export function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

/**
 * Splits a comma-separated tag input. Both ASCII and Chinese commas separate
 * tags; surrounding whitespace is trimmed and empty entries are dropped.
 */
export function parseTags(input: string): string[] {
  return input
    .split(/[,，]/)
    .map((tag) => tag.trim())
    .filter((tag) => tag !== '');
}
