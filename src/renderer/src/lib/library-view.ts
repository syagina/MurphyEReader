import type { Paper } from '@shared/types';
import type { FileStatus } from '../stores/library';

export type LibrarySort = 'lastRead' | 'added' | 'title' | 'year';
export type LibraryFilter = 'all' | 'translated' | 'missing' | 'unread';
/** Folder facet selection; `none` is 未分类 and a number is a folder id. */
export type FolderFilter = 'all' | 'none' | number;

export interface LibraryQuery {
  text: string;
  tag: string | null;
  filter: LibraryFilter;
  sort: LibrarySort;
  folderId: FolderFilter;
}

export interface FolderCounts {
  all: number;
  none: number;
  byId: Record<number, number>;
}

export interface LibraryStats {
  total: number;
  unread: number;
  translated: number;
  missing: number;
}

export function isTranslatedBound(paper: Paper): boolean {
  return paper.filePathTranslated !== null && paper.filePathTranslated !== '';
}

export type MissingKind = 'original' | 'translation';

/** Which bound file is gone, or null when every bound file exists. */
export function missingKind(
  paper: Paper,
  status: FileStatus | undefined,
): MissingKind | null {
  if (status === undefined) {
    return null;
  }
  if (!status.originalExists) {
    return 'original';
  }
  return isTranslatedBound(paper) && !status.translatedExists
    ? 'translation'
    : null;
}

/** A paper is missing when a file its metadata points at no longer exists. */
export function isPaperMissing(paper: Paper, status: FileStatus | undefined): boolean {
  return missingKind(paper, status) !== null;
}

/** Reading progress in the original PDF, clamped to 0–100. */
export function readingProgress(paper: Paper): number {
  if (paper.pageCountOriginal <= 0) {
    return 0;
  }
  const ratio = paper.lastPageOriginal / paper.pageCountOriginal;
  return Math.round(Math.min(1, Math.max(0, ratio)) * 100);
}

function matchesText(paper: Paper, query: string): boolean {
  if (query === '') {
    return true;
  }
  return [paper.title, paper.authors, ...paper.tags].some((value) =>
    value.toLocaleLowerCase().includes(query),
  );
}

function matchesFolder(paper: Paper, folderId: FolderFilter): boolean {
  if (folderId === 'all') {
    return true;
  }
  if (folderId === 'none') {
    // Old rows/fixtures may lack the field entirely; treat them as 未分类.
    return paper.folderId === null || paper.folderId === undefined;
  }
  return paper.folderId === folderId;
}

function matchesStatus(
  paper: Paper,
  status: FileStatus | undefined,
  filter: LibraryFilter,
): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'translated':
      return isTranslatedBound(paper);
    case 'missing':
      return isPaperMissing(paper, status);
    case 'unread':
      return paper.lastReadAt === null;
  }
}

function comparePapers(a: Paper, b: Paper, sort: LibrarySort): number {
  switch (sort) {
    case 'title':
      return a.title.localeCompare(b.title, 'zh-CN', { numeric: true });
    case 'year': {
      const ay = a.year ?? -1;
      const by = b.year ?? -1;
      return by - ay || a.title.localeCompare(b.title, 'zh-CN', { numeric: true });
    }
    case 'added':
      return b.addedAt - a.addedAt || b.id - a.id;
    case 'lastRead': {
      const ar = a.lastReadAt ?? -1;
      const br = b.lastReadAt ?? -1;
      return br - ar || b.addedAt - a.addedAt || b.id - a.id;
    }
  }
}

/**
 * Applies the library search, tag, status and folder filters, then sorts a
 * copy. The caller owns the original list; no Paper objects are mutated.
 */
export function filterAndSortPapers(
  papers: Paper[],
  statuses: Record<number, FileStatus>,
  query: LibraryQuery,
): Paper[] {
  const text = query.text.trim().toLocaleLowerCase();
  return papers
    .filter((paper) => {
      if (!matchesText(paper, text)) {
        return false;
      }
      if (query.tag !== null && !paper.tags.includes(query.tag)) {
        return false;
      }
      if (!matchesStatus(paper, statuses[paper.id], query.filter)) {
        return false;
      }
      return matchesFolder(paper, query.folderId);
    })
    .sort((a, b) => comparePapers(a, b, query.sort));
}

/** Unique tags with counts, most used first and alphabetically within a tie. */
export function collectTags(papers: Paper[]): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const paper of papers) {
    for (const tag of paper.tags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'zh-CN'));
}

/** Counts all papers, unclassified papers (null/undefined), and per-folder totals. */
export function countByFolder(papers: Paper[]): FolderCounts {
  const counts: FolderCounts = { all: papers.length, none: 0, byId: {} };
  for (const paper of papers) {
    if (paper.folderId === null || paper.folderId === undefined) {
      counts.none += 1;
    } else {
      counts.byId[paper.folderId] = (counts.byId[paper.folderId] ?? 0) + 1;
    }
  }
  return counts;
}

export function libraryStats(
  papers: Paper[],
  statuses: Record<number, FileStatus>,
): LibraryStats {
  return {
    total: papers.length,
    unread: papers.filter((paper) => paper.lastReadAt === null).length,
    translated: papers.filter((paper) => isTranslatedBound(paper)).length,
    missing: papers.filter((paper) => isPaperMissing(paper, statuses[paper.id])).length,
  };
}
