import type Database from 'better-sqlite3';

export const SCHEMA_VERSION = 4;

export const MIGRATION_V1 = `
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

export const MIGRATION_V2 = `
CREATE TABLE IF NOT EXISTS folders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE,
  created_at TEXT NOT NULL
);

ALTER TABLE papers ADD COLUMN folder_id INTEGER REFERENCES folders(id) ON DELETE SET NULL;
ALTER TABLE papers ADD COLUMN file_hash TEXT;
ALTER TABLE papers ADD COLUMN storage_dir TEXT;
CREATE INDEX IF NOT EXISTS idx_papers_folder ON papers(folder_id);
CREATE INDEX IF NOT EXISTS idx_papers_hash ON papers(file_hash);
`;

export const MIGRATION_V3 = `
CREATE TABLE IF NOT EXISTS sticky_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  paper_id INTEGER NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  pdf_version TEXT NOT NULL CHECK (pdf_version IN ('original','translated','bilingual')),
  page_no INTEGER NOT NULL CHECK (page_no >= 1),
  quote TEXT NOT NULL DEFAULT '',
  content_md TEXT NOT NULL DEFAULT '',
  anchor_json TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('manual','translation','ai')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sticky_notes_paper_version_page
  ON sticky_notes(paper_id, pdf_version, page_no);
`;

export const MIGRATION_V4 = `
ALTER TABLE sticky_notes ADD COLUMN kind TEXT NOT NULL DEFAULT 'note';
ALTER TABLE sticky_notes ADD COLUMN mark_style TEXT NOT NULL DEFAULT 'highlight';
ALTER TABLE sticky_notes ADD COLUMN color TEXT;
ALTER TABLE sticky_notes ADD COLUMN pin_json TEXT;
ALTER TABLE sticky_notes ADD COLUMN popup_json TEXT;
ALTER TABLE sticky_notes ADD COLUMN drawing_json TEXT;
`;

interface FtsTable {
  name: string;
  ddl: string;
}

const FTS_TABLES: FtsTable[] = [
  {
    name: 'pages_fts',
    ddl: `CREATE VIRTUAL TABLE IF NOT EXISTS pages_fts USING fts5(
  text, content='pages', tokenize='trigram'
)`,
  },
  {
    name: 'messages_fts',
    ddl: `CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
  content, content='messages', tokenize='trigram'
)`,
  },
  {
    name: 'notes_fts',
    ddl: `CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
  content_md, content='notes', tokenize='trigram'
)`,
  },
];

const FTS_TRIGGERS = `
CREATE TRIGGER IF NOT EXISTS pages_fts_insert AFTER INSERT ON pages BEGIN
  INSERT INTO pages_fts(rowid, text) VALUES (new.rowid, new.text);
END;
CREATE TRIGGER IF NOT EXISTS pages_fts_delete AFTER DELETE ON pages BEGIN
  INSERT INTO pages_fts(pages_fts, rowid, text)
  VALUES ('delete', old.rowid, old.text);
END;
CREATE TRIGGER IF NOT EXISTS pages_fts_update AFTER UPDATE ON pages BEGIN
  INSERT INTO pages_fts(pages_fts, rowid, text)
  VALUES ('delete', old.rowid, old.text);
  INSERT INTO pages_fts(rowid, text) VALUES (new.rowid, new.text);
END;

CREATE TRIGGER IF NOT EXISTS messages_fts_insert AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
END;
CREATE TRIGGER IF NOT EXISTS messages_fts_delete AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, content)
  VALUES ('delete', old.rowid, old.content);
END;
CREATE TRIGGER IF NOT EXISTS messages_fts_update AFTER UPDATE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, content)
  VALUES ('delete', old.rowid, old.content);
  INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
END;

CREATE TRIGGER IF NOT EXISTS notes_fts_insert AFTER INSERT ON notes BEGIN
  INSERT INTO notes_fts(rowid, content_md) VALUES (new.rowid, new.content_md);
END;
CREATE TRIGGER IF NOT EXISTS notes_fts_delete AFTER DELETE ON notes BEGIN
  INSERT INTO notes_fts(notes_fts, rowid, content_md)
  VALUES ('delete', old.rowid, old.content_md);
END;
CREATE TRIGGER IF NOT EXISTS notes_fts_update AFTER UPDATE ON notes BEGIN
  INSERT INTO notes_fts(notes_fts, rowid, content_md)
  VALUES ('delete', old.rowid, old.content_md);
  INSERT INTO notes_fts(rowid, content_md) VALUES (new.rowid, new.content_md);
END;
`;

function tableExists(db: Database.Database, name: string): boolean {
  return (
    db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(name) !== undefined
  );
}

function ensureFtsObjects(db: Database.Database): void {
  for (const table of FTS_TABLES) {
    if (tableExists(db, table.name)) {
      continue;
    }
    db.exec(table.ddl);
    db.exec(`INSERT INTO ${table.name}(${table.name}) VALUES('rebuild')`);
  }
  db.exec(FTS_TRIGGERS);
}

export function migrate(db: Database.Database): void {
  db.transaction(() => {
    const userVersion = db.pragma('user_version', { simple: true }) as number;
    if (userVersion < 1) {
      db.exec(MIGRATION_V1);
    }
    if (userVersion < 2) {
      db.exec(MIGRATION_V2);
      db.pragma('user_version = 2');
    }
    if (userVersion < 3) {
      db.exec(MIGRATION_V3);
      db.pragma('user_version = 3');
    }
    if (userVersion < 4) {
      db.exec(MIGRATION_V4);
      db.pragma('user_version = 4');
    }
    ensureFtsObjects(db);
  })();
}
