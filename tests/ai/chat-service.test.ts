import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AiClient, AiMessage } from '@main/ai/client';
import { abortChat, startChat } from '@main/ai/chat-service';
import type { ChatDeps } from '@main/ai/chat-service';
import { openDb } from '@main/db';
import {
  appendMessage,
  createConversation,
  listMessages,
} from '@main/db/conversations';
import { replacePages } from '@main/db/pages';
import { createPaper } from '@main/db/papers';
import type {
  AiSettings,
  ChatMessage,
  ChatSendRequest,
  Paper,
} from '@shared/types';

type ChatChannel = 'chat:delta' | 'chat:done' | 'chat:error';

interface EmittedEvent {
  channel: ChatChannel;
  payload: unknown;
}

function createEventSink(): {
  events: EmittedEvent[];
  emit: (channel: ChatChannel, payload: unknown) => void;
  waitFor: (channel: ChatChannel) => Promise<unknown>;
} {
  const events: EmittedEvent[] = [];
  const watchers: {
    channel: ChatChannel;
    resolve: (payload: unknown) => void;
  }[] = [];

  return {
    events,
    emit(channel, payload): void {
      events.push({ channel, payload });
      const index = watchers.findIndex((watcher) => watcher.channel === channel);
      if (index !== -1) {
        const [watcher] = watchers.splice(index, 1);
        watcher.resolve(payload);
      }
    },
    waitFor(channel): Promise<unknown> {
      return new Promise((resolve) => {
        watchers.push({ channel, resolve });
      });
    },
  };
}

function makeSettings(overrides: Partial<AiSettings> = {}): AiSettings {
  return {
    baseUrl: 'http://127.0.0.1:11434/v1',
    chatModel: 'chat-model',
    visionModel: 'vision-model',
    temperature: 0.3,
    tokenBudget: 100000,
    apiKeySet: true,
    ...overrides,
  };
}

interface StreamCall {
  messages: AiMessage[];
  opts: { signal?: AbortSignal; model?: string } | undefined;
}

let db: Database.Database;
let requestCounter = 0;

beforeEach(() => {
  db = openDb(':memory:');
  requestCounter = 0;
});

afterEach(() => {
  db.close();
});

function setupPaper(
  pages: { pageNo: number; text: string }[] = [{ pageNo: 1, text: '第一页内容' }],
): { paper: Paper; conversationId: number } {
  const paper = createPaper(db, {
    title: '有限元方法综述',
    authors: '张三, 李四',
    year: 2024,
    filePathOriginal: 'C:/papers/fe.pdf',
    filePathTranslated: null,
    pageCountOriginal: pages.length,
    pageCountTranslated: null,
    hasTextLayer: true,
    outline: [],
    folderId: null,
    storageDir: null,
    fileHash: null,
  });
  replacePages(db, paper.id, pages);
  const conversation = createConversation(db, paper.id, '测试会话');
  return { paper, conversationId: conversation.id };
}

function makeRequest(
  paper: Paper,
  conversationId: number,
  overrides: Partial<ChatSendRequest> = {},
): ChatSendRequest {
  return {
    paperId: paper.id,
    conversationId,
    question: '这篇论文讲了什么？',
    fullTextMode: false,
    ...overrides,
  };
}

function makeDeps(
  ai: Pick<AiClient, 'streamChat'>,
  sink: ReturnType<typeof createEventSink>,
  settings: AiSettings = makeSettings(),
): ChatDeps {
  return {
    db,
    ai,
    getSettings: () => settings,
    emit: (channel, payload) => sink.emit(channel, payload),
    newRequestId: () => {
      requestCounter += 1;
      return `req-${requestCounter}`;
    },
  };
}

describe('startChat streaming', () => {
  it('按序 emit delta，完成后保存 assistant 消息并 emit done', async () => {
    const { paper, conversationId } = setupPaper();
    const calls: StreamCall[] = [];
    const ai: Pick<AiClient, 'streamChat'> = {
      async streamChat(messages, onDelta, opts) {
        calls.push({ messages, opts });
        onDelta('你');
        onDelta('好');
        return '你好';
      },
    };
    const sink = createEventSink();
    const deps = makeDeps(ai, sink);
    const donePromise = sink.waitFor('chat:done');

    const result = await startChat(deps, makeRequest(paper, conversationId));
    const donePayload = (await donePromise) as {
      requestId: string;
      message: ChatMessage;
    };

    expect(result.requestId).toBe('req-1');
    expect(sink.events.map((event) => event.channel)).toEqual([
      'chat:delta',
      'chat:delta',
      'chat:done',
    ]);
    expect(sink.events[0].payload).toEqual({
      requestId: 'req-1',
      delta: '你',
    });
    expect(sink.events[1].payload).toEqual({
      requestId: 'req-1',
      delta: '好',
    });
    expect(donePayload.requestId).toBe('req-1');
    expect(donePayload.message).toMatchObject({
      conversationId,
      role: 'assistant',
      content: '你好',
    });

    const rows = listMessages(db, conversationId);
    expect(rows.map((row) => row.role)).toEqual(['user', 'assistant']);
    expect(rows[0].content).toBe('这篇论文讲了什么？');
    expect(rows[1]).toEqual(donePayload.message);

    expect(calls).toHaveLength(1);
    expect(calls[0].opts?.model).toBeUndefined();
    expect(calls[0].opts?.signal?.aborted).toBe(false);
    expect(calls[0].messages[0].role).toBe('system');
  });

  it('不等待流式响应结束即返回 requestId', async () => {
    const { paper, conversationId } = setupPaper();
    let release: (content: string) => void = () => undefined;
    let streamStarted = false;
    const ai: Pick<AiClient, 'streamChat'> = {
      streamChat() {
        streamStarted = true;
        return new Promise<string>((resolve) => {
          release = resolve;
        });
      },
    };
    const sink = createEventSink();
    const deps = makeDeps(ai, sink);
    const donePromise = sink.waitFor('chat:done');

    const result = await startChat(deps, makeRequest(paper, conversationId));

    expect(streamStarted).toBe(true);
    expect(result.requestId).toBe('req-1');
    expect(sink.events).toEqual([]);

    release('迟到的回答');
    const donePayload = (await donePromise) as { message: ChatMessage };
    expect(donePayload.message.content).toBe('迟到的回答');
  });

  it('用追加前的历史组装上下文，问题只出现一次且位于最后', async () => {
    const { paper, conversationId } = setupPaper([
      { pageNo: 1, text: '第一页内容' },
      { pageNo: 2, text: '第二页内容' },
    ]);
    appendMessage(db, {
      conversationId,
      role: 'user',
      content: '上一轮问题',
    });
    appendMessage(db, {
      conversationId,
      role: 'assistant',
      content: '上一轮回答',
    });

    let captured: AiMessage[] = [];
    const ai: Pick<AiClient, 'streamChat'> = {
      async streamChat(messages) {
        captured = messages;
        return '回答';
      },
    };
    const sink = createEventSink();
    const deps = makeDeps(ai, sink);
    const donePromise = sink.waitFor('chat:done');

    const request = makeRequest(paper, conversationId, {
      selectionText: '选中的文本',
      currentPageNo: 2,
    });
    await startChat(deps, request);
    await donePromise;

    expect(captured[0].role).toBe('system');
    expect(String(captured[0].content)).toContain('【文献信息】');
    expect(String(captured[0].content)).toContain('【选中文本】');
    expect(String(captured[0].content)).toContain('选中的文本');
    expect(captured.slice(1)).toEqual([
      { role: 'user', content: '上一轮问题' },
      { role: 'assistant', content: '上一轮回答' },
      { role: 'user', content: '这篇论文讲了什么？' },
    ]);
    expect(
      captured.filter((message) => message.content === '这篇论文讲了什么？'),
    ).toHaveLength(1);
    expect(captured.at(-1)).toEqual({
      role: 'user',
      content: '这篇论文讲了什么？',
    });

    const userRows = listMessages(db, conversationId).filter(
      (row) => row.role === 'user',
    );
    expect(userRows).toHaveLength(2);
    expect(userRows[1]).toMatchObject({
      content: '这篇论文讲了什么？',
      selectionText: '选中的文本',
      pageNo: 2,
    });
  });

  it('带图片时最后一条消息为 text + image_url 并使用视觉模型', async () => {
    const { paper, conversationId } = setupPaper();
    let captured: AiMessage[] = [];
    let capturedOpts: { signal?: AbortSignal; model?: string } | undefined;
    const ai: Pick<AiClient, 'streamChat'> = {
      async streamChat(messages, _onDelta, opts) {
        captured = messages;
        capturedOpts = opts;
        return '看图结果';
      },
    };
    const sink = createEventSink();
    const deps = makeDeps(ai, sink);
    const donePromise = sink.waitFor('chat:done');

    const request = makeRequest(paper, conversationId, {
      fullTextMode: true,
      images: ['data:image/png;base64,AAAA', 'https://example.com/b.png'],
    });
    await startChat(deps, request);
    await donePromise;

    expect(captured.at(-1)).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: '这篇论文讲了什么？' },
        {
          type: 'image_url',
          image_url: { url: 'data:image/png;base64,AAAA' },
        },
        {
          type: 'image_url',
          image_url: { url: 'https://example.com/b.png' },
        },
      ],
    });
    expect(capturedOpts?.model).toBe('vision-model');
    expect(capturedOpts?.signal?.aborted).toBe(false);
  });

  it('流式请求失败时 emit chat:error 且不保存 assistant 消息', async () => {
    const { paper, conversationId } = setupPaper();
    const ai: Pick<AiClient, 'streamChat'> = {
      async streamChat() {
        throw new Error('429 请求过于频繁');
      },
    };
    const sink = createEventSink();
    const deps = makeDeps(ai, sink);
    const errorPromise = sink.waitFor('chat:error');

    const result = await startChat(deps, makeRequest(paper, conversationId));
    const payload = (await errorPromise) as {
      requestId: string;
      error: string;
    };

    expect(payload).toEqual({
      requestId: result.requestId,
      error: '429 请求过于频繁',
    });
    expect(
      sink.events.filter((event) => event.channel === 'chat:done'),
    ).toHaveLength(0);

    const rows = listMessages(db, conversationId);
    expect(rows.map((row) => row.role)).toEqual(['user']);
    expect(rows.filter((row) => row.role === 'assistant')).toHaveLength(0);
  });

  it('流式失败后重发完全相同的问题不重复写入用户消息且历史不含重复问题', async () => {
    const { paper, conversationId } = setupPaper();
    const question = '这篇论文讲了什么？';
    let callCount = 0;
    let retryMessages: AiMessage[] = [];
    const ai: Pick<AiClient, 'streamChat'> = {
      async streamChat(messages) {
        callCount += 1;
        if (callCount === 1) {
          throw new Error('503 服务不可用');
        }
        retryMessages = messages;
        return '重试后的回答';
      },
    };
    const sink = createEventSink();
    const deps = makeDeps(ai, sink);
    const request = makeRequest(paper, conversationId, {
      selectionText: '选中的文本',
      currentPageNo: 1,
    });

    const errorPromise = sink.waitFor('chat:error');
    await startChat(deps, request);
    await errorPromise;
    expect(listMessages(db, conversationId).map((row) => row.role)).toEqual(['user']);

    const donePromise = sink.waitFor('chat:done');
    await startChat(deps, request);
    await donePromise;

    const rows = listMessages(db, conversationId);
    expect(rows.map((row) => row.role)).toEqual(['user', 'assistant']);
    expect(rows.filter((row) => row.role === 'user')).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      content: question,
      selectionText: '选中的文本',
      pageNo: 1,
    });
    expect(rows[1].content).toBe('重试后的回答');

    // The retried question is passed once as the current question and is not
    // replayed from history.
    expect(retryMessages[0].role).toBe('system');
    expect(retryMessages.slice(1)).toEqual([{ role: 'user', content: question }]);
    expect(
      retryMessages.filter((message) => message.content === question),
    ).toHaveLength(1);
    expect(retryMessages.at(-1)).toEqual({ role: 'user', content: question });
  });

  it('内容相同但选文不同的追问仍会追加新的用户消息', async () => {
    const { paper, conversationId } = setupPaper();
    const question = '这篇论文讲了什么？';
    let callCount = 0;
    const ai: Pick<AiClient, 'streamChat'> = {
      async streamChat() {
        callCount += 1;
        if (callCount === 1) {
          throw new Error('429 请求过于频繁');
        }
        return '回答';
      },
    };
    const sink = createEventSink();
    const deps = makeDeps(ai, sink);

    const errorPromise = sink.waitFor('chat:error');
    await startChat(
      deps,
      makeRequest(paper, conversationId, { selectionText: '第一段选文' }),
    );
    await errorPromise;

    const donePromise = sink.waitFor('chat:done');
    await startChat(
      deps,
      makeRequest(paper, conversationId, { selectionText: '第二段选文' }),
    );
    await donePromise;

    const userRows = listMessages(db, conversationId).filter(
      (row) => row.role === 'user',
    );
    expect(userRows.map((row) => row.selectionText)).toEqual([
      '第一段选文',
      '第二段选文',
    ]);
    expect(userRows.map((row) => row.content)).toEqual([question, question]);
  });

  it('不同的追问仍会追加新的用户消息', async () => {
    const { paper, conversationId } = setupPaper();
    let callCount = 0;
    const ai: Pick<AiClient, 'streamChat'> = {
      async streamChat() {
        callCount += 1;
        if (callCount === 1) {
          throw new Error('超时');
        }
        return '回答';
      },
    };
    const sink = createEventSink();
    const deps = makeDeps(ai, sink);

    const errorPromise = sink.waitFor('chat:error');
    await startChat(deps, makeRequest(paper, conversationId));
    await errorPromise;

    const donePromise = sink.waitFor('chat:done');
    await startChat(
      deps,
      makeRequest(paper, conversationId, { question: '另一个追问？' }),
    );
    await donePromise;

    const rows = listMessages(db, conversationId);
    expect(rows.map((row) => row.role)).toEqual(['user', 'user', 'assistant']);
    expect(
      rows.filter((row) => row.role === 'user').map((row) => row.content),
    ).toEqual(['这篇论文讲了什么？', '另一个追问？']);
  });

  it('abortChat 中止流式请求且不保存 assistant 消息', async () => {
    const { paper, conversationId } = setupPaper();
    let capturedSignal: AbortSignal | undefined;
    const ai: Pick<AiClient, 'streamChat'> = {
      streamChat(_messages, _onDelta, opts) {
        capturedSignal = opts?.signal;
        return new Promise<string>((_resolve, reject) => {
          opts?.signal?.addEventListener('abort', () => {
            reject(new Error('已取消'));
          });
        });
      },
    };
    const sink = createEventSink();
    const deps = makeDeps(ai, sink);
    const errorPromise = sink.waitFor('chat:error');

    const result = await startChat(deps, makeRequest(paper, conversationId));
    abortChat(result.requestId);

    expect(capturedSignal?.aborted).toBe(true);
    const payload = (await errorPromise) as { requestId: string; error: string };
    expect(payload).toEqual({
      requestId: result.requestId,
      error: '已取消',
    });
    expect(
      listMessages(db, conversationId).filter(
        (row) => row.role === 'assistant',
      ),
    ).toHaveLength(0);
  });

  it('abortChat 对未知或已完成的 requestId 是空操作', async () => {
    expect(() => abortChat('missing-request')).not.toThrow();

    const { paper, conversationId } = setupPaper();
    const ai: Pick<AiClient, 'streamChat'> = {
      async streamChat() {
        return '完成';
      },
    };
    const sink = createEventSink();
    const deps = makeDeps(ai, sink);
    const donePromise = sink.waitFor('chat:done');

    const result = await startChat(deps, makeRequest(paper, conversationId));
    await donePromise;

    expect(() => abortChat(result.requestId)).not.toThrow();
  });
});

describe('startChat setup errors', () => {
  it('论文不存在时 emit chat:error 且不写入任何消息', async () => {
    const sink = createEventSink();
    const deps = makeDeps(
      { streamChat: async () => '不应调用' },
      sink,
    );
    const errorPromise = sink.waitFor('chat:error');

    const request: ChatSendRequest = {
      paperId: 999,
      conversationId: 1,
      question: '问题',
      fullTextMode: false,
    };
    const result = await startChat(deps, request);
    const payload = (await errorPromise) as {
      requestId: string;
      error: string;
    };

    expect(result).toEqual({ requestId: 'req-1' });
    expect(payload).toEqual({
      requestId: 'req-1',
      error: 'Paper not found: 999',
    });
    expect(listMessages(db, 1)).toEqual([]);
  });

  it('会话属于其他文献时 emit chat:error 且不写入任何消息', async () => {
    const { paper } = setupPaper();
    // A second paper (and its conversation) that the request must not touch.
    const { conversationId: foreignConversationId } = setupPaper();
    let streamCalled = false;
    const sink = createEventSink();
    const deps = makeDeps(
      {
        async streamChat() {
          streamCalled = true;
          return '不应调用';
        },
      },
      sink,
    );
    const errorPromise = sink.waitFor('chat:error');

    const result = await startChat(
      deps,
      makeRequest(paper, foreignConversationId),
    );
    const payload = (await errorPromise) as {
      requestId: string;
      error: string;
    };

    expect(payload).toEqual({
      requestId: result.requestId,
      error: '对话不存在或不属于当前文献',
    });
    expect(streamCalled).toBe(false);
    const count = db
      .prepare('SELECT COUNT(*) AS count FROM messages')
      .get() as { count: number };
    expect(count.count).toBe(0);
  });

  it('会话不存在导致保存用户消息失败时 emit chat:error 且不留下消息', async () => {
    const { paper } = setupPaper();
    const sink = createEventSink();
    const deps = makeDeps(
      { streamChat: async () => '不应调用' },
      sink,
    );
    const errorPromise = sink.waitFor('chat:error');

    const result = await startChat(
      deps,
      makeRequest(paper, 999),
    );
    const payload = (await errorPromise) as {
      requestId: string;
      error: string;
    };

    expect(payload.requestId).toBe(result.requestId);
    expect(typeof payload.error).toBe('string');
    expect(payload.error.length).toBeGreaterThan(0);
    expect(listMessages(db, 999)).toEqual([]);
    const count = db
      .prepare('SELECT COUNT(*) AS count FROM messages')
      .get() as { count: number };
    expect(count.count).toBe(0);
  });
});
