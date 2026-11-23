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
const TIMEOUT = '请求超时';
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_SPEED_TEST_TIMEOUT_MS = 15_000;
const SPEED_TEST_PROMPT = 'ping';
const SPEED_TEST_MAX_TOKENS = 1;
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

function errorName(error: unknown): unknown {
  return typeof error === 'object' && error !== null
    ? (error as { name?: unknown }).name
    : undefined;
}

/**
 * Settles with `promise`, but rejects as soon as `signal` aborts. The original
 * promise keeps its rejection handled so a late transport failure never
 * surfaces as an unhandled rejection.
 */
function raceSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    promise.catch(() => undefined);
    return Promise.reject(signal.reason);
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      reject(signal.reason);
    };
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

function normalizeError(
  error: unknown,
  callerSignal?: AbortSignal,
  timeoutSignal?: AbortSignal,
): Error {
  const name = errorName(error);
  if (name === 'TimeoutError') {
    return new Error(TIMEOUT);
  }
  if (callerSignal?.aborted === true) {
    return new Error(CANCELLED);
  }
  if (timeoutSignal?.aborted === true) {
    return new Error(TIMEOUT);
  }
  if (name === 'AbortError') {
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
  signal?: AbortSignal,
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
      const { done, value } =
        signal === undefined
          ? await reader.read()
          : await raceSignal(reader.read(), signal);
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
  constructor(
    private readonly getConfig: () => AiConfig,
    private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ) {}

  async streamChat(
    messages: AiMessage[],
    onDelta: (delta: string) => void,
    opts: { signal?: AbortSignal; model?: string } = {},
  ): Promise<string> {
    const config = this.getConfig();
    const { signal, timeout } = this.createSignals(opts.signal);
    try {
      const response = await raceSignal(
        this.postChat(config, messages, true, opts.model, config.temperature, signal),
        signal,
      );
      const contentType = response.headers.get('content-type') ?? '';
      if (contentType.includes('text/event-stream')) {
        return await readSseStream(response, onDelta, signal);
      }
      const content = extractMessageContent(await raceSignal(response.json(), signal));
      onDelta(content);
      return content;
    } catch (error) {
      throw normalizeError(error, opts.signal, timeout);
    }
  }

  async complete(
    messages: AiMessage[],
    opts: {
      model?: string;
      signal?: AbortSignal;
      temperature?: number;
      timeoutMs?: number;
    } = {},
  ): Promise<string> {
    const config = this.getConfig();
    const { signal, timeout } = this.createSignals(opts.signal, opts.timeoutMs);
    try {
      const response = await raceSignal(
        this.postChat(
          config,
          messages,
          false,
          opts.model,
          opts.temperature ?? config.temperature,
          signal,
        ),
        signal,
      );
      return extractMessageContent(await raceSignal(response.json(), signal));
    } catch (error) {
      throw normalizeError(error, opts.signal, timeout);
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

  /**
   * Sends one tiny real chat turn and reports how long the first streamed
   * token took plus the total round trip. Used to compare saved profiles;
   * costs a token or two per probe.
   */
  async testChatSpeed(
    opts: { timeoutMs?: number } = {},
  ): Promise<{ firstTokenMs: number; totalMs: number }> {
    const config = this.getConfig();
    const { signal, timeout } = this.createSignals(
      undefined,
      opts.timeoutMs ?? Math.min(this.timeoutMs, DEFAULT_SPEED_TEST_TIMEOUT_MS),
    );
    const startedAt = performance.now();
    let firstTokenMs: number | null = null;
    const markFirstToken = (): void => {
      if (firstTokenMs === null) {
        firstTokenMs = performance.now() - startedAt;
      }
    };

    try {
      const response = await raceSignal(
        this.postChat(
          config,
          [{ role: 'user', content: SPEED_TEST_PROMPT }],
          true,
          undefined,
          0,
          signal,
          SPEED_TEST_MAX_TOKENS,
        ),
        signal,
      );
      const contentType = response.headers.get('content-type') ?? '';
      if (contentType.includes('text/event-stream')) {
        await readSseStream(response, markFirstToken, signal);
      } else {
        extractMessageContent(await raceSignal(response.json(), signal));
        markFirstToken();
      }
      const totalMs = performance.now() - startedAt;
      return { firstTokenMs: firstTokenMs ?? totalMs, totalMs };
    } catch (error) {
      throw normalizeError(error, undefined, timeout);
    }
  }

  private createSignals(
    callerSignal?: AbortSignal,
    timeoutMs?: number,
  ): {
    signal: AbortSignal;
    timeout: AbortSignal;
  } {
    const timeout = AbortSignal.timeout(timeoutMs ?? this.timeoutMs);
    return {
      signal:
        callerSignal === undefined
          ? timeout
          : AbortSignal.any([callerSignal, timeout]),
      timeout,
    };
  }

  private async postChat(
    config: AiConfig,
    messages: AiMessage[],
    stream: boolean,
    model: string | undefined,
    temperature: number,
    signal?: AbortSignal,
    maxTokens?: number,
  ): Promise<Response> {
    const body: Record<string, unknown> = {
      model: model ?? config.chatModel,
      messages,
      temperature,
      stream,
    };
    if (maxTokens !== undefined) {
      body.max_tokens = maxTokens;
    }
    const response = await fetch(`${normalizeBaseUrl(config.baseUrl)}/chat/completions`, {
      method: 'POST',
      headers: this.authHeaders(config),
      body: JSON.stringify(body),
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
