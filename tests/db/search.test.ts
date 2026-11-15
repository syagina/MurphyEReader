import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '@main/db';
import { appendMessage, createConversation } from '@main/db/conversations';
import { createNote, deleteNote, updateNote } from '@main/db/notes';
import { replacePages } from '@main/db/pages';
import { createPaper } from '@main/db/papers';
import { searchGlobal } from '@main/db/search';
import type { Paper } from '@shared/types';

const PAPER_TITLE = '有限元方法导论';
const PAGE_TEXT = '有限元空间是一种逼近空间';
const MESSAGE_TEXT = '这个模型需要重新设计';
const NOTE_TEXT = 'finite element approximation';

let tempDir: string;
let db: Database.Database;
let paper: Paper;
let conversationId: number;
let noteId: number;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'paperlens-'));
  db = openDb(join(tempDir, 'paperlens.db'));

  paper = createPaper(db, {
    title: PAPER_TITLE,
    authors: '张三',
    year: 2024,
    filePathOriginal: 'C:/papers/fem.pdf',
    filePathTranslated: null,
    pageCountOriginal: 1,
    pageCountTranslated: null,
    hasTextLayer: true,
    outline: [],
  });

  replacePages(db, paper.id, [{ pageNo: 1, text: PAGE_TEXT }]);

  const conversation = createConversation(db, paper.id, '关于模型的讨论');
  conversationId = conversation.id;
  appendMessage(db, {
    conversationId,
    role: 'user',
    content: MESSAGE_TEXT,
  });

  noteId = createNote(db, {
    paperId: paper.id,
    type: 'concept',
    title: '有限元笔记',
    contentMd: NOTE_TEXT,
    tags: [],
  }).id;
});

afterEach(() => {
  if (db.open) {
    db.close();
  }
  rmSync(tempDir, { recursive: true, force: true });
});

function dropFtsObjects(): void {
  const triggers = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'")
    .all() as { name: string }[];
  for (const trigger of triggers) {
    db.exec(`DROP TRIGGER "${trigger.name}"`);
  }
  for (const table of ['pages_fts', 'messages_fts', 'notes_fts']) {
    db.exec(`DROP TABLE IF EXISTS "${table}"`);
  }
}

describe('searchGlobal', () => {
  it('三字及以上查询经 FTS 命中页面并返回页码与论文标题', () => {
    const results = searchGlobal(db, '有限元空间');

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      kind: 'page',
      paperId: paper.id,
      paperTitle: PAPER_TITLE,
      pageNo: 1,
    });
    expect(results[0].snippet).toContain('有限元空间');
    expect(results[0].conversationId).toBeUndefined();
    expect(results[0].noteId).toBeUndefined();
  });

  it('中文双字查询经 LIKE 兜底命中消息并返回会话 ID', () => {
    const results = searchGlobal(db, '模型');

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      kind: 'message',
      paperId: paper.id,
      paperTitle: PAPER_TITLE,
      conversationId,
    });
    expect(results[0].snippet).toContain('模型');
    expect(results[0].pageNo).toBeUndefined();
    expect(results[0].noteId).toBeUndefined();
  });

  it('英文查询经 FTS 命中笔记并返回笔记 ID', () => {
    const results = searchGlobal(db, 'finite');

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      kind: 'note',
      paperId: paper.id,
      paperTitle: PAPER_TITLE,
      noteId,
    });
    expect(results[0].snippet).toContain('finite');
    expect(results[0].pageNo).toBeUndefined();
    expect(results[0].conversationId).toBeUndefined();
  });

  it('空白查询返回空数组', () => {
    expect(searchGlobal(db, '   ')).toEqual([]);
  });

  it('笔记更新与删除会同步到 FTS 索引', () => {
    updateNote(db, noteId, { contentMd: 'updated approximation theory' });

    expect(searchGlobal(db, 'finite')).toEqual([]);
    const updated = searchGlobal(db, 'theory');
    expect(updated).toHaveLength(1);
    expect(updated[0]).toMatchObject({ kind: 'note', noteId });

    deleteNote(db, noteId);
    expect(searchGlobal(db, 'theory')).toEqual([]);
  });

  it('页面命中占满时仍为消息与笔记保留槽位（FTS）', () => {
    const term = 'commonterm';
    replacePages(
      db,
      paper.id,
      Array.from({ length: 30 }, (_, index) => ({
        pageNo: index + 1,
        text: `${term} 出现在第 ${index + 1} 页`,
      })),
    );
    appendMessage(db, {
      conversationId,
      role: 'user',
      content: `${term} 出现在消息中`,
    });
    updateNote(db, noteId, { contentMd: `${term} 出现在笔记中` });

    const results = searchGlobal(db, term);

    expect(results.length).toBeLessThanOrEqual(20);
    expect(results.filter((result) => result.kind === 'page')).toHaveLength(18);
    expect(results.filter((result) => result.kind === 'message')).toHaveLength(1);
    expect(results.filter((result) => result.kind === 'note')).toHaveLength(1);
    expect(searchGlobal(db, term)).toEqual(results);
  });

  it('页面命中占满时仍为消息与笔记保留槽位（LIKE 兜底）', () => {
    const term = '模型';
    replacePages(
      db,
      paper.id,
      Array.from({ length: 30 }, (_, index) => ({
        pageNo: index + 1,
        text: `模型 出现在第 ${index + 1} 页`,
      })),
    );
    updateNote(db, noteId, { contentMd: '模型 出现在笔记中' });

    const results = searchGlobal(db, term);

    expect(results.length).toBeLessThanOrEqual(20);
    expect(results.filter((result) => result.kind === 'page')).toHaveLength(18);
    expect(results.filter((result) => result.kind === 'message')).toHaveLength(1);
    expect(results.filter((result) => result.kind === 'note')).toHaveLength(1);
    expect(searchGlobal(db, term)).toEqual(results);
  });

  it('LIKE 兜底将通配符按字面量处理', () => {
    replacePages(db, paper.id, [
      { pageNo: 1, text: '百分之百 % 匹配 _ 下划线' },
      { pageNo: 2, text: '普通文本没有符号' },
    ]);

    const percent = searchGlobal(db, '%');
    expect(percent).toHaveLength(1);
    expect(percent[0]).toMatchObject({ kind: 'page', pageNo: 1 });

    const underscore = searchGlobal(db, '_');
    expect(underscore).toHaveLength(1);
    expect(underscore[0]).toMatchObject({ kind: 'page', pageNo: 1 });
  });
});

describe('FTS 补建', () => {
  it('FTS 表与触发器被删除后，重新打开数据库会重建索引并可再次检索', () => {
    dropFtsObjects();
    const remaining = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('pages_fts', 'messages_fts', 'notes_fts')",
      )
      .all();
    expect(remaining).toEqual([]);

    db.close();
    db = openDb(join(tempDir, 'paperlens.db'));

    const results = searchGlobal(db, '有限元空间');
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      kind: 'page',
      paperId: paper.id,
      paperTitle: PAPER_TITLE,
      pageNo: 1,
    });
  });

  it('补建后的触发器继续同步新写入的行', () => {
    dropFtsObjects();
    db.close();
    db = openDb(join(tempDir, 'paperlens.db'));

    replacePages(db, paper.id, [{ pageNo: 2, text: '新的逼近空间分析' }]);

    const results = searchGlobal(db, '逼近空间分析');
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ kind: 'page', pageNo: 2 });
  });
});
