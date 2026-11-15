import type Database from 'better-sqlite3';

export interface Folder {
  id: number;
  name: string;
  createdAt: string;
}

export const FOLDER_NAME_MAX = 40;

interface FolderRow {
  id: number;
  name: string;
  created_at: string;
}

function mapRow(row: FolderRow): Folder {
  return { id: row.id, name: row.name, createdAt: row.created_at };
}

/** Trims the name and collapses internal whitespace runs to one space. */
export function normalizeFolderName(raw: string): string {
  return raw.trim().replace(/\s+/gu, ' ');
}

function requireValidName(raw: string): string {
  const name = normalizeFolderName(raw);
  if (name.length === 0) {
    throw new Error('文件夹名称不能为空');
  }
  if ([...name].length > FOLDER_NAME_MAX) {
    throw new Error(`文件夹名称不能超过 ${FOLDER_NAME_MAX} 个字符`);
  }
  return name;
}

function isUniqueConstraintError(error: unknown): boolean {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    if ((error as { code?: unknown }).code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return true;
    }
  }
  return error instanceof Error && /UNIQUE constraint failed/i.test(error.message);
}

function throwFolderError(error: unknown): never {
  if (isUniqueConstraintError(error)) {
    throw new Error('已有同名文件夹');
  }
  throw error;
}

export function createFolder(
  db: Database.Database,
  name: string,
  now: () => string = () => new Date().toISOString(),
): Folder {
  const normalized = requireValidName(name);
  try {
    const result = db
      .prepare('INSERT INTO folders (name, created_at) VALUES (?, ?)')
      .run(normalized, now());
    const folder = getFolder(db, Number(result.lastInsertRowid));
    if (!folder) {
      throw new Error(`Folder not found after insert: ${result.lastInsertRowid}`);
    }
    return folder;
  } catch (error) {
    throwFolderError(error);
  }
}

export function listFolders(db: Database.Database): Folder[] {
  const rows = db
    .prepare('SELECT * FROM folders ORDER BY created_at ASC, id ASC')
    .all() as FolderRow[];
  return rows.map(mapRow);
}

export function getFolder(db: Database.Database, id: number): Folder | null {
  const row = db.prepare('SELECT * FROM folders WHERE id = ?').get(id) as
    | FolderRow
    | undefined;
  return row ? mapRow(row) : null;
}

export function renameFolder(
  db: Database.Database,
  id: number,
  name: string,
): Folder {
  const normalized = requireValidName(name);
  if (!getFolder(db, id)) {
    throw new Error(`文件夹不存在: ${id}`);
  }
  try {
    db.prepare('UPDATE folders SET name = ? WHERE id = ?').run(normalized, id);
  } catch (error) {
    throwFolderError(error);
  }
  const updated = getFolder(db, id);
  if (!updated) {
    throw new Error(`文件夹不存在: ${id}`);
  }
  return updated;
}

export function removeFolder(db: Database.Database, id: number): void {
  db.prepare('DELETE FROM folders WHERE id = ?').run(id);
}
