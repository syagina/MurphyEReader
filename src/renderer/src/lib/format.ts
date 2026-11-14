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
