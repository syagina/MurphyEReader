import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '@main/db';
import {
  appendMessage,
  createConversation,
  deleteConversation,
  listConversations,
  listMessages,
  renameConversation,
} from '@main/db/conversations';
import { createPaper } from '@main/db/papers';
import type { Paper } from '@shared/types';

let tempDir: string;
let db: Database.Database;

function createTestDb(): Database.Database {
  tempDir = mkdtempSync(join(tmpdir(), 'paperlens-'));
  return openDb(join(tempDir, 'paperlens.db'));
}

beforeEach(() => {
  db = createTestDb();
});

afterEach(() => {
  db.close();
  rmSync(tempDir, { recursive: true, force: true });
});

function makePaper(title = '测试论文'): Paper {
  return createPaper(db, {
    title,
    authors: '张三',
    year: 2024,
    filePathOriginal: 'C:/papers/test.pdf',
    filePathTranslated: null,
    pageCountOriginal: 10,
    pageCountTranslated: null,
    hasTextLayer: true,
    outline: [],
  });
}

describe('createConversation', () => {
  it('返回完整映射的会话并记录创建时间', () => {
    const paper = makePaper();
    const before = Date.now();
    const conversation = createConversation(db, paper.id, '第一轮对话');
    const after = Date.now();

    expect(conversation).toMatchObject({
      paperId: paper.id,
      title: '第一轮对话',
    });
    expect(conversation.id).toBeGreaterThan(0);
    expect(conversation.createdAt).toBeGreaterThanOrEqual(before);
    expect(conversation.createdAt).toBeLessThanOrEqual(after);
  });
});

describe('listConversations', () => {
  it('按创建顺序列出同一论文的会话', () => {
    const paper = makePaper();
    const first = createConversation(db, paper.id, '第一个会话');
    const second = createConversation(db, paper.id, '第二个会话');

    expect(listConversations(db, paper.id)).toEqual([first, second]);
  });

  it('只返回指定论文的会话且标题允许重复', () => {
    const paperA = makePaper('论文A');
    const paperB = makePaper('论文B');
    const first = createConversation(db, paperA.id, '同名会话');
    const second = createConversation(db, paperA.id, '同名会话');
    createConversation(db, paperB.id, '另一篇论文的会话');

    expect(listConversations(db, paperA.id)).toEqual([first, second]);
    expect(listConversations(db, paperB.id)).toHaveLength(1);
  });

  it('没有会话的论文返回空数组', () => {
    const paper = makePaper();

    expect(listConversations(db, paper.id)).toEqual([]);
  });
});

describe('appendMessage', () => {
  it('消息字段往返一致并被读回', () => {
    const paper = makePaper();
    const conversation = createConversation(db, paper.id, '问答');
    const before = Date.now();
    const message = appendMessage(db, {
      conversationId: conversation.id,
      role: 'user',
      content: '有限元法的基本思想是什么？',
      selectionText: '有限元法是一种数值求解方法',
      pageNo: 3,
    });
    const after = Date.now();

    expect(message).toMatchObject({
      conversationId: conversation.id,
      role: 'user',
      content: '有限元法的基本思想是什么？',
      selectionText: '有限元法是一种数值求解方法',
      pageNo: 3,
    });
    expect(message.id).toBeGreaterThan(0);
    expect(message.createdAt).toBeGreaterThanOrEqual(before);
    expect(message.createdAt).toBeLessThanOrEqual(after);
    expect(listMessages(db, conversation.id)).toEqual([message]);
  });

  it('省略 selectionText 与 pageNo 时返回 null', () => {
    const paper = makePaper();
    const conversation = createConversation(db, paper.id, '问答');

    const message = appendMessage(db, {
      conversationId: conversation.id,
      role: 'assistant',
      content: '它是求解偏微分方程的数值方法。',
    });

    expect(message.selectionText).toBeNull();
    expect(message.pageNo).toBeNull();
  });
});

describe('listMessages', () => {
  it('只返回指定会话的消息并保持创建顺序', () => {
    const paper = makePaper();
    const conversation = createConversation(db, paper.id, '主会话');
    const other = createConversation(db, paper.id, '其他会话');
    const first = appendMessage(db, {
      conversationId: conversation.id,
      role: 'user',
      content: '第一个问题',
    });
    const second = appendMessage(db, {
      conversationId: conversation.id,
      role: 'assistant',
      content: '第一个回答',
    });
    appendMessage(db, {
      conversationId: other.id,
      role: 'user',
      content: '其他会话的问题',
    });

    expect(listMessages(db, conversation.id)).toEqual([first, second]);
  });

  it('没有消息的会话返回空数组', () => {
    const paper = makePaper();
    const conversation = createConversation(db, paper.id, '空会话');

    expect(listMessages(db, conversation.id)).toEqual([]);
  });
});

describe('renameConversation', () => {
  it('重命名后列表中返回新标题', () => {
    const paper = makePaper();
    const conversation = createConversation(db, paper.id, '旧标题');

    renameConversation(db, conversation.id, '新标题');

    expect(listConversations(db, paper.id)).toEqual([
      { ...conversation, title: '新标题' },
    ]);
  });

  it('不存在的 id 不抛错', () => {
    expect(() => renameConversation(db, 999, '任意标题')).not.toThrow();
  });
});

describe('deleteConversation', () => {
  it('级联删除会话及其全部消息', () => {
    const paper = makePaper();
    const conversation = createConversation(db, paper.id, '待删除');
    const keep = createConversation(db, paper.id, '保留');
    appendMessage(db, {
      conversationId: conversation.id,
      role: 'user',
      content: '问题',
    });
    appendMessage(db, {
      conversationId: conversation.id,
      role: 'assistant',
      content: '回答',
    });
    const keptMessage = appendMessage(db, {
      conversationId: keep.id,
      role: 'user',
      content: '保留的问题',
    });

    deleteConversation(db, conversation.id);

    expect(listConversations(db, paper.id)).toEqual([keep]);
    expect(listMessages(db, conversation.id)).toEqual([]);
    expect(listMessages(db, keep.id)).toEqual([keptMessage]);
  });

  it('不存在的 id 不抛错', () => {
    expect(() => deleteConversation(db, 999)).not.toThrow();
  });
});
