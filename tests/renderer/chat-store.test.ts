// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage, ChatSendRequest, Conversation } from '@shared/types';
import { useChatStore } from '@renderer/stores/chat';

interface DeltaEvent {
  requestId: string;
  delta: string;
}

interface DoneEvent {
  requestId: string;
  message: ChatMessage;
}

interface ErrorEvent {
  requestId: string;
  error: string;
}

type Listener<T> = (event: T) => void;

function makeConversation(id: number, overrides: Partial<Conversation> = {}): Conversation {
  return {
    id,
    paperId: 1,
    title: `对话 ${id}`,
    createdAt: 1000 + id,
    ...overrides,
  };
}

function makeMessage(
  id: number,
  conversationId: number,
  overrides: Partial<ChatMessage> = {},
): ChatMessage {
  return {
    id,
    conversationId,
    role: 'assistant',
    content: `回答 ${id}`,
    selectionText: null,
    pageNo: null,
    createdAt: 2000 + id,
    ...overrides,
  };
}

function installApi() {
  const deltaListeners: Listener<DeltaEvent>[] = [];
  const doneListeners: Listener<DoneEvent>[] = [];
  const errorListeners: Listener<ErrorEvent>[] = [];
  const unsubscribed = { delta: 0, done: 0, error: 0 };

  const subscribe = <T,>(listeners: Listener<T>[], listener: Listener<T>, kind: keyof typeof unsubscribed): (() => void) => {
    listeners.push(listener);
    return () => {
      unsubscribed[kind] += 1;
      const index = listeners.indexOf(listener);
      if (index >= 0) {
        listeners.splice(index, 1);
      }
    };
  };

  const conversations = {
    list: vi.fn(async (_paperId: number): Promise<Conversation[]> => []),
    create: vi.fn(
      async (paperId: number, title: string): Promise<Conversation> =>
        makeConversation(10, { paperId, title }),
    ),
    rename: vi.fn(async (_id: number, _title: string): Promise<void> => undefined),
    remove: vi.fn(async (_id: number): Promise<void> => undefined),
  };
  const messages = {
    list: vi.fn(async (_conversationId: number): Promise<ChatMessage[]> => []),
  };
  const chat = {
    send: vi.fn(
      async (_req: ChatSendRequest): Promise<{ requestId: string }> => ({ requestId: 'r1' }),
    ),
    abort: vi.fn(async (_requestId: string): Promise<void> => undefined),
    onDelta: vi.fn((cb: Listener<DeltaEvent>) => subscribe(deltaListeners, cb, 'delta')),
    onDone: vi.fn((cb: Listener<DoneEvent>) => subscribe(doneListeners, cb, 'done')),
    onError: vi.fn((cb: Listener<ErrorEvent>) => subscribe(errorListeners, cb, 'error')),
  };

  (window as unknown as { api: unknown }).api = { conversations, messages, chat };

  const emit = <T,>(listeners: Listener<T>[], event: T): void => {
    for (const listener of [...listeners]) {
      listener(event);
    }
  };

  return {
    conversations,
    messages,
    chat,
    unsubscribed,
    emitDelta: (event: DeltaEvent) => emit(deltaListeners, event),
    emitDone: (event: DoneEvent) => emit(doneListeners, event),
    emitError: (event: ErrorEvent) => emit(errorListeners, event),
  };
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

let api: ReturnType<typeof installApi>;

function resetStore(): void {
  useChatStore.setState({
    paperId: null,
    conversations: [],
    activeConversationId: null,
    messages: [],
    streamingByRequest: {},
    error: null,
    fullTextMode: false,
    activeRequestId: null,
    requestConversation: {},
    lastFailedSendArgs: null,
    focusTrigger: 0,
  });
}

beforeEach(() => {
  resetStore();
  api = installApi();
});

describe('useChatStore.loadForPaper', () => {
  it('加载会话列表并打开最新会话及其消息', async () => {
    const conversations = [makeConversation(1), makeConversation(2, { title: '最新' })];
    const newestMessages = [makeMessage(5, 2, { role: 'user', content: '你好' })];
    api.conversations.list.mockResolvedValue(conversations);
    api.messages.list.mockImplementation(async (conversationId) =>
      conversationId === 2 ? newestMessages : [],
    );

    await useChatStore.getState().loadForPaper(1);

    const state = useChatStore.getState();
    expect(state.paperId).toBe(1);
    expect(state.conversations).toEqual(conversations);
    expect(state.activeConversationId).toBe(2);
    expect(state.messages).toEqual(newestMessages);
    expect(api.messages.list).toHaveBeenCalledWith(2);
  });

  it('会话列表按 createdAt 升序保存并选择最新会话', async () => {
    const conversations = [
      makeConversation(3, { createdAt: 3000 }),
      makeConversation(1, { createdAt: 1000 }),
      makeConversation(2, { createdAt: 2000 }),
    ];
    api.conversations.list.mockResolvedValue(conversations);
    api.messages.list.mockResolvedValue([]);

    await useChatStore.getState().loadForPaper(1);

    const state = useChatStore.getState();
    expect(state.conversations.map((conversation) => conversation.id)).toEqual([1, 2, 3]);
    expect(state.activeConversationId).toBe(3);
  });

  it('没有会话时保持空状态', async () => {
    await useChatStore.getState().loadForPaper(1);

    const state = useChatStore.getState();
    expect(state.activeConversationId).toBeNull();
    expect(state.messages).toEqual([]);
    expect(api.messages.list).not.toHaveBeenCalled();
  });

  it('同一文献重新加载时保留当前会话', async () => {
    const conversations = [makeConversation(1), makeConversation(2)];
    api.conversations.list.mockResolvedValue(conversations);
    useChatStore.setState({
      paperId: 1,
      conversations,
      activeConversationId: 1,
      messages: [],
    });

    await useChatStore.getState().loadForPaper(1);

    expect(useChatStore.getState().activeConversationId).toBe(1);
    expect(api.messages.list).toHaveBeenCalledWith(1);
  });

  it('在途 loadForPaper 不会覆盖显式打开的会话', async () => {
    const conversations = deferred<Conversation[]>();
    api.conversations.list.mockImplementation(() => conversations.promise);
    const targetMessages = [makeMessage(5, 2, { role: 'user', content: '被搜索定位的消息' })];
    api.messages.list.mockImplementation(async (conversationId) =>
      conversationId === 2 ? targetMessages : [],
    );

    // ChatPanel mounts and starts loading before App locates the search hit.
    const loading = useChatStore.getState().loadForPaper(1);
    await useChatStore.getState().openConversation(1, 2);

    conversations.resolve([makeConversation(1), makeConversation(2)]);
    await loading;

    const state = useChatStore.getState();
    expect(state.activeConversationId).toBe(2);
    expect(state.messages).toEqual(targetMessages);
  });

  it('当前会话已不存在时选择最新会话', async () => {
    const conversations = [makeConversation(2), makeConversation(3)];
    api.conversations.list.mockResolvedValue(conversations);
    useChatStore.setState({
      paperId: 1,
      conversations: [makeConversation(1)],
      activeConversationId: 1,
      messages: [],
    });

    await useChatStore.getState().loadForPaper(1);

    expect(useChatStore.getState().activeConversationId).toBe(3);
  });

  it('切换文献时重置视图状态并选择新文献的最新会话', async () => {
    useChatStore.setState({
      paperId: 1,
      conversations: [makeConversation(1)],
      activeConversationId: 1,
      messages: [makeMessage(1, 1)],
      streamingByRequest: { r9: '旧流' },
      error: '旧错误',
      activeRequestId: 'r9',
      lastFailedSendArgs: { paperId: 1, question: '旧问题' },
    });
    const conversations = [makeConversation(7, { paperId: 2 }), makeConversation(8, { paperId: 2 })];
    const newestMessages = [makeMessage(20, 8)];
    api.conversations.list.mockResolvedValue(conversations);
    api.messages.list.mockResolvedValue(newestMessages);

    await useChatStore.getState().loadForPaper(2);

    const state = useChatStore.getState();
    expect(state.paperId).toBe(2);
    expect(state.conversations).toEqual(conversations);
    expect(state.activeConversationId).toBe(8);
    expect(state.messages).toEqual(newestMessages);
    expect(state.streamingByRequest).toEqual({});
    expect(state.error).toBeNull();
    expect(state.activeRequestId).toBeNull();
    expect(state.lastFailedSendArgs).toBeNull();
  });

  it('重复加载时先退订旧事件订阅再订阅', async () => {
    await useChatStore.getState().loadForPaper(1);
    await useChatStore.getState().loadForPaper(1);

    expect(api.unsubscribed).toEqual({ delta: 1, done: 1, error: 1 });
    expect(api.chat.onDelta).toHaveBeenCalledTimes(2);
    expect(api.chat.onDone).toHaveBeenCalledTimes(2);
    expect(api.chat.onError).toHaveBeenCalledTimes(2);
  });
});

describe('useChatStore.send', () => {
  it('没有当前会话时先创建会话（标题取问题前 20 字）再发送', async () => {
    const question = '请解释一下有限元方法的核心思想并举一个具体例子';
    api.conversations.list.mockResolvedValue([]);
    api.chat.send.mockResolvedValue({ requestId: 'r1' });
    await useChatStore.getState().loadForPaper(1);
    useChatStore.getState().setFullTextMode(true);

    await useChatStore.getState().send({
      paperId: 1,
      question: `  ${question}  `,
      selectionText: '单元刚度矩阵',
      pageNo: 3,
    });

    expect(api.conversations.create).toHaveBeenCalledWith(1, question.slice(0, 20));
    expect(api.chat.send).toHaveBeenCalledWith({
      paperId: 1,
      conversationId: 10,
      question,
      selectionText: '单元刚度矩阵',
      currentPageNo: 3,
      fullTextMode: true,
    });
    const state = useChatStore.getState();
    expect(state.conversations[0]).toEqual(
      makeConversation(10, { paperId: 1, title: question.slice(0, 20) }),
    );
    expect(state.activeConversationId).toBe(10);
    expect(state.activeRequestId).toBe('r1');
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]).toMatchObject({
      conversationId: 10,
      role: 'user',
      content: question,
      selectionText: '单元刚度矩阵',
      pageNo: 3,
    });
  });

  it('复用当前会话发送，且只带可选字段', async () => {
    useChatStore.setState({
      paperId: 1,
      conversations: [makeConversation(1)],
      activeConversationId: 1,
      messages: [],
    });
    api.chat.send.mockResolvedValue({ requestId: 'r2' });

    await useChatStore.getState().send({ paperId: 1, question: '第二问' });

    expect(api.conversations.create).not.toHaveBeenCalled();
    expect(api.chat.send).toHaveBeenCalledWith({
      paperId: 1,
      conversationId: 1,
      question: '第二问',
      fullTextMode: false,
    });
    expect(useChatStore.getState().messages).toHaveLength(1);
  });

  it('chat.send 的 IPC 调用失败时移除乐观消息并显示错误', async () => {
    api.conversations.list.mockResolvedValue([makeConversation(1)]);
    api.chat.send.mockRejectedValue(new Error('IPC 失败'));
    await useChatStore.getState().loadForPaper(1);

    await useChatStore.getState().send({ paperId: 1, question: '问题' });

    const state = useChatStore.getState();
    expect(state.messages).toHaveLength(0);
    expect(state.error).toBe('IPC 失败');
    expect(state.activeRequestId).toBeNull();
  });

  it('chat.send IPC 失败后重发会重新显示问题且只显示一次', async () => {
    api.conversations.list.mockResolvedValue([makeConversation(1)]);
    await useChatStore.getState().loadForPaper(1);
    api.chat.send.mockRejectedValueOnce(new Error('IPC 失败'));
    await useChatStore.getState().send({ paperId: 1, question: '问题' });
    expect(useChatStore.getState().messages).toHaveLength(0);

    api.chat.send.mockResolvedValueOnce({ requestId: 'r2' });
    await useChatStore.getState().retryLast();

    const state = useChatStore.getState();
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]).toMatchObject({ role: 'user', content: '问题' });
    expect(state.error).toBeNull();
    expect(state.activeRequestId).toBe('r2');
  });

  it('空白问题不发送', async () => {
    await useChatStore.getState().send({ paperId: 1, question: '   ' });

    expect(api.conversations.create).not.toHaveBeenCalled();
    expect(api.chat.send).not.toHaveBeenCalled();
  });

  it('发送前的错误会被新一次发送清除', async () => {
    useChatStore.setState({ error: '旧错误' });
    useChatStore.setState({
      paperId: 1,
      conversations: [makeConversation(1)],
      activeConversationId: 1,
    });
    api.chat.send.mockResolvedValue({ requestId: 'r3' });

    await useChatStore.getState().send({ paperId: 1, question: '新问题' });

    expect(useChatStore.getState().error).toBeNull();
  });
});

describe('useChatStore 流式事件', () => {
  async function setupConversation(conversationId = 1): Promise<void> {
    api.conversations.list.mockResolvedValue([makeConversation(conversationId)]);
    api.messages.list.mockResolvedValue([]);
    await useChatStore.getState().loadForPaper(1);
  }

  it('delta 按 requestId 累加流式内容', async () => {
    await setupConversation();
    api.chat.send.mockResolvedValue({ requestId: 'r1' });
    await useChatStore.getState().send({ paperId: 1, question: '问题' });

    api.emitDelta({ requestId: 'r1', delta: '甲' });
    api.emitDelta({ requestId: 'r1', delta: '乙' });

    expect(useChatStore.getState().streamingByRequest).toEqual({ r1: '甲乙' });
  });

  it('两个 requestId 的 delta 互不污染', async () => {
    await setupConversation();
    api.chat.send.mockResolvedValueOnce({ requestId: 'r1' });
    await useChatStore.getState().send({ paperId: 1, question: '第一问' });
    api.chat.send.mockResolvedValueOnce({ requestId: 'r2' });
    await useChatStore.getState().send({ paperId: 1, question: '第二问' });

    api.emitDelta({ requestId: 'r1', delta: '甲' });
    api.emitDelta({ requestId: 'r2', delta: '丙' });
    api.emitDelta({ requestId: 'r1', delta: '乙' });

    expect(useChatStore.getState().streamingByRequest).toEqual({ r1: '甲乙', r2: '丙' });
  });

  it('done 清除流式内容并追加助手消息', async () => {
    await setupConversation();
    api.chat.send.mockResolvedValue({ requestId: 'r1' });
    await useChatStore.getState().send({ paperId: 1, question: '问题' });
    api.emitDelta({ requestId: 'r1', delta: '甲' });
    const assistant = makeMessage(33, 1, { content: '完整回答' });

    api.emitDone({ requestId: 'r1', message: assistant });

    const state = useChatStore.getState();
    expect(state.streamingByRequest).toEqual({});
    expect(state.activeRequestId).toBeNull();
    expect(state.messages).toHaveLength(2);
    expect(state.messages[1]).toEqual(assistant);
    expect(state.requestConversation).toEqual({});
  });

  it('后台会话的 done 不写入当前消息列表', async () => {
    api.conversations.list.mockResolvedValue([makeConversation(1), makeConversation(2)]);
    api.messages.list.mockResolvedValue([]);
    await useChatStore.getState().loadForPaper(1);
    useChatStore.setState({ activeConversationId: 1 });
    api.chat.send.mockResolvedValue({ requestId: 'r1' });
    await useChatStore.getState().send({ paperId: 1, question: '问题' });
    await useChatStore.getState().openConversation(1, 2);

    api.emitDone({ requestId: 'r1', message: makeMessage(34, 1) });

    const state = useChatStore.getState();
    expect(state.activeConversationId).toBe(2);
    expect(state.messages).toEqual([]);
    expect(state.streamingByRequest).toEqual({});
  });

  it('error 保存错误文案、清除流式状态且不追加助手消息', async () => {
    await setupConversation();
    api.chat.send.mockResolvedValue({ requestId: 'r1' });
    await useChatStore.getState().send({ paperId: 1, question: '问题' });
    api.emitDelta({ requestId: 'r1', delta: '半截' });

    api.emitError({ requestId: 'r1', error: '余额不足' });

    const state = useChatStore.getState();
    expect(state.error).toBe('余额不足');
    expect(state.streamingByRequest).toEqual({});
    expect(state.activeRequestId).toBeNull();
    // The failed question stays visible exactly once for 重发.
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]).toMatchObject({ role: 'user', content: '问题' });
  });

  it('重发复用原请求载荷且不追加第二条乐观消息', async () => {
    await setupConversation();
    api.chat.send.mockResolvedValueOnce({ requestId: 'r1' });
    await useChatStore.getState().send({
      paperId: 1,
      question: '问题',
      selectionText: '选文',
      pageNo: 2,
    });
    api.emitError({ requestId: 'r1', error: '余额不足' });

    let state = useChatStore.getState();
    expect(state.messages).toHaveLength(1);
    expect(state.lastFailedSendArgs).toMatchObject({
      paperId: 1,
      conversationId: 1,
      question: '问题',
      selectionText: '选文',
      currentPageNo: 2,
      fullTextMode: false,
    });

    api.chat.send.mockResolvedValueOnce({ requestId: 'r2' });
    await useChatStore.getState().retryLast();

    expect(api.chat.send).toHaveBeenCalledTimes(2);
    expect(api.chat.send.mock.calls[1][0]).toEqual(api.chat.send.mock.calls[0][0]);
    state = useChatStore.getState();
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]).toMatchObject({ role: 'user', content: '问题' });
    expect(state.error).toBeNull();
    expect(state.activeRequestId).toBe('r2');
  });

  it('切换会话后不会把旧问题重发到新会话', async () => {
    useChatStore.setState({
      paperId: 1,
      conversations: [makeConversation(1), makeConversation(2)],
      activeConversationId: 2,
      lastFailedSendArgs: {
        paperId: 1,
        conversationId: 1,
        question: '问题',
        fullTextMode: false,
      },
    });

    await useChatStore.getState().retryLast();

    expect(api.chat.send).not.toHaveBeenCalled();
  });

  it('后台会话的 error 只告警，不改当前界面', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    api.conversations.list.mockResolvedValue([makeConversation(1), makeConversation(2)]);
    api.messages.list.mockResolvedValue([]);
    await useChatStore.getState().loadForPaper(1);
    useChatStore.setState({ activeConversationId: 1 });
    api.chat.send.mockResolvedValue({ requestId: 'r1' });
    await useChatStore.getState().send({ paperId: 1, question: '问题' });
    await useChatStore.getState().openConversation(1, 2);

    api.emitError({ requestId: 'r1', error: '后台失败' });

    const state = useChatStore.getState();
    expect(state.error).toBeNull();
    expect(state.activeRequestId).toBeNull();
    expect(state.streamingByRequest).toEqual({});
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('请求 id 尚未返回时到达的 error 不会让界面停在流式状态', async () => {
    await setupConversation();
    api.chat.send.mockImplementation(async () => {
      api.emitError({ requestId: 'early', error: '配置缺失' });
      return { requestId: 'early' };
    });

    await useChatStore.getState().send({ paperId: 1, question: '问题' });

    const state = useChatStore.getState();
    expect(state.error).toBe('配置缺失');
    expect(state.activeRequestId).toBeNull();
    expect(state.streamingByRequest).toEqual({});
  });
});

describe('useChatStore 会话管理', () => {
  it('renameConversation 调用接口并本地更新标题', async () => {
    useChatStore.setState({ conversations: [makeConversation(1), makeConversation(2)] });

    await useChatStore.getState().renameConversation(2, '新标题');

    expect(api.conversations.rename).toHaveBeenCalledWith(2, '新标题');
    expect(useChatStore.getState().conversations[1].title).toBe('新标题');
  });

  it('删除当前会话时切到最近会话并加载其消息', async () => {
    useChatStore.setState({
      paperId: 1,
      conversations: [makeConversation(1), makeConversation(2), makeConversation(3)],
      activeConversationId: 2,
      messages: [makeMessage(1, 2)],
    });
    const nextMessages = [makeMessage(3, 3)];
    api.messages.list.mockResolvedValue(nextMessages);

    await useChatStore.getState().removeConversation(2);

    expect(api.conversations.remove).toHaveBeenCalledWith(2);
    const state = useChatStore.getState();
    expect(state.conversations.map((conversation) => conversation.id)).toEqual([1, 3]);
    expect(state.activeConversationId).toBe(3);
    expect(state.messages).toEqual(nextMessages);
  });

  it('删除最后一个会话后清空当前会话与消息', async () => {
    useChatStore.setState({
      paperId: 1,
      conversations: [makeConversation(1)],
      activeConversationId: 1,
      messages: [makeMessage(1, 1)],
    });

    await useChatStore.getState().removeConversation(1);

    const state = useChatStore.getState();
    expect(state.conversations).toEqual([]);
    expect(state.activeConversationId).toBeNull();
    expect(state.messages).toEqual([]);
    expect(api.messages.list).not.toHaveBeenCalled();
  });

  it('删除非当前会话时保持当前会话与消息', async () => {
    const currentMessages = [makeMessage(1, 1)];
    useChatStore.setState({
      paperId: 1,
      conversations: [makeConversation(1), makeConversation(2)],
      activeConversationId: 1,
      messages: currentMessages,
    });

    await useChatStore.getState().removeConversation(2);

    const state = useChatStore.getState();
    expect(state.activeConversationId).toBe(1);
    expect(state.messages).toEqual(currentMessages);
  });

  it('newConversation 创建并选中新会话', async () => {
    useChatStore.setState({
      paperId: 1,
      conversations: [makeConversation(1)],
      activeConversationId: 1,
      messages: [makeMessage(1, 1)],
    });

    await useChatStore.getState().newConversation(1);

    expect(api.conversations.create).toHaveBeenCalledWith(1, '新对话');
    const state = useChatStore.getState();
    // Newest-last invariant: the new conversation is appended, not prepended.
    expect(state.conversations.map((conversation) => conversation.id)).toEqual([1, 10]);
    expect(state.activeConversationId).toBe(10);
    expect(state.messages).toEqual([]);
  });

  it('openConversation 载入消息并停止展示旧流', async () => {
    api.conversations.list.mockResolvedValue([makeConversation(1), makeConversation(2)]);
    api.messages.list.mockResolvedValue([]);
    await useChatStore.getState().loadForPaper(1);
    useChatStore.setState({ activeConversationId: 1 });
    api.chat.send.mockResolvedValue({ requestId: 'r1' });
    await useChatStore.getState().send({ paperId: 1, question: '问题' });
    expect(useChatStore.getState().activeRequestId).toBe('r1');

    const messages = [makeMessage(9, 2)];
    api.messages.list.mockResolvedValue(messages);

    await useChatStore.getState().openConversation(1, 2);

    expect(api.messages.list).toHaveBeenCalledWith(2);
    const state = useChatStore.getState();
    expect(state.activeConversationId).toBe(2);
    expect(state.messages).toEqual(messages);
    expect(state.activeRequestId).toBeNull();
  });

  it('abort 只中止当前请求，没有请求时不调用接口', async () => {
    await useChatStore.getState().abort();
    expect(api.chat.abort).not.toHaveBeenCalled();

    api.conversations.list.mockResolvedValue([makeConversation(1)]);
    await useChatStore.getState().loadForPaper(1);
    api.chat.send.mockResolvedValue({ requestId: 'r1' });
    await useChatStore.getState().send({ paperId: 1, question: '问题' });

    await useChatStore.getState().abort();

    expect(api.chat.abort).toHaveBeenCalledWith('r1');
  });

  it('requestFocus 递增聚焦计数器', () => {
    useChatStore.getState().requestFocus();
    useChatStore.getState().requestFocus();
    expect(useChatStore.getState().focusTrigger).toBe(2);
  });
});
