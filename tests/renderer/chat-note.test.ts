import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '@shared/types';
import {
  AI_NOTE_TAG,
  appendAiNoteContent,
  buildAiNoteAppendSection,
  buildNewAiNoteContent,
  findAssistantAnchor,
  findAssistantSourcePage,
  mergeAiNoteTags,
  suggestAiNoteTitle,
} from '@renderer/lib/chat-note';

function makeMessage(
  id: number,
  role: ChatMessage['role'],
  overrides: Partial<ChatMessage> = {},
): ChatMessage {
  return {
    id,
    conversationId: 1,
    role,
    content: `message ${id}`,
    selectionText: null,
    pageNo: null,
    createdAt: id,
    ...overrides,
  };
}

describe('findAssistantSourcePage', () => {
  it('uses the nearest earlier user message page', () => {
    const messages = [
      makeMessage(1, 'user', { pageNo: 3 }),
      makeMessage(2, 'assistant'),
      makeMessage(3, 'user', { pageNo: 7 }),
      makeMessage(4, 'assistant'),
    ];
    expect(findAssistantSourcePage(messages, 4)).toBe(7);
    expect(findAssistantSourcePage(messages, 2)).toBe(3);
  });

  it('returns null when no earlier user message has a page', () => {
    const messages = [
      makeMessage(1, 'user'),
      makeMessage(2, 'assistant'),
      makeMessage(3, 'user', { pageNo: 4 }),
      makeMessage(4, 'assistant'),
    ];
    expect(findAssistantSourcePage(messages, 2)).toBeNull();
    expect(findAssistantSourcePage(messages, 999)).toBeNull();
  });
});

describe('findAssistantAnchor', () => {
  it('returns the nearest earlier question page and its selected text', () => {
    const messages = [
      makeMessage(1, 'user', { pageNo: 3, selectionText: '旧选文' }),
      makeMessage(2, 'assistant'),
      makeMessage(3, 'user', { pageNo: 7, selectionText: '  当前选文  ' }),
      makeMessage(4, 'assistant'),
    ];

    expect(findAssistantAnchor(messages, 4, 9)).toEqual({
      pageNo: 7,
      selectionText: '当前选文',
    });
  });

  it('omits empty selection text and falls back to the question page', () => {
    const messages = [
      makeMessage(1, 'user', { pageNo: 5, selectionText: '   ' }),
      makeMessage(2, 'assistant'),
    ];

    expect(findAssistantAnchor(messages, 2, 9)).toEqual({ pageNo: 5 });
  });

  it('uses the current page when the nearest question has no page or none exists', () => {
    const messages = [
      makeMessage(1, 'user', { pageNo: null, selectionText: '选文' }),
      makeMessage(2, 'assistant'),
      makeMessage(3, 'assistant'),
    ];

    expect(findAssistantAnchor(messages, 2, 6)).toEqual({
      pageNo: 6,
      selectionText: '选文',
    });
    // Consecutive assistants still belong to the same earlier question.
    expect(findAssistantAnchor(messages, 3, 6)).toEqual({
      pageNo: 6,
      selectionText: '选文',
    });
    expect(
      findAssistantAnchor([makeMessage(5, 'assistant')], 5, 2),
    ).toEqual({ pageNo: 2 });
    expect(findAssistantAnchor(messages, 999, 4)).toEqual({ pageNo: 4 });
  });
});

describe('suggestAiNoteTitle', () => {
  it('strips Markdown markers and keeps a readable snippet', () => {
    expect(suggestAiNoteTitle('## **核心结论**：这个方法有效')).toBe(
      'AI：核心结论：这个方法有效',
    );
  });

  it('turns inline math and citations into readable placeholders', () => {
    expect(suggestAiNoteTitle('当 $x^2$ 时见 [p.3]')).toBe('AI：当 公式 时见 第3页');
  });

  it('falls back to a default for empty or fenced-only content', () => {
    expect(suggestAiNoteTitle('')).toBe('AI 对话笔记');
    expect(suggestAiNoteTitle('```\ncode\n```')).toBe('AI：code');
    expect(suggestAiNoteTitle('---', '自定义')).toBe('AI：---');
  });
});

describe('AI note content builders', () => {
  it('keeps the whole answer Markdown and records its source page', () => {
    const content = buildNewAiNoteContent('## 方法\n\n公式 $x$', 4, 'message');

    expect(content).toContain('**来源：** AI 对话 · 第 4 页');
    expect(content).toContain('## 方法');
    expect(content).toContain('公式 $x$');
    expect(content).not.toContain('**摘录：**');
  });

  it('marks selected fragments explicitly', () => {
    const content = buildNewAiNoteContent('选中的一句', null, 'selection');

    expect(content).toContain('**来源：** AI 对话');
    expect(content).toContain('**摘录：**');
    expect(content).toContain('选中的一句');
  });

  it('appends an AI section without using unsupported horizontal rules', () => {
    const content = appendAiNoteContent('原有内容', '新回答', 9, 'message');

    expect(content).toContain('原有内容\n\n## 来自 AI 对话 · 第 9 页');
    expect(content).toContain('新回答');
    expect(content).not.toContain('\n---\n');
  });

  it('an empty note appends without leading blank lines', () => {
    const content = appendAiNoteContent('  ', '摘录', null, 'selection');

    expect(content.startsWith('## 来自 AI 对话的摘录\n\n摘录')).toBe(true);
  });

  it('builds a heading with or without a page number', () => {
    expect(buildAiNoteAppendSection('正文', 2, 'selection')).toContain(
      '## 来自 AI 对话的摘录 · 第 2 页',
    );
    expect(buildAiNoteAppendSection('正文', null, 'message')).toContain(
      '## 来自 AI 对话\n',
    );
  });
});

describe('mergeAiNoteTags', () => {
  it('adds the AI tag once', () => {
    expect(mergeAiNoteTags(['方法'])).toEqual(['方法', AI_NOTE_TAG]);
    expect(mergeAiNoteTags(['方法', AI_NOTE_TAG])).toEqual(['方法', AI_NOTE_TAG]);
  });
});
