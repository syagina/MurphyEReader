import type Database from 'better-sqlite3';
import type { ChatMessage, ChatRole, Conversation } from '@shared/types';

interface ConversationRow {
  id: number;
  paper_id: number;
  title: string;
  created_at: number;
}

interface MessageRow {
  id: number;
  conversation_id: number;
  role: ChatRole;
  content: string;
  selection_text: string | null;
  page_no: number | null;
  created_at: number;
}

function mapConversationRow(row: ConversationRow): Conversation {
  return {
    id: row.id,
    paperId: row.paper_id,
    title: row.title,
    createdAt: row.created_at,
  };
}

function mapMessageRow(row: MessageRow): ChatMessage {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role,
    content: row.content,
    selectionText: row.selection_text,
    pageNo: row.page_no,
    createdAt: row.created_at,
  };
}

export function createConversation(
  db: Database.Database,
  paperId: number,
  title: string,
): Conversation {
  const result = db
    .prepare(
      'INSERT INTO conversations (paper_id, title, created_at) VALUES (?, ?, ?)',
    )
    .run(paperId, title, Date.now());

  const row = db
    .prepare('SELECT * FROM conversations WHERE id = ?')
    .get(Number(result.lastInsertRowid)) as ConversationRow | undefined;
  if (!row) {
    throw new Error(
      `Conversation not found after insert: ${result.lastInsertRowid}`,
    );
  }
  return mapConversationRow(row);
}

export function listConversations(
  db: Database.Database,
  paperId: number,
): Conversation[] {
  const rows = db
    .prepare(
      'SELECT * FROM conversations WHERE paper_id = ? ORDER BY created_at ASC, id ASC',
    )
    .all(paperId) as ConversationRow[];
  return rows.map(mapConversationRow);
}

export function renameConversation(
  db: Database.Database,
  id: number,
  title: string,
): void {
  db.prepare('UPDATE conversations SET title = ? WHERE id = ?').run(title, id);
}

export function deleteConversation(db: Database.Database, id: number): void {
  db.prepare('DELETE FROM conversations WHERE id = ?').run(id);
}

export function appendMessage(
  db: Database.Database,
  input: {
    conversationId: number;
    role: ChatRole;
    content: string;
    selectionText?: string | null;
    pageNo?: number | null;
  },
): ChatMessage {
  const result = db
    .prepare(
      `INSERT INTO messages (
        conversation_id, role, content, selection_text, page_no, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.conversationId,
      input.role,
      input.content,
      input.selectionText ?? null,
      input.pageNo ?? null,
      Date.now(),
    );

  const row = db
    .prepare('SELECT * FROM messages WHERE id = ?')
    .get(Number(result.lastInsertRowid)) as MessageRow | undefined;
  if (!row) {
    throw new Error(`Message not found after insert: ${result.lastInsertRowid}`);
  }
  return mapMessageRow(row);
}

export function listMessages(
  db: Database.Database,
  conversationId: number,
): ChatMessage[] {
  const rows = db
    .prepare(
      'SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC, id ASC',
    )
    .all(conversationId) as MessageRow[];
  return rows.map(mapMessageRow);
}
