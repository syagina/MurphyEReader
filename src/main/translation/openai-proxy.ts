import { createHash, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/** The path BabelDOC appends `/chat/completions` to is served under this prefix. */
const PROXY_PREFIX = '/v1';

/**
 * BabelDOC 0.7.1 hardcodes `max_tokens: 2048` in its LLM translator path. Long
 * paragraph groups then hit the provider's output limit, and some
 * OpenAI-compatible providers answer those requests with an empty body instead
 * of an error. BabelDOC accepts the empty body as a translation, which is how
 * whole paragraphs disappear from both mono and dual output.
 */
const DEFAULT_MAX_TOKENS = 32768;
const MAX_TOKENS_CEILING = 65536;
const MAX_CONTENT_ATTEMPTS = 3;
const MAX_TRANSIENT_RETRIES = 2;
const MAX_REQUEST_ATTEMPTS = 12;
const REQUEST_BODY_LIMIT_BYTES = 32 * 1024 * 1024;
const DEFAULT_RETRY_DELAY_MS = 400;

/**
 * deepseek-flash enables thinking by default, and its output budget covers
 * reasoning plus the final answer. Keep thinking explicitly enabled and let
 * the provider use its default effort; the larger ceiling above leaves room
 * for both the reasoning and the translation.
 */
const DEEPSEEK_FLASH_MODEL = /deepseek.*flash/i;

/** Markers BabelDOC may echo into its (redacted) log on a permanent failure. */
export const PROXY_EMPTY_MARKER = 'paperlens_empty_translation';
export const PROXY_UNREACHABLE_MARKER = 'paperlens_upstream_unreachable';

export type ProxyFailure =
  /** A translation request produced nothing usable after every retry. */
  | 'empty'
  /** The provider could not be reached at all. */
  | 'unreachable'
  /** The provider answered with a permanent HTTP error. */
  | 'upstream'
  | null;

/** Why the relay retried a request; surfaced in the heartbeat line. */
export type ProxyRetryReason =
  | 'empty'
  | 'truncated'
  | 'rate-limit'
  | 'timeout'
  | 'upstream'
  | 'budget';

/**
 * Live translation-request counters. BabelDOC's own progress bar stays silent
 * in a pipe, so these counters are what let the UI show that work is moving.
 */
export interface ProxyActivity {
  /** Paragraph-translation requests; glossary calls have separate counters. */
  started: number;
  completed: number;
  inflight: number;
  retries: number;
  /** Reason for the most recent retry, so the UI can explain the delay. */
  lastRetryReason: ProxyRetryReason | null;
  failed: number;
  /** Terminology-extraction requests, visible while BabelDOC is in that stage. */
  glossaryStarted: number;
  glossaryCompleted: number;
  glossaryInflight: number;
  /** Duration of the most recent paragraph-translation request. */
  lastDurationMs: number | null;
}

export interface OpenAiProxyOptions {
  baseUrl: string;
  apiKey: string;
  /** Initial output budget; the request's own value wins when already larger. */
  maxTokens?: number;
  /** Tests set this to zero; production keeps a short backoff between retries. */
  retryDelayMs?: number;
  fetchImpl?: typeof fetch;
  /** Reports translation-request counters; glossary calls are not counted. */
  onActivity?: (activity: ProxyActivity) => void;
}

export interface OpenAiProxyHandle {
  /** Base URL that BabelDOC should be configured with. */
  baseUrl: string;
  /** Random local credential; the real API key never reaches the config file. */
  apiKey: string;
  /** A translation request failed permanently; the job must not be bound. */
  getFailure(): ProxyFailure;
  close(): Promise<void>;
}

interface RewrittenPayload {
  payload: Record<string, unknown>;
  requestedMaxTokens: number | null;
  termExtraction: boolean;
}

function messageText(payload: Record<string, unknown>): string {
  const messages = payload.messages;
  if (!Array.isArray(messages)) {
    return '';
  }
  const parts: string[] = [];
  for (const message of messages) {
    if (typeof message !== 'object' || message === null) {
      continue;
    }
    const content = (message as { content?: unknown }).content;
    if (typeof content === 'string') {
      parts.push(content);
    } else if (Array.isArray(content)) {
      for (const part of content) {
        if (
          typeof part === 'object' &&
          part !== null &&
          typeof (part as { text?: unknown }).text === 'string'
        ) {
          parts.push((part as { text: string }).text);
        }
      }
    }
  }
  return parts.join('\n');
}

function parsePayload(raw: Buffer): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(raw.toString('utf8'));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function rewritePayload(
  input: Record<string, unknown>,
  cap: number,
): RewrittenPayload {
  const payload: Record<string, unknown> = { ...input };
  const requested =
    typeof payload.max_tokens === 'number'
      ? payload.max_tokens
      : typeof payload.max_completion_tokens === 'number'
        ? payload.max_completion_tokens
        : null;
  if (requested !== null) {
    const adjusted = Math.max(requested, cap);
    if (typeof payload.max_tokens === 'number') {
      payload.max_tokens = adjusted;
    } else {
      payload.max_completion_tokens = adjusted;
    }
  }
  const model = payload.model;
  if (typeof model === 'string' && DEEPSEEK_FLASH_MODEL.test(model)) {
    // Thinking stays on at the provider's default effort. Preserve an explicit
    // switch if the caller already chose one.
    payload.thinking ??= { type: 'enabled' };
  }
  const content = messageText(payload);
  return {
    payload,
    requestedMaxTokens: requested,
    // BabelDOC's glossary prompt opens with this exact role; a paper that
    // merely mentions terminology must not be mistaken for it.
    termExtraction: /expert multilingual terminologist/i.test(content),
  };
}

interface ChoiceShape {
  finish_reason?: unknown;
  message?: { content?: unknown };
}

interface ResponseShape {
  choices?: ChoiceShape[];
  usage?: { completion_tokens?: unknown };
}

/**
 * Empty content and an output-limit stop are the two ways a provider reports
 * that it produced nothing usable. A completion count at the cap is treated as
 * truncated even when the provider mislabels the finish reason.
 */
function translationProblem(
  payload: unknown,
  cap: number,
): 'empty' | 'truncated' | null {
  if (typeof payload !== 'object' || payload === null) {
    return 'empty';
  }
  const choice = (payload as ResponseShape).choices?.[0];
  if (choice === undefined) {
    return 'empty';
  }
  const content = choice.message?.content;
  if (typeof content !== 'string' || content.trim() === '') {
    return 'empty';
  }
  if (choice.finish_reason === 'length') {
    return 'truncated';
  }
  const completion = (payload as ResponseShape).usage?.completion_tokens;
  return typeof completion === 'number' &&
    cap > 0 &&
    completion >= cap * 0.98
    ? 'truncated'
    : null;
}

function delay(ms: number): Promise<void> {
  return ms <= 0
    ? Promise.resolve()
    : new Promise((resolve) => {
        setTimeout(resolve, ms);
      });
}

function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
): void {
  const text = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
  });
  response.end(text);
}

function sendText(
  response: ServerResponse,
  status: number,
  text: string,
  contentType: string,
): void {
  response.writeHead(status, {
    'content-type': contentType,
    'content-length': Buffer.byteLength(text),
  });
  response.end(text);
}

/**
 * BabelDOC's glossary extraction is optional: an empty term list keeps the run
 * going. Failures there must not fail the whole translation.
 */
function sendEmptyTerms(response: ServerResponse, model: unknown): void {
  sendJson(response, 200, {
    id: 'paperlens-empty-terms',
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: typeof model === 'string' ? model : '',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: '[]' },
        finish_reason: 'stop',
      },
    ],
  });
}

/** Lower output budgets to try when a model rejects the raised one. */
function fallbackLadder(raised: number, requested: number): number[] {
  const candidates: number[] = [];
  let candidate = Math.max(requested, Math.floor(raised / 2));
  while (candidate > 0 && candidate < raised) {
    candidates.push(candidate);
    if (candidate <= requested) {
      break;
    }
    candidate = Math.max(requested, Math.floor(candidate / 2));
  }
  return candidates.filter(
    (value, index) => value > 0 && value < raised && candidates.indexOf(value) === index,
  );
}

function readRequestBody(request: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > REQUEST_BODY_LIMIT_BYTES) {
        reject(new Error('request body too large'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      resolve(Buffer.concat(chunks));
    });
    request.on('error', reject);
  });
}

/**
 * Starts a loopback-only OpenAI-compatible relay for one BabelDOC job.
 *
 * The relay raises the output budget, retries empty or truncated answers, and
 * records whether any *translation* request could not be recovered. It also
 * keeps the real API key out of the temporary config file BabelDOC reads.
 */
export async function startOpenAiProxy(
  options: OpenAiProxyOptions,
): Promise<OpenAiProxyHandle> {
  const upstreamBase = options.baseUrl.trim().replace(/\/+$/, '');
  const fetchImpl = options.fetchImpl ?? fetch;
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  const localKey = randomBytes(24).toString('hex');
  const bearer = `Bearer ${localKey}`;
  /**
   * BabelDOC retries a rate-limited or 5xx request itself, so a failure is only
   * permanent when no later attempt with the same body succeeds. Track by
   * request body and clear the entry on recovery.
   */
  const failedTranslations = new Map<string, Exclude<ProxyFailure, null>>();
  const activity: ProxyActivity = {
    started: 0,
    completed: 0,
    inflight: 0,
    retries: 0,
    lastRetryReason: null,
    failed: 0,
    glossaryStarted: 0,
    glossaryCompleted: 0,
    glossaryInflight: 0,
    lastDurationMs: null,
  };
  const notifyActivity = (): void => {
    try {
      options.onActivity?.({ ...activity });
    } catch {
      // Observability must never break the translation request itself.
    }
  };
  let closed = false;

  const requestKey = (input: Record<string, unknown>): string =>
    createHash('sha256').update(JSON.stringify(input)).digest('hex');

  const recordFailure = (
    key: string,
    termExtraction: boolean,
    kind: Exclude<ProxyFailure, null>,
  ): void => {
    if (!termExtraction) {
      failedTranslations.set(key, kind);
    }
  };

  const server = createServer((request, response) => {
    // Lets the outer crash handler close out the activity counters of a
    // request that threw after it was already counted as in flight.
    let abortActivity: (() => void) | null = null;
    void (async () => {
      if (request.method !== 'POST') {
        sendJson(response, 405, {
          error: { message: 'only POST is supported' },
        });
        return;
      }
      if (request.headers.authorization !== bearer) {
        sendJson(response, 401, {
          error: { message: 'invalid local translation credential' },
        });
        return;
      }
      const path = request.url ?? '';
      if (!path.startsWith(`${PROXY_PREFIX}/`)) {
        sendJson(response, 404, { error: { message: 'unknown path' } });
        return;
      }
      const upstreamUrl = `${upstreamBase}${path.slice(PROXY_PREFIX.length)}`;

      let rawBody: Buffer;
      try {
        rawBody = await readRequestBody(request);
      } catch {
        sendJson(response, 413, { error: { message: 'request body too large' } });
        return;
      }
      const input = parsePayload(rawBody);
      if (input === null) {
        sendJson(response, 400, { error: { message: 'invalid JSON body' } });
        return;
      }
      const key = requestKey(input);

      let cap = options.maxTokens ?? DEFAULT_MAX_TOKENS;
      const termExtraction = rewritePayload(input, cap).termExtraction;
      const requestStartedAt = Date.now();
      let finished = false;
      const finishActivity = (ok: boolean): void => {
        if (finished) {
          return;
        }
        finished = true;
        if (termExtraction) {
          activity.glossaryInflight = Math.max(
            0,
            activity.glossaryInflight - 1,
          );
          if (ok) {
            activity.glossaryCompleted += 1;
          }
        } else {
          activity.inflight = Math.max(0, activity.inflight - 1);
          if (ok) {
            activity.completed += 1;
          } else {
            activity.failed += 1;
          }
          activity.lastDurationMs = Date.now() - requestStartedAt;
        }
        notifyActivity();
      };
      abortActivity = (): void => {
        finishActivity(false);
      };
      let fallbackCaps: number[] | null = null;
      let lastContentType = 'application/json';
      let contentAttempts = 0;
      let transientRetries = 0;

      for (let attempt = 0; attempt < MAX_REQUEST_ATTEMPTS; attempt += 1) {
        const rewritten = rewritePayload(input, cap);
        if (rewritten.requestedMaxTokens !== null) {
          cap = Math.max(cap, rewritten.requestedMaxTokens);
        }
        if (attempt === 0) {
          if (termExtraction) {
            activity.glossaryStarted += 1;
            activity.glossaryInflight += 1;
          } else {
            activity.started += 1;
            activity.inflight += 1;
          }
        } else if (!termExtraction) {
          activity.retries += 1;
        }
        notifyActivity();
        let upstream: Response;
        try {
          upstream = await fetchImpl(upstreamUrl, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              accept: 'application/json',
              authorization: `Bearer ${options.apiKey}`,
            },
            body: JSON.stringify(rewritten.payload),
          });
        } catch {
          finishActivity(false);
          recordFailure(key, termExtraction, 'unreachable');
          sendJson(response, 502, {
            error: {
              message: `${PROXY_UNREACHABLE_MARKER}: upstream request failed`,
              type: PROXY_UNREACHABLE_MARKER,
            },
          });
          return;
        }

        const text = await upstream.text();
        lastContentType =
          upstream.headers.get('content-type') ?? 'application/json';

        if (!upstream.ok) {
          // Some models reject a raised max_tokens outright. Step back down
          // toward the budget BabelDOC originally asked for so those models
          // keep working, even though that budget is the risky one.
          if (
            (upstream.status === 400 || upstream.status === 422) &&
            rewritten.requestedMaxTokens !== null &&
            cap > rewritten.requestedMaxTokens
          ) {
            fallbackCaps ??= fallbackLadder(cap, rewritten.requestedMaxTokens);
            const nextCap = fallbackCaps.shift();
            if (nextCap !== undefined) {
              activity.lastRetryReason = 'budget';
              cap = nextCap;
              continue;
            }
          }
          // A rate limit or provider outage is often momentary. Retry it with
          // the same budget before declaring the paragraph lost.
          const transient =
            upstream.status === 408 ||
            upstream.status === 429 ||
            upstream.status >= 500;
          if (
            transient &&
            transientRetries < MAX_TRANSIENT_RETRIES &&
            attempt + 1 < MAX_REQUEST_ATTEMPTS
          ) {
            transientRetries += 1;
            activity.lastRetryReason =
              upstream.status === 429
                ? 'rate-limit'
                : upstream.status === 408
                  ? 'timeout'
                  : 'upstream';
            await delay(retryDelayMs * (attempt + 1));
            continue;
          }
          if (termExtraction) {
            finishActivity(false);
            sendEmptyTerms(response, input.model);
            return;
          }
          finishActivity(false);
          recordFailure(key, false, 'upstream');
          sendText(response, upstream.status, text, lastContentType);
          return;
        }

        if (rewritten.requestedMaxTokens === null) {
          finishActivity(true);
          failedTranslations.delete(key);
          sendText(response, 200, text, lastContentType);
          return;
        }

        let parsed: unknown = null;
        try {
          parsed = JSON.parse(text);
        } catch {
          // A 200 with a non-JSON body is not a translation either.
        }
        const problem = translationProblem(parsed, cap);
        if (problem === null) {
          finishActivity(true);
          failedTranslations.delete(key);
          sendText(response, 200, text, lastContentType);
          return;
        }

        if (contentAttempts + 1 >= MAX_CONTENT_ATTEMPTS) {
          break;
        }
        contentAttempts += 1;
        activity.lastRetryReason = problem;
        await delay(retryDelayMs * (contentAttempts + 1));
        cap = Math.min(cap * 2, MAX_TOKENS_CEILING);
      }

      if (termExtraction) {
        finishActivity(false);
        sendEmptyTerms(response, input.model);
        return;
      }

      // No usable answer after every retry: make BabelDOC treat the request
      // as failed so the paragraph keeps its original text instead of being
      // silently replaced by nothing. The job is not bound at all unless a
      // later BabelDOC retry of this same request succeeds and clears it.
      finishActivity(false);
      recordFailure(key, false, 'empty');
      sendJson(response, 502, {
        error: {
          message: `${PROXY_EMPTY_MARKER}: upstream returned no usable translation`,
          type: PROXY_EMPTY_MARKER,
        },
      });
    })().catch(() => {
      abortActivity?.();
      if (!response.headersSent) {
        sendJson(response, 500, {
          error: { message: 'local translation relay failed' },
        });
      } else {
        response.destroy();
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });

  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}${PROXY_PREFIX}`,
    apiKey: localKey,
    getFailure: () => {
      if (failedTranslations.size === 0) {
        return null;
      }
      const kinds = new Set(failedTranslations.values());
      if (kinds.has('empty')) {
        return 'empty';
      }
      return kinds.has('upstream') ? 'upstream' : 'unreachable';
    },
    close: async () => {
      if (closed) {
        return;
      }
      closed = true;
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
    },
  };
}
