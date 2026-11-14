import type Database from 'better-sqlite3';
import type { Note, NoteType } from '@shared/types';

export interface NewNoteInput {
  paperId: number;
  type: NoteType;
  title: string;
  contentMd: string;
  tags: string[];
}

const ORDER_BY = 'ORDER BY updated_at DESC, id DESC';

const PATCH_COLUMNS = {
  title: 'title',
  contentMd: 'content_md',
  tags: 'tags_json',
} as const;

type PatchKey = keyof typeof PATCH_COLUMNS;

interface NoteRow {
  id: number;
  paper_id: number;
  type: NoteType;
  title: string;
  content_md: string;
  tags_json: string;
  created_at: number;
  updated_at: number;
}

function mapRow(row: NoteRow): Note {
  return {
    id: row.id,
    paperId: row.paper_id,
    type: row.type,
    title: row.title,
    contentMd: row.content_md,
    tags: JSON.parse(row.tags_json) as string[],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createNote(db: Database.Database, input: NewNoteInput): Note {
  const now = Date.now();
  const result = db
    .prepare(
      `INSERT INTO notes (
        paper_id, type, title, content_md, tags_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.paperId,
      input.type,
      input.title,
      input.contentMd,
      JSON.stringify(input.tags),
      now,
      now,
    );

  const id = Number(result.lastInsertRowid);
  const note = getNote(db, id);
  if (!note) {
    throw new Error(`Note not found after insert: ${id}`);
  }
  return note;
}

export function listNotes(db: Database.Database, paperId?: number): Note[] {
  const rows = (
    paperId === undefined
      ? db.prepare(`SELECT * FROM notes ${ORDER_BY}`).all()
      : db
          .prepare(`SELECT * FROM notes WHERE paper_id = ? ${ORDER_BY}`)
          .all(paperId)
  ) as NoteRow[];
  return rows.map(mapRow);
}

export function getNote(db: Database.Database, id: number): Note | null {
  const row = db.prepare('SELECT * FROM notes WHERE id = ?').get(id) as
    | NoteRow
    | undefined;
  return row ? mapRow(row) : null;
}

export function updateNote(
  db: Database.Database,
  id: number,
  patch: { title?: string; contentMd?: string; tags?: string[] },
): Note {
  const current = getNote(db, id);
  if (!current) {
    throw new Error(`Note not found: ${id}`);
  }

  const assignments: string[] = [];
  const params: (string | number)[] = [];

  for (const key of Object.keys(PATCH_COLUMNS) as PatchKey[]) {
    const value = patch[key];
    if (value === undefined) {
      continue;
    }
    assignments.push(`${PATCH_COLUMNS[key]} = ?`);
    params.push(key === 'tags' ? JSON.stringify(value) : (value as string));
  }

  assignments.push('updated_at = ?');
  params.push(Date.now());

  db.prepare(`UPDATE notes SET ${assignments.join(', ')} WHERE id = ?`).run(
    ...params,
    id,
  );

  const updated = getNote(db, id);
  if (!updated) {
    throw new Error(`Note not found: ${id}`);
  }
  return updated;
}

export function deleteNote(db: Database.Database, id: number): void {
  db.prepare('DELETE FROM notes WHERE id = ?').run(id);
}

export function listNotesByType(
  db: Database.Database,
  type: NoteType,
): Note[] {
  const rows = db
    .prepare(`SELECT * FROM notes WHERE type = ? ${ORDER_BY}`)
    .all(type) as NoteRow[];
  return rows.map(mapRow);
}
