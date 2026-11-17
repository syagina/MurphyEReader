import type Database from 'better-sqlite3';
import type { OutlineNode, Paper, PdfVersion } from '@shared/types';

export interface NewPaperInput {
  title: string;
  authors: string;
  year: number | null;
  filePathOriginal: string;
  filePathTranslated: string | null;
  pageCountOriginal: number;
  pageCountTranslated: number | null;
  hasTextLayer: boolean;
  outline: OutlineNode[];
  folderId: number | null;
  storageDir: string | null;
  fileHash: string | null;
}

const PATCH_COLUMNS = {
  title: 'title',
  authors: 'authors',
  year: 'year',
  tags: 'tags_json',
  lastPageOriginal: 'last_page_original',
  lastPageTranslated: 'last_page_translated',
  filePathOriginal: 'file_path_original',
  pageCountOriginal: 'page_count_original',
  filePathTranslated: 'file_path_translated',
  pageCountTranslated: 'page_count_translated',
  outline: 'outline_json',
  hasTextLayer: 'has_text_layer',
  folderId: 'folder_id',
  storageDir: 'storage_dir',
  fileHash: 'file_hash',
} as const;

type PatchKey = keyof typeof PATCH_COLUMNS;

interface PaperRow {
  id: number;
  title: string;
  authors: string;
  year: number | null;
  file_path_original: string;
  file_path_translated: string | null;
  page_count_original: number;
  page_count_translated: number | null;
  has_text_layer: number;
  outline_json: string;
  tags_json: string;
  last_page_original: number;
  last_page_translated: number;
  added_at: number;
  last_read_at: number | null;
  folder_id: number | null;
  storage_dir: string | null;
  file_hash: string | null;
}

function mapRow(row: PaperRow): Paper {
  return {
    id: row.id,
    title: row.title,
    authors: row.authors,
    year: row.year,
    filePathOriginal: row.file_path_original,
    filePathTranslated: row.file_path_translated,
    pageCountOriginal: row.page_count_original,
    pageCountTranslated: row.page_count_translated,
    hasTextLayer: row.has_text_layer === 1,
    outline: JSON.parse(row.outline_json) as OutlineNode[],
    tags: JSON.parse(row.tags_json) as string[],
    folderId: row.folder_id,
    storageDir: row.storage_dir,
    fileHash: row.file_hash,
    lastPageOriginal: row.last_page_original,
    lastPageTranslated: row.last_page_translated,
    addedAt: row.added_at,
    lastReadAt: row.last_read_at,
  };
}

export function createPaper(db: Database.Database, input: NewPaperInput): Paper {
  const result = db
    .prepare(
      `INSERT INTO papers (
        title, authors, year, file_path_original, file_path_translated,
        page_count_original, page_count_translated, has_text_layer,
        outline_json, folder_id, storage_dir, file_hash, added_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.title,
      input.authors,
      input.year,
      input.filePathOriginal,
      input.filePathTranslated,
      input.pageCountOriginal,
      input.pageCountTranslated,
      input.hasTextLayer ? 1 : 0,
      JSON.stringify(input.outline),
      input.folderId,
      input.storageDir,
      input.fileHash,
      Date.now(),
    );

  const id = Number(result.lastInsertRowid);
  const paper = getPaper(db, id);
  if (!paper) {
    throw new Error(`Paper not found after insert: ${id}`);
  }
  return paper;
}

export function listPapers(db: Database.Database): Paper[] {
  const rows = db
    .prepare('SELECT * FROM papers ORDER BY added_at DESC, id DESC')
    .all() as PaperRow[];
  return rows.map(mapRow);
}

export function getPaper(db: Database.Database, id: number): Paper | null {
  const row = db.prepare('SELECT * FROM papers WHERE id = ?').get(id) as
    | PaperRow
    | undefined;
  return row ? mapRow(row) : null;
}

export function findPaperByHash(
  db: Database.Database,
  hash: string,
  excludeId?: number,
): Paper | null {
  const row = db
    .prepare(
      'SELECT * FROM papers WHERE file_hash = ? AND id != ? ORDER BY id LIMIT 1',
    )
    .get(hash, excludeId ?? -1) as PaperRow | undefined;
  return row ? mapRow(row) : null;
}

export function updatePaper(
  db: Database.Database,
  id: number,
  patch: Partial<
    Pick<
      Paper,
      | 'title'
      | 'authors'
      | 'year'
      | 'tags'
      | 'lastPageOriginal'
      | 'lastPageTranslated'
      | 'filePathOriginal'
      | 'pageCountOriginal'
      | 'filePathTranslated'
      | 'pageCountTranslated'
      | 'outline'
      | 'hasTextLayer'
      | 'folderId'
      | 'storageDir'
      | 'fileHash'
    >
  >,
): Paper {
  const current = getPaper(db, id);
  if (!current) {
    throw new Error(`Paper not found: ${id}`);
  }

  const assignments: string[] = [];
  const params: (string | number | null)[] = [];

  for (const key of Object.keys(PATCH_COLUMNS) as PatchKey[]) {
    const value = patch[key];
    if (value === undefined) {
      continue;
    }
    assignments.push(`${PATCH_COLUMNS[key]} = ?`);
    if (key === 'tags' || key === 'outline') {
      params.push(JSON.stringify(value));
    } else if (key === 'hasTextLayer') {
      params.push(value ? 1 : 0);
    } else {
      params.push(value as string | number | null);
    }
  }

  if (assignments.length === 0) {
    return current;
  }

  db.prepare(`UPDATE papers SET ${assignments.join(', ')} WHERE id = ?`).run(
    ...params,
    id,
  );

  const updated = getPaper(db, id);
  if (!updated) {
    throw new Error(`Paper not found: ${id}`);
  }
  return updated;
}

export function deletePaper(db: Database.Database, id: number): void {
  db.prepare('DELETE FROM papers WHERE id = ?').run(id);
}

export function markRead(
  db: Database.Database,
  id: number,
  version: PdfVersion,
  pageNo: number,
): void {
  // Both translated layouts share one reading position; only the original
  // keeps a separate page.
  const column =
    version === 'original' ? 'last_page_original' : 'last_page_translated';
  db.prepare(
    `UPDATE papers SET ${column} = ?, last_read_at = ? WHERE id = ?`,
  ).run(pageNo, Date.now(), id);
}
