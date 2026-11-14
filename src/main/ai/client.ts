export interface AiConfig {
  baseUrl: string;
  apiKey: string;
  chatModel: string;
  visionModel: string;
  temperature: number;
}

export type AiContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export interface AiMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | AiContentPart[];
}

interface ChatCompletionChoice {
  delta?: { content?: unknown };
  message?: { content?: unknown };
}

interface ChatCompletionResponse {
  choices?: ChatCompletionChoice[];
}

const API_KEY_INVALID = 'API Key 无效或已过期';
const RATE_LIMITED = '请求过于频繁或额度不足';
const CANCELLED = '已取消';
const MAX_SERVER_MESSAGE_LENGTH = 500;

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

async function errorFromResponse(response: Response): Promise<Error> {
  if (response.status === 401) {
    return new Error(API_KEY_INVALID);
  }
  if (response.status === 429) {
    return new Error(RATE_LIMITED);
  }

  const raw = await response.text().catch(() => '');
  let serverMessage = '';
  try {
    const parsed = JSON.parse(raw) as { error?: { message?: unknown } } | null;
    if (typeof parsed?.error?.message === 'string') {
      serverMessage = parsed.error.message;
    }
  } catch {
    // Not JSON; fall back to the raw body below.
  }
  if (serverMessage === '') {
    serverMessage = raw.slice(0, MAX_SERVER_MESSAGE_LENGTH);
  }
  return new Error(`请求失败（HTTP ${response.status}）：${serverMessage}`);
}

function normalizeError(error: unknown, signal?: AbortSignal): Error {
  if (
    signal?.aborted === true ||
    (typeof error === 'object' &&
      error !== null &&
      (error as { name?: unknown }).name === 'AbortError')
  ) {
    return new Error(CANCELLED);
  }
  return error instanceof Error ? error : new Error(String(error));
}

function extractMessageContent(payload: unknown): string {
  const content = (payload as ChatCompletionResponse | null)?.choices?.[0]?.message?.content;
  return typeof content === 'string' ? content : '';
}

function parseDeltaContent(payload: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return undefined;
  }
  const content = (parsed as ChatCompletionResponse | null)?.choices?.[0]?.delta?.content;
  return typeof content === 'string' ? content : undefined;
}

/**
 * Parses a `text/event-stream` body. Blank lines, `:` comments, non-`data:`
 * fields, role-only deltas and malformed JSON keep-alives are skipped. The
 * reader is cancelled in `finally` so aborted or failed streams release the
 * connection instead of leaking it.
 */
async function readSseStream(
  response: Response,
  onDelta: (delta: string) => void,
): Promise<string> {
  const body = response.body;
  if (body === null) {
    return '';
  }
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result = '';
  let finished = false;

  const handleLine = (line: string): void => {
    if (finished) {
      return;
    }
    const normalized = line.endsWith('\r') ? line.slice(0, -1) : line;
    if (normalized === '' || normalized.startsWith(':')) {
      return;
    }
    if (!normalized.startsWith('data:')) {
      return;
    }
    const payload = normalized.slice('data:'.length).trimStart();
    if (payload === '[DONE]') {
      finished = true;
      return;
    }
    const content = parseDeltaContent(payload);
    if (content !== undefined && content !== '') {
      result += content;
      onDelta(content);
    }
  };

  try {
    while (!finished) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      let newlineIndex = buffer.indexOf('\n');
      while (!finished && newlineIndex !== -1) {
        handleLine(buffer.slice(0, newlineIndex));
        buffer = buffer.slice(newlineIndex + 1);
        newlineIndex = buffer.indexOf('\n');
      }
    }
    if (!finished) {
      buffer += decoder.decode();
      if (buffer !== '') {
        handleLine(buffer);
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }

  return result;
}

export class AiClient {
  constructor(private readonly getConfig: () => AiConfig) {}

  async streamChat(
    messages: AiMessage[],
    onDelta: (delta: string) => void,
    opts: { signal?: AbortSignal; model?: string } = {},
  ): Promise<string> {
    const config = this.getConfig();
    try {
      const response = await this.postChat(config, messages, true, opts.model, opts.signal);
      const contentType = response.headers.get('content-type') ?? '';
      if (contentType.includes('text/event-stream')) {
        return await readSseStream(response, onDelta);
      }
      const content = extractMessageContent(await response.json());
      onDelta(content);
      return content;
    } catch (error) {
      throw normalizeError(error, opts.signal);
    }
  }

  async complete(messages: AiMessage[], opts: { model?: string } = {}): Promise<string> {
    const config = this.getConfig();
    try {
      const response = await this.postChat(config, messages, false, opts.model);
      return extractMessageContent(await response.json());
    } catch (error) {
      throw normalizeError(error);
    }
  }

  async testConnection(): Promise<{ ok: boolean; error?: string }> {
    const config = this.getConfig();
    try {
      const response = await fetch(`${normalizeBaseUrl(config.baseUrl)}/models`, {
        method: 'GET',
        headers: this.authHeaders(config),
      });
      if (!response.ok) {
        throw await errorFromResponse(response);
      }
      if (response.body !== null) {
        await response.body.cancel().catch(() => undefined);
      }
      return { ok: true };
    } catch (error) {
      return { ok: false, error: normalizeError(error).message };
    }
  }

  private async postChat(
    config: AiConfig,
    messages: AiMessage[],
    stream: boolean,
    model: string | undefined,
    signal?: AbortSignal,
  ): Promise<Response> {
    const response = await fetch(`${normalizeBaseUrl(config.baseUrl)}/chat/completions`, {
      method: 'POST',
      headers: this.authHeaders(config),
      body: JSON.stringify({
        model: model ?? config.chatModel,
        messages,
        temperature: config.temperature,
        stream,
      }),
      signal,
    });
    if (!response.ok) {
      throw await errorFromResponse(response);
    }
    return response;
  }

  private authHeaders(config: AiConfig): Record<string, string> {
    return {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    };
  }
}
