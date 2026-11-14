import Database from 'better-sqlite3';
import { expect, test } from 'vitest';

test('better-sqlite3 与 FTS5 可在测试运行时加载', () => {
  const db = new Database(':memory:');
  db.exec("CREATE VIRTUAL TABLE t USING fts5(text, tokenize='trigram')");
  db.prepare('INSERT INTO t(text) VALUES (?)').run('有限元空间是一种逼近空间');
  const rows = db.prepare("SELECT text FROM t WHERE t MATCH '\"有限元空间\"'").all();
  expect(rows).toHaveLength(1);
  db.close();
});
