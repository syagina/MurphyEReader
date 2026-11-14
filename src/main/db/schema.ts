import type Database from 'better-sqlite3';

export const SCHEMA_VERSION = 1;

const MIGRATION_V1 = `
CREATE TABLE papers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL, authors TEXT NOT NULL DEFAULT '', year INTEGER,
  file_path_original TEXT NOT NULL, file_path_translated TEXT,
  page_count_original INTEGER NOT NULL, page_count_translated INTEGER,
  has_text_layer INTEGER NOT NULL DEFAULT 1,
  outline_json TEXT NOT NULL DEFAULT '[]',
  tags_json TEXT NOT NULL DEFAULT '[]',
  last_page_original INTEGER NOT NULL DEFAULT 1,
  last_page_translated INTEGER NOT NULL DEFAULT 1,
  added_at INTEGER NOT NULL, last_read_at INTEGER
);
CREATE TABLE pages (
  paper_id INTEGER NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  page_no INTEGER NOT NULL, text TEXT NOT NULL,
  PRIMARY KEY (paper_id, page_no)
);
CREATE TABLE conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  paper_id INTEGER NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  title TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user','assistant','system')),
  content TEXT NOT NULL, selection_text TEXT, page_no INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  paper_id INTEGER NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('concept','summary','manual','idea')),
  title TEXT NOT NULL, content_md TEXT NOT NULL,
  tags_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
PRAGMA user_version = 1;
`;

export function migrate(db: Database.Database): void {
  const userVersion = db.pragma('user_version', { simple: true }) as number;
  if (userVersion < 1) {
    db.exec(MIGRATION_V1);
  }
}
