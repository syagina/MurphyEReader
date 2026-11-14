import { useEffect, useRef, useState } from 'react';
import type { Paper } from '@shared/types';
import { errorMessage } from '../lib/errors';
import { useChatStore } from '../stores/chat';
import { useReaderStore } from '../stores/reader';
import type { ReaderSelection } from '../stores/reader';
import { MarkdownView } from './MarkdownView';

interface ChatPanelProps {
  paper: Paper;
  /** A pending region screenshot that will be attached to the next send. */
  pendingImage?: string | null;
  /** Called when the image was sent successfully or was removed by the user. */
  onPendingImageConsumed?: () => void;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export function ChatPanel({
  paper,
  pendingImage = null,
  onPendingImageConsumed,
}: ChatPanelProps): React.JSX.Element {
  const paperId = paper.id;
  const conversations = useChatStore((state) => state.conversations);
  const activeConversationId = useChatStore((state) => state.activeConversationId);
  const messages = useChatStore((state) => state.messages);
  const streamingByRequest = useChatStore((state) => state.streamingByRequest);
  const error = useChatStore((state) => state.error);
  const fullTextMode = useChatStore((state) => state.fullTextMode);
  const activeRequestId = useChatStore((state) => state.activeRequestId);
  const lastFailedSendArgs = useChatStore((state) => state.lastFailedSendArgs);
  const focusTrigger = useChatStore((state) => state.focusTrigger);
  const loadForPaper = useChatStore((state) => state.loadForPaper);
  const openConversation = useChatStore((state) => state.openConversation);
  const newConversation = useChatStore((state) => state.newConversation);
  const renameConversation = useChatStore((state) => state.renameConversation);
  const removeConversation = useChatStore((state) => state.removeConversation);
  const send = useChatStore((state) => state.send);
  const retryLast = useChatStore((state) => state.retryLast);
  const abort = useChatStore((state) => state.abort);
  const setFullTextMode = useChatStore((state) => state.setFullTextMode);

  const readerSelection = useReaderStore((state) => state.selection);
  const currentPage = useReaderStore((state) => state.currentPage);

  const [question, setQuestion] = useState('');
  const [selection, setSelection] = useState<ReaderSelection | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState('');
  const [panelError, setPanelError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const messagesRef = useRef<HTMLDivElement | null>(null);

  const streamingText =
    activeRequestId === null ? '' : (streamingByRequest[activeRequestId] ?? '');

  useEffect(() => {
    void loadForPaper(paperId).catch((loadError: unknown) => {
      setPanelError(errorMessage(loadError));
    });
  }, [paperId, loadForPaper]);

  // A new paper starts with a clean composer; the store owns conversation state.
  useEffect(() => {
    setQuestion('');
    setSelection(null);
    setRenaming(false);
    setPanelError(null);
  }, [paperId]);

  // `requestFocus` (bumped by App when 问 AI is clicked) focuses the textarea.
  useEffect(() => {
    if (focusTrigger === 0) {
      return;
    }
    textareaRef.current?.focus();
  }, [focusTrigger]);

  // Selections made in the PDF become the composer's 选文 chip until removed.
  useEffect(() => {
    if (readerSelection !== null) {
      setSelection(readerSelection);
    }
  }, [readerSelection]);

  useEffect(() => {
    const element = messagesRef.current;
    if (element !== null) {
      element.scrollTop = element.scrollHeight;
    }
  }, [messages, streamingText]);

  const runAction = async (action: () => Promise<void>): Promise<void> => {
    setPanelError(null);
    try {
      await action();
    } catch (actionError) {
      setPanelError(errorMessage(actionError));
    }
  };

  const submit = (): void => {
    // Mirror the 发送 button's disabled state so Ctrl/Cmd+Enter cannot start a
    // second request while one is streaming.
    if (activeRequestId !== null) {
      return;
    }
    // A conversation-management error must not mask the chat error that the
    // next failed send reports (or hide its 重发 action).
    setPanelError(null);
    const value = question.trim();
    if (value === '') {
      return;
    }
    const args = {
      paperId,
      question: value,
      pageNo: selection !== null ? selection.pageNo : currentPage,
      ...(selection !== null ? { selectionText: selection.text } : {}),
      ...(pendingImage !== null && pendingImage !== '' ? { images: [pendingImage] } : {}),
    };
    void (async () => {
      await send(args);
      if (useChatStore.getState().error === null) {
        setQuestion('');
        // A failed send keeps the image so 重发 can replay it with the question.
        onPendingImageConsumed?.();
      }
    })();
  };

  const handleRetry = (): void => {
    if (lastFailedSendArgs === null) {
      return;
    }
    void retryLast();
  };

  const handleSelect = (value: string): void => {
    const conversationId = Number(value);
    if (!Number.isInteger(conversationId)) {
      return;
    }
    void runAction(() => openConversation(paperId, conversationId));
  };

  const startRename = (): void => {
    const active = conversations.find(
      (conversation) => conversation.id === activeConversationId,
    );
    if (active === undefined) {
      return;
    }
    setPanelError(null);
    setRenameDraft(active.title);
    setRenaming(true);
  };

  const handleRenameSubmit = (): void => {
    if (activeConversationId === null) {
      return;
    }
    const title = renameDraft.trim();
    if (title === '') {
      setPanelError('对话标题不能为空');
      return;
    }
    void runAction(async () => {
      await renameConversation(activeConversationId, title);
      setRenaming(false);
    });
  };

  const handleDelete = (): void => {
    const active = conversations.find(
      (conversation) => conversation.id === activeConversationId,
    );
    if (active === undefined) {
      return;
    }
    if (!window.confirm(`确定删除对话「${active.title}」？此操作不可恢复。`)) {
      return;
    }
    void runAction(() => removeConversation(active.id));
  };

  return (
    <div className="chat-panel">
      <div className="chat-toolbar">
        <select
          className="chat-select"
          aria-label="选择对话"
          value={activeConversationId === null ? '' : String(activeConversationId)}
          onChange={(event) => handleSelect(event.target.value)}
          disabled={conversations.length === 0}
        >
          {conversations.length === 0 ? (
            <option value="">暂无对话</option>
          ) : (
            conversations.map((conversation) => (
              <option value={conversation.id} key={conversation.id}>
                {conversation.title}
              </option>
            ))
          )}
        </select>
        <button
          type="button"
          className="menu-button"
          onClick={() => void runAction(() => newConversation(paperId))}
        >
          新建
        </button>
        <button
          type="button"
          className="menu-button"
          onClick={startRename}
          disabled={activeConversationId === null}
        >
          重命名
        </button>
        <button
          type="button"
          className="menu-button danger"
          onClick={handleDelete}
          disabled={activeConversationId === null}
        >
          删除
        </button>
      </div>

      {renaming && (
        <form
          className="chat-rename-form"
          onSubmit={(event) => {
            event.preventDefault();
            handleRenameSubmit();
          }}
        >
          <input
            autoFocus
            aria-label="对话标题"
            value={renameDraft}
            onChange={(event) => setRenameDraft(event.target.value)}
          />
          <button type="submit" className="menu-button">
            保存
          </button>
          <button type="button" className="menu-button" onClick={() => setRenaming(false)}>
            取消
          </button>
        </form>
      )}

      {(panelError !== null || error !== null) && (
        <div className="chat-error" role="alert">
          <span>{panelError ?? error}</span>
          {panelError === null && error !== null && lastFailedSendArgs !== null && (
            <button type="button" className="menu-button" onClick={handleRetry}>
              重发
            </button>
          )}
        </div>
      )}

      <div className="chat-messages" ref={messagesRef} aria-live="polite">
        {messages.length === 0 && activeRequestId === null && (
          <p className="empty-state chat-empty">
            {conversations.length === 0
              ? '输入问题开始第一轮对话。'
              : '这个对话还没有消息。'}
          </p>
        )}
        {messages.map((message) => (
          <article className={`chat-message chat-message-${message.role}`} key={message.id}>
            <div className="chat-message-role">
              {message.role === 'user' ? '我' : message.role === 'assistant' ? 'AI' : '系统'}
            </div>
            {message.selectionText !== null && message.selectionText !== '' && (
              <blockquote className="chat-quote">
                {message.pageNo !== null ? `第 ${message.pageNo} 页 · ` : ''}
                {message.selectionText}
              </blockquote>
            )}
            <MarkdownView text={message.content} />
          </article>
        ))}
        {activeRequestId !== null && (
          <article className="chat-message chat-message-assistant chat-message-streaming">
            <div className="chat-message-role">AI</div>
            {streamingText === '' ? (
              <p className="chat-streaming-hint">正在生成…</p>
            ) : (
              <MarkdownView text={streamingText} />
            )}
          </article>
        )}
      </div>

      <div className="chat-composer">
        {selection !== null && (
          <div className="chat-selection-chip">
            <span title={selection.text}>
              第 {selection.pageNo} 页 · {truncate(selection.text, 30)}
            </span>
            <button type="button" aria-label="移除选文" onClick={() => setSelection(null)}>
              ×
            </button>
          </div>
        )}
        {pendingImage !== null && pendingImage !== '' && (
          <div className="chat-image-chip">
            <img className="chat-image-preview" src={pendingImage} alt="待发送的截图" />
            <span className="chat-image-note">截图提问</span>
            <button type="button" aria-label="移除图片" onClick={() => onPendingImageConsumed?.()}>
              移除图片
            </button>
          </div>
        )}
        <textarea
          ref={textareaRef}
          className="chat-input"
          value={question}
          rows={3}
          placeholder={selection !== null ? '就选中文字提问…' : '输入问题，向 AI 提问…'}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              submit();
            }
          }}
        />
        <div className="chat-composer-actions">
          <label className="chat-fulltext">
            <input
              type="checkbox"
              checked={fullTextMode}
              onChange={(event) => setFullTextMode(event.target.checked)}
            />
            全文模式
          </label>
          <div className="chat-actions">
            {activeRequestId !== null && (
              <button type="button" className="chat-stop" onClick={() => void abort()}>
                停止
              </button>
            )}
            <button
              type="button"
              className="primary-button chat-send"
              onClick={submit}
              disabled={activeRequestId !== null || question.trim() === ''}
            >
              发送
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
