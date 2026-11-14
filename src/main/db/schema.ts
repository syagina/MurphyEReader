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
    ensureFtsObjects(db);
  })();
}
