import { create } from 'zustand';
import type { ChatMessage, ChatSendRequest, Conversation } from '@shared/types';
import { errorMessage } from '../lib/errors';

export interface ChatSendArgs {
  paperId: number;
  question: string;
  selectionText?: string;
  pageNo?: number;
  images?: string[];
}

export interface ChatState {
  paperId: number | null;
  conversations: Conversation[];
  activeConversationId: number | null;
  messages: ChatMessage[];
  streamingByRequest: Record<string, string>;
  error: string | null;
  fullTextMode: boolean;
  /** Request whose deltas the panel currently shows; background ones keep running. */
  activeRequestId: string | null;
  /** Routes chat events (which only carry a request id) back to their conversation. */
  requestConversation: Record<string, number>;
  /** Full payload of the last send attempt; 重发 re-sends it verbatim. */
  lastFailedSendArgs: ChatSendRequest | null;
  /** Nonce bumped by `requestFocus` so ChatPanel can focus its textarea. */
  focusTrigger: number;
  loadForPaper(paperId: number): Promise<void>;
  openConversation(paperId: number, conversationId: number): Promise<void>;
  newConversation(paperId: number): Promise<void>;
  renameConversation(id: number, title: string): Promise<void>;
  removeConversation(id: number): Promise<void>;
  send(req: ChatSendArgs): Promise<void>;
  /** Re-sends the stored failed request without appending a second optimistic question. */
  retryLast(): Promise<void>;
  abort(): Promise<void>;
  setFullTextMode(v: boolean): void;
  requestFocus(): void;
}

/** Keeps the list in the database's `createdAt ASC, id ASC` order. */
function sortConversations(conversations: Conversation[]): Conversation[] {
  return [...conversations].sort((a, b) => a.createdAt - b.createdAt || a.id - b.id);
}

let unsubscribeEvents: (() => void) | null = null;
let syntheticMessageId = 0;
/** Invalidates in-flight conversation/message loads when the view moves on. */
let viewSeq = 0;
/**
 * `chat:error` can arrive before the `chat:send` reply that reveals the request
 * id (the main process emits it during setup). Buffer those so `send` can
 * surface the failure instead of leaving the panel stuck in a streaming state.
 */
const earlyErrors = new Map<string, string>();
const EARLY_ERROR_LIMIT = 50;

/** Bounded so pathological IPC ordering can never grow the map without limit. */
function bufferEarlyError(requestId: string, error: string): void {
  earlyErrors.set(requestId, error);
  while (earlyErrors.size > EARLY_ERROR_LIMIT) {
    const oldest = earlyErrors.keys().next().value;
    if (oldest === undefined) {
      break;
    }
    earlyErrors.delete(oldest);
  }
}

function handleDelta(requestId: string, delta: string): void {
  useChatStore.setState((state) => ({
    streamingByRequest: {
      ...state.streamingByRequest,
      [requestId]: (state.streamingByRequest[requestId] ?? '') + delta,
    },
  }));
}

function handleDone(requestId: string, message: ChatMessage): void {
  // A late duplicate of an already-consumed buffered error stays bounded.
  earlyErrors.delete(requestId);
  useChatStore.setState((state) => {
    const streamingByRequest = { ...state.streamingByRequest };
    delete streamingByRequest[requestId];
    const requestConversation = { ...state.requestConversation };
    delete requestConversation[requestId];
    return {
      streamingByRequest,
      requestConversation,
      activeRequestId: state.activeRequestId === requestId ? null : state.activeRequestId,
      // The main process persistently appends every answer; only the visible
      // conversation is mirrored locally to avoid leaking background answers.
      messages:
        message.conversationId === state.activeConversationId
          ? [...state.messages, message]
          : state.messages,
    };
  });
}

function handleError(requestId: string, error: string): void {
  const state = useChatStore.getState();
  const conversationId = state.requestConversation[requestId];
  if (conversationId === undefined) {
    bufferEarlyError(requestId, error);
    return;
  }
  useChatStore.setState((current) => {
    const streamingByRequest = { ...current.streamingByRequest };
    delete streamingByRequest[requestId];
    const requestConversation = { ...current.requestConversation };
    delete requestConversation[requestId];
    const activeRequestId =
      current.activeRequestId === requestId ? null : current.activeRequestId;
    if (conversationId === current.activeConversationId) {
      return { streamingByRequest, requestConversation, activeRequestId, error };
    }
    return { streamingByRequest, requestConversation, activeRequestId };
  });
  if (conversationId !== state.activeConversationId) {
    console.warn(`chat request ${requestId} failed: ${error}`);
  }
}

/**
 * Replaces the event subscriptions. R3: `loadForPaper` always unsubscribes the
 * previous set first, so hot reloads and repeated loads cannot double-route
 * deltas.
 */
function ensureSubscriptions(): void {
  if (unsubscribeEvents !== null) {
    unsubscribeEvents();
  }
  const offDelta = window.api.chat.onDelta(({ requestId, delta }) =>
    handleDelta(requestId, delta),
  );
  const offDone = window.api.chat.onDone(({ requestId, message }) =>
    handleDone(requestId, message),
  );
  const offError = window.api.chat.onError(({ requestId, error }) =>
    handleError(requestId, error),
  );
  unsubscribeEvents = () => {
    offDelta();
    offDone();
    offError();
  };
}

export const useChatStore = create<ChatState>()((set, get) => {
  /**
   * Sends an already-resolved request payload. `optimistic` is the user bubble
   * this attempt appended (fresh send or a retry that re-added a removed one);
   * null means the question is already visible and must not be duplicated.
   */
  const dispatch = async (
    payload: ChatSendRequest,
    optimistic: ChatMessage | null,
  ): Promise<void> => {
    set({ error: null });
    const bufferedBefore = new Set(earlyErrors.keys());
    let requestId: string;
    try {
      const response = await window.api.chat.send(payload);
      requestId = response.requestId;
    } catch (error) {
      // A rejected invoke can never consume a buffered early error. Drop
      // entries added while this attempt was in flight so the map stays bounded.
      for (const key of [...earlyErrors.keys()]) {
        if (!bufferedBefore.has(key)) {
          earlyErrors.delete(key);
        }
      }
      if (optimistic !== null) {
        set((state) => ({
          messages: state.messages.filter((message) => message.id !== optimistic.id),
          error: errorMessage(error),
        }));
      } else {
        set({ error: errorMessage(error) });
      }
      return;
    }

    const earlyError = earlyErrors.get(requestId);
    if (earlyError !== undefined) {
      earlyErrors.delete(requestId);
      if (get().activeConversationId === payload.conversationId) {
        set({ error: earlyError });
      } else {
        console.warn(`chat request ${requestId} failed: ${earlyError}`);
      }
      return;
    }

    set((state) => ({
      requestConversation: { ...state.requestConversation, [requestId]: payload.conversationId },
      activeRequestId:
        state.activeConversationId === payload.conversationId ? requestId : state.activeRequestId,
    }));
  };

  return {
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

    async loadForPaper(paperId) {
      ensureSubscriptions();
      const seq = ++viewSeq;
      const previous = get();
      const samePaper = previous.paperId === paperId;
      if (samePaper) {
        set({ paperId, activeRequestId: null });
      } else {
        set({
          paperId,
          conversations: [],
          activeConversationId: null,
          messages: [],
          streamingByRequest: {},
          error: null,
          activeRequestId: null,
          lastFailedSendArgs: null,
        });
      }

      let conversations: Conversation[];
      try {
        conversations = sortConversations(await window.api.conversations.list(paperId));
      } catch (error) {
        if (seq === viewSeq && get().paperId === paperId) {
          set({ error: errorMessage(error) });
        }
        return;
      }
      if (seq !== viewSeq || get().paperId !== paperId) {
        return;
      }

      const previousActive = samePaper ? get().activeConversationId : null;
      const kept =
        previousActive !== null &&
        conversations.some((conversation) => conversation.id === previousActive)
          ? previousActive
          : null;
      const activeConversationId =
        kept ??
        (conversations.length > 0 ? conversations[conversations.length - 1].id : null);
      set({ conversations, activeConversationId });

      if (activeConversationId === null) {
        set({ messages: [] });
        return;
      }
      try {
        const messages = await window.api.messages.list(activeConversationId);
        if (seq === viewSeq && get().activeConversationId === activeConversationId) {
          set({ messages });
        }
      } catch (error) {
        if (seq === viewSeq && get().activeConversationId === activeConversationId) {
          set({ error: errorMessage(error) });
        }
      }
    },

    async openConversation(paperId, conversationId) {
      const seq = ++viewSeq;
      set({
        paperId,
        activeConversationId: conversationId,
        messages: [],
        error: null,
        activeRequestId: null,
        lastFailedSendArgs: null,
      });
      try {
        const messages = await window.api.messages.list(conversationId);
        if (seq === viewSeq && get().activeConversationId === conversationId) {
          set({ messages });
        }
      } catch (error) {
        if (seq === viewSeq && get().activeConversationId === conversationId) {
          set({ error: errorMessage(error) });
        }
      }
    },

    async newConversation(paperId) {
      const conversation = await window.api.conversations.create(paperId, '新对话');
      ++viewSeq;
      set((state) => ({
        paperId,
        conversations: sortConversations([...state.conversations, conversation]),
        activeConversationId: conversation.id,
        messages: [],
        streamingByRequest: {},
        error: null,
        activeRequestId: null,
        lastFailedSendArgs: null,
      }));
    },

    async renameConversation(id, title) {
      await window.api.conversations.rename(id, title);
      set((state) => ({
        conversations: state.conversations.map((conversation) =>
          conversation.id === id ? { ...conversation, title } : conversation,
        ),
      }));
    },

    async removeConversation(id) {
      await window.api.conversations.remove(id);
      const state = get();
      const remaining = sortConversations(
        state.conversations.filter((conversation) => conversation.id !== id),
      );
      if (state.activeConversationId !== id) {
        set({ conversations: remaining });
        return;
      }

      // The list is oldest-first, so the last surviving item is the newest.
      const next = remaining.length > 0 ? remaining[remaining.length - 1] : null;
      const seq = ++viewSeq;
      set({
        conversations: remaining,
        activeConversationId: next?.id ?? null,
        messages: [],
        error: null,
        activeRequestId: null,
        lastFailedSendArgs: null,
      });
      if (next === null) {
        return;
      }
      try {
        const messages = await window.api.messages.list(next.id);
        if (seq === viewSeq && get().activeConversationId === next.id) {
          set({ messages });
        }
      } catch (error) {
        if (seq === viewSeq && get().activeConversationId === next.id) {
          set({ error: errorMessage(error) });
        }
      }
    },

    async send(req) {
      const question = req.question.trim();
      if (question === '') {
        return;
      }
      set({ error: null, lastFailedSendArgs: null });

      let conversationId = get().activeConversationId;
      if (conversationId === null) {
        try {
          const title = question.slice(0, 20) || '新对话';
          const conversation = await window.api.conversations.create(req.paperId, title);
          set((state) => ({
            conversations: sortConversations([...state.conversations, conversation]),
            activeConversationId: conversation.id,
          }));
          conversationId = conversation.id;
        } catch (error) {
          set({ error: errorMessage(error) });
          return;
        }
      }

      const payload: ChatSendRequest = {
        paperId: req.paperId,
        conversationId,
        question,
        fullTextMode: get().fullTextMode,
      };
      if (req.selectionText !== undefined) {
        payload.selectionText = req.selectionText;
      }
      if (req.pageNo !== undefined) {
        payload.currentPageNo = req.pageNo;
      }
      if (req.images !== undefined && req.images.length > 0) {
        payload.images = req.images;
      }
      set({ lastFailedSendArgs: payload });

      syntheticMessageId -= 1;
      const optimistic: ChatMessage = {
        id: syntheticMessageId,
        conversationId,
        role: 'user',
        content: question,
        selectionText: req.selectionText ?? null,
        pageNo: req.pageNo ?? null,
        createdAt: Date.now(),
      };
      set((state) => ({ messages: [...state.messages, optimistic] }));

      await dispatch(payload, optimistic);
    },

    async retryLast() {
      const payload = get().lastFailedSendArgs;
      if (payload === null) {
        return;
      }
      // The error bar is only visible for the active conversation; never
      // replay a failed question into a conversation the user moved away from.
      if (get().activeConversationId !== payload.conversationId) {
        return;
      }
      // A failed chat.send IPC already removed its optimistic bubble. Re-add
      // it so the retried question stays visible exactly once; chat:error
      // retries keep the original bubble and must not add another.
      const visible = get().messages.some(
        (message) =>
          message.role === 'user' &&
          message.content === payload.question &&
          (message.selectionText ?? null) === (payload.selectionText ?? null) &&
          (message.pageNo ?? null) === (payload.currentPageNo ?? null),
      );
      let optimistic: ChatMessage | null = null;
      if (!visible) {
        syntheticMessageId -= 1;
        const message: ChatMessage = {
          id: syntheticMessageId,
          conversationId: payload.conversationId,
          role: 'user',
          content: payload.question,
          selectionText: payload.selectionText ?? null,
          pageNo: payload.currentPageNo ?? null,
          createdAt: Date.now(),
        };
        optimistic = message;
        set((state) => ({ messages: [...state.messages, message] }));
      }
      await dispatch(payload, optimistic);
    },

    async abort() {
      const requestId = get().activeRequestId;
      if (requestId === null) {
        return;
      }
      try {
        await window.api.chat.abort(requestId);
      } catch (error) {
        if (get().activeRequestId !== requestId) {
          return;
        }
        const streamingByRequest = { ...get().streamingByRequest };
        delete streamingByRequest[requestId];
        set({ activeRequestId: null, streamingByRequest, error: errorMessage(error) });
      }
    },

    setFullTextMode(value) {
      set({ fullTextMode: value });
    },

    requestFocus() {
      set((state) => ({ focusTrigger: state.focusTrigger + 1 }));
    },
  };
});
