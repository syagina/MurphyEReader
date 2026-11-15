import type Database from 'better-sqlite3';
import type { SearchResult } from '@shared/types';

const SNIPPET_MAX_CHARS = 120;

interface PageMatchRow {
  paperId: number;
  paperTitle: string;
  pageNo: number;
  text: string;
}

interface MessageMatchRow {
  paperId: number;
  paperTitle: string;
  conversationId: number;
  text: string;
}

interface NoteMatchRow {
  paperId: number;
  paperTitle: string;
  noteId: number;
  text: string;
}

const PAGE_FTS_SQL = `
SELECT pages.paper_id AS paperId, papers.title AS paperTitle,
       pages.page_no AS pageNo, pages.text AS text
FROM pages_fts
JOIN pages ON pages.rowid = pages_fts.rowid
JOIN papers ON papers.id = pages.paper_id
WHERE pages_fts MATCH ?
ORDER BY rank
LIMIT ?
`;

const MESSAGE_FTS_SQL = `
SELECT conversations.paper_id AS paperId, papers.title AS paperTitle,
       messages.conversation_id AS conversationId, messages.content AS text
FROM messages_fts
JOIN messages ON messages.rowid = messages_fts.rowid
JOIN conversations ON conversations.id = messages.conversation_id
JOIN papers ON papers.id = conversations.paper_id
WHERE messages_fts MATCH ?
ORDER BY rank
LIMIT ?
`;

const NOTE_FTS_SQL = `
SELECT notes.paper_id AS paperId, papers.title AS paperTitle,
       notes.id AS noteId, notes.content_md AS text
FROM notes_fts
JOIN notes ON notes.rowid = notes_fts.rowid
JOIN papers ON papers.id = notes.paper_id
WHERE notes_fts MATCH ?
ORDER BY rank
LIMIT ?
`;

const PAGE_LIKE_SQL = `
SELECT pages.paper_id AS paperId, papers.title AS paperTitle,
       pages.page_no AS pageNo, pages.text AS text
FROM pages
JOIN papers ON papers.id = pages.paper_id
WHERE pages.text LIKE ? ESCAPE '\\'
ORDER BY pages.rowid DESC
LIMIT ?
`;

const MESSAGE_LIKE_SQL = `
SELECT conversations.paper_id AS paperId, papers.title AS paperTitle,
       messages.conversation_id AS conversationId, messages.content AS text
FROM messages
JOIN conversations ON conversations.id = messages.conversation_id
JOIN papers ON papers.id = conversations.paper_id
WHERE messages.content LIKE ? ESCAPE '\\'
ORDER BY messages.id DESC
LIMIT ?
`;

const NOTE_LIKE_SQL = `
SELECT notes.paper_id AS paperId, papers.title AS paperTitle,
       notes.id AS noteId, notes.content_md AS text
FROM notes
JOIN papers ON papers.id = notes.paper_id
WHERE notes.content_md LIKE ? ESCAPE '\\'
ORDER BY notes.id DESC
LIMIT ?
`;

/**
 * Builds a roughly 120-character excerpt centered on the first
 * case-insensitive occurrence of `query`, marking cut ends with '…'.
 */
function buildSnippet(text: string, query: string): string {
  const index = text.toLowerCase().indexOf(query.toLowerCase());
  if (index < 0) {
    return text.length > SNIPPET_MAX_CHARS
      ? `${text.slice(0, SNIPPET_MAX_CHARS)}…`
      : text;
  }

  const windowSize = Math.max(SNIPPET_MAX_CHARS, query.length);
  const matchEnd = index + query.length;
  let start = Math.max(0, index - Math.floor(windowSize / 2));
  let end = Math.min(text.length, start + windowSize);

  // Near the end of the text, slide the window left so it stays full-sized.
  if (end - start < windowSize) {
    start = Math.max(0, end - windowSize);
  }
  // Never cut the matched query itself, even when it is unusually long.
  if (matchEnd > end) {
    end = Math.min(text.length, matchEnd);
    start = Math.max(0, end - windowSize);
  }

  const prefix = start > 0 ? '…' : '';
  const suffix = end < text.length ? '…' : '';
  return `${prefix}${text.slice(start, end)}${suffix}`;
}

/** Escapes LIKE wildcards so the user query is matched literally. */
function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function toPageResult(row: PageMatchRow, query: string): SearchResult {
  return {
    kind: 'page',
    paperId: row.paperId,
    paperTitle: row.paperTitle,
    snippet: buildSnippet(row.text, query),
    pageNo: row.pageNo,
  };
}

function toMessageResult(row: MessageMatchRow, query: string): SearchResult {
  return {
    kind: 'message',
    paperId: row.paperId,
    paperTitle: row.paperTitle,
    snippet: buildSnippet(row.text, query),
    conversationId: row.conversationId,
  };
}

function toNoteResult(row: NoteMatchRow, query: string): SearchResult {
  return {
    kind: 'note',
    paperId: row.paperId,
    paperTitle: row.paperTitle,
    snippet: buildSnippet(row.text, query),
    noteId: row.noteId,
  };
}

/**
 * Merges the per-kind result lists without letting one kind consume the whole
 * limit. Every non-empty kind is guaranteed one slot first (pages → messages
 * → notes when the limit is smaller than the kind count), then the remaining
 * slots are distributed round-robin over kinds that still have matches. Rank
 * order inside each kind is preserved; empty kinds are ignored.
 */
function mergeKindResults(groups: SearchResult[][], limit: number): SearchResult[] {
  const nonEmpty = groups.filter((group) => group.length > 0);
  if (nonEmpty.length === 0 || limit <= 0) {
    return [];
  }

  const quotas = nonEmpty.map(() => 0);
  let used = 0;
  for (let index = 0; index < nonEmpty.length && used < limit; index += 1) {
    quotas[index] = 1;
    used += 1;
  }

  let distributed = true;
  while (used < limit && distributed) {
    distributed = false;
    for (let index = 0; index < nonEmpty.length && used < limit; index += 1) {
      if (quotas[index] < nonEmpty[index].length) {
        quotas[index] += 1;
        used += 1;
        distributed = true;
      }
    }
  }

  return nonEmpty.flatMap((group, index) => group.slice(0, quotas[index]));
}

function searchWithFts(
  db: Database.Database,
  query: string,
  limit: number,
): SearchResult[] {
  const phrase = `"${query.replace(/"/g, '""')}"`;

  const pages = (
    db.prepare(PAGE_FTS_SQL).all(phrase, limit) as PageMatchRow[]
  ).map((row) => toPageResult(row, query));
  const messages = (
    db.prepare(MESSAGE_FTS_SQL).all(phrase, limit) as MessageMatchRow[]
  ).map((row) => toMessageResult(row, query));
  const notes = (
    db.prepare(NOTE_FTS_SQL).all(phrase, limit) as NoteMatchRow[]
  ).map((row) => toNoteResult(row, query));

  return mergeKindResults([pages, messages, notes], limit);
}

function searchWithLike(
  db: Database.Database,
  query: string,
  limit: number,
): SearchResult[] {
  const pattern = `%${escapeLikePattern(query)}%`;

  const pages = (
    db.prepare(PAGE_LIKE_SQL).all(pattern, limit) as PageMatchRow[]
  ).map((row) => toPageResult(row, query));
  const messages = (
    db.prepare(MESSAGE_LIKE_SQL).all(pattern, limit) as MessageMatchRow[]
  ).map((row) => toMessageResult(row, query));
  const notes = (
    db.prepare(NOTE_LIKE_SQL).all(pattern, limit) as NoteMatchRow[]
  ).map((row) => toNoteResult(row, query));

  return mergeKindResults([pages, messages, notes], limit);
}

export function searchGlobal(
  db: Database.Database,
  query: string,
  limit = 20,
): SearchResult[] {
  const trimmed = query.trim();
  if (trimmed.length === 0 || limit <= 0) {
    return [];
  }

  const results =
    trimmed.length >= 3
      ? searchWithFts(db, trimmed, limit)
      : searchWithLike(db, trimmed, limit);

  return results.slice(0, limit);
}
