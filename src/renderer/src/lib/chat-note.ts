import type { ChatMessage } from '@shared/types';

export const AI_NOTE_TAG = 'AI对话';

export type AiNoteKind = 'message' | 'selection';

/** Nearest earlier user question supplies the page the answer belongs to. */
export function findAssistantSourcePage(
  messages: Pick<ChatMessage, 'id' | 'role' | 'pageNo'>[],
  messageId: number,
): number | null {
  const index = messages.findIndex((message) => message.id === messageId);
  if (index < 0) {
    return null;
  }
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const message = messages[cursor];
    if (message !== undefined && message.role === 'user' && message.pageNo !== null) {
      return message.pageNo;
    }
  }
  return null;
}

function firstContentLine(markdown: string): string {
  const line = markdown
    .split('\n')
    .map((value) => value.trim())
    .find((value) => value !== '' && !/^`{3,}/.test(value));
  return line ?? '';
}

/** Derives an editable note title from Markdown answer text. */
export function suggestAiNoteTitle(markdown: string, fallback = 'AI 对话笔记'): string {
  const cleaned = firstContentLine(markdown)
    .replace(/^#{1,6}\s+/, '')
    .replace(/^[-*+]\s+/, '')
    .replace(/^\d+[.)]\s+/, '')
    .replace(/\[p\.(\d+)\]/g, '第$1页')
    .replace(/\$[^$\n]*\$/g, '公式')
    .replace(/\*\*/g, '')
    .replace(/`+/g, '')
    .replace(/\\[a-zA-Z]+/g, '')
    .replace(/[{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned === '') {
    return fallback;
  }
  const clipped = cleaned.length > 28 ? `${cleaned.slice(0, 28)}…` : cleaned;
  return `AI：${clipped}`;
}

function sourceLine(pageNo: number | null): string {
  return pageNo === null
    ? '**来源：** AI 对话'
    : `**来源：** AI 对话 · 第 ${pageNo} 页`;
}

/** Body of a freshly created note. Formula Markdown and citations are kept. */
export function buildNewAiNoteContent(
  markdown: string,
  pageNo: number | null,
  kind: AiNoteKind,
): string {
  const parts = [sourceLine(pageNo), ''];
  if (kind === 'selection') {
    parts.push('**摘录：**', '');
  }
  parts.push(markdown.trim());
  return `${parts.join('\n').trimEnd()}\n`;
}

/**
 * Append block for an existing note. It starts with a heading (never `---`,
 * which this app's Markdown subset renders literally) so consecutive AI
 * captures stay visually separated.
 */
export function buildAiNoteAppendSection(
  markdown: string,
  pageNo: number | null,
  kind: AiNoteKind,
): string {
  const label = kind === 'selection' ? '来自 AI 对话的摘录' : '来自 AI 对话';
  const page = pageNo === null ? '' : ` · 第 ${pageNo} 页`;
  return `## ${label}${page}\n\n${markdown.trim()}\n`;
}

/** Adds the source tag without duplicating one already present. */
export function mergeAiNoteTags(tags: string[]): string[] {
  return tags.includes(AI_NOTE_TAG) ? [...tags] : [...tags, AI_NOTE_TAG];
}

/** Joins an existing note body and a new capture, keeping one blank line. */
export function appendAiNoteContent(
  existing: string,
  markdown: string,
  pageNo: number | null,
  kind: AiNoteKind,
): string {
  const section = buildAiNoteAppendSection(markdown, pageNo, kind);
  const base = existing.trimEnd();
  return base === '' ? `${section}\n` : `${base}\n\n${section}\n`;
}
