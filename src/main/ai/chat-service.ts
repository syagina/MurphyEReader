import type Database from 'better-sqlite3';
import type { AiSettings, ChatSendRequest } from '@shared/types';
import type { AiClient, AiContentPart, AiMessage } from './client';
import { assembleChatContext } from './context';
import type { AssembleOutput } from './context';
import { appendMessage, getConversation, listMessages } from '../db/conversations';
import { getPaper } from '../db/papers';
import { getPages } from '../db/pages';

export interface ChatDeps {
  db: Database.Database;
  ai: Pick<AiClient, 'streamChat'>;
  getSettings: () => AiSettings;
  emit: (
    channel: 'chat:delta' | 'chat:done' | 'chat:error',
    payload: unknown,
  ) => void;
  newRequestId: () => string;
  now?: () => number;
}

interface PreparedChat {
  conversationId: number;
  messages: AiMessage[];
  model: string | undefined;
  controller: AbortController;
}

/**
 * Abort handles for in-flight chats, keyed by request id. The streaming task
 * removes its entry in `finally`, so aborting a finished (or unknown) request
 * is a no-op.
 */
const activeControllers = new Map<string, AbortController>();

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function buildMessages(
  assembled: AssembleOutput,
  req: ChatSendRequest,
): AiMessage[] {
  const messages: AiMessage[] = [
    { role: 'system', content: assembled.system },
    ...assembled.messages,
  ];

  const images = req.images ?? [];
  if (images.length > 0) {
    const lastIndex = messages.length - 1;
    // The assembled question already carries the volatile per-turn context
    // (current page, selection, retrieved pages); keep it when images turn the
    // last message into a content-part array.
    const lastContent = messages[lastIndex].content;
    const text = typeof lastContent === 'string' ? lastContent : req.question;
    const content: AiContentPart[] = [
      { type: 'text', text },
      ...images.map(
        (url): AiContentPart => ({ type: 'image_url', image_url: { url } }),
      ),
    ];
    messages[lastIndex] = { ...messages[lastIndex], content };
  }

  return messages;
}

function prepareChat(
  deps: ChatDeps,
  req: ChatSendRequest,
  requestId: string,
): PreparedChat | null {
  try {
    const paper = getPaper(deps.db, req.paperId);
    if (paper === null) {
      throw new Error(`Paper not found: ${req.paperId}`);
    }
    // The renderer installs conversations per paper; reject a stale or mixed
    // (paper, conversation) pair before the setup transaction writes anything.
    const conversation = getConversation(deps.db, req.conversationId);
    if (conversation === null || conversation.paperId !== req.paperId) {
      throw new Error('对话不存在或不属于当前文献');
    }
    const pages = getPages(deps.db, paper.id);
    const settings = deps.getSettings();

    // The user message and the context assembly share one transaction so a
    // setup failure leaves neither a user nor an assistant message behind.
    const setup = deps.db.transaction(() => {
      const history = listMessages(deps.db, req.conversationId);
      // A stream-stage failure or abort leaves the unanswered user message as
      // the conversation tail. Retrying the identical question must not append
      // a duplicate row (which would also be replayed as context on later
      // turns), and the trailing question must stay out of the history because
      // the current question is passed to the model separately.
      const selectionText = req.selectionText ?? null;
      const pageNo = req.currentPageNo ?? null;
      const last = history.length > 0 ? history[history.length - 1] : null;
      const isRetry =
        last !== null &&
        last.role === 'user' &&
        last.content === req.question &&
        last.selectionText === selectionText &&
        last.pageNo === pageNo;
      if (!isRetry) {
        appendMessage(deps.db, {
          conversationId: req.conversationId,
          role: 'user',
          content: req.question,
          selectionText: req.selectionText,
          pageNo: req.currentPageNo,
        });
      }
      return assembleChatContext({
        paper,
        pages,
        history: isRetry ? history.slice(0, -1) : history,
        question: req.question,
        selectionText: req.selectionText,
        currentPageNo: req.currentPageNo,
        contextMode: req.contextMode,
        budgetTokens: settings.tokenBudget,
      });
    });
    const assembled = setup();

    const hasImages = req.images !== undefined && req.images.length > 0;
    const controller = new AbortController();
    return {
      conversationId: req.conversationId,
      messages: buildMessages(assembled, req),
      model: hasImages ? settings.visionModel || undefined : undefined,
      controller,
    };
  } catch (error) {
    deps.emit('chat:error', { requestId, error: errorText(error) });
    return null;
  }
}

/**
 * Persists the user message, then streams the answer in the background and
 * emits `chat:delta` / `chat:done` / `chat:error`. The returned promise only
 * covers setup: it resolves with the request id without waiting for the stream.
 */
export function startChat(
  deps: ChatDeps,
  req: ChatSendRequest,
): Promise<{ requestId: string }> {
  const requestId = deps.newRequestId();
  const prepared = prepareChat(deps, req, requestId);
  if (prepared === null) {
    return Promise.resolve({ requestId });
  }

  const { conversationId, messages, model, controller } = prepared;
  activeControllers.set(requestId, controller);

  void (async () => {
    try {
      const content = await deps.ai.streamChat(
        messages,
        (delta) => deps.emit('chat:delta', { requestId, delta }),
        { signal: controller.signal, model },
      );
      const message = appendMessage(deps.db, {
        conversationId,
        role: 'assistant',
        content,
      });
      deps.emit('chat:done', { requestId, message });
    } catch (error) {
      deps.emit('chat:error', { requestId, error: errorText(error) });
    } finally {
      activeControllers.delete(requestId);
    }
  })();

  return Promise.resolve({ requestId });
}

export function abortChat(requestId: string): void {
  activeControllers.get(requestId)?.abort();
}
