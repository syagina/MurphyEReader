import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import {
  PROXY_EMPTY_MARKER,
  startOpenAiProxy,
  type OpenAiProxyHandle,
  type ProxyActivity,
} from '@main/translation/openai-proxy';

interface UpstreamReply {
  status?: number;
  payload: unknown;
}

interface Upstream {
  url: string;
  paths: string[];
  requests: Array<Record<string, unknown>>;
  close(): Promise<void>;
}

function replyPayload(content: string): UpstreamReply {
  return {
    payload: {
      id: 'chatcmpl-test',
      object: 'chat.completion',
      created: 0,
      model: 'test',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
    },
  };
}

async function startUpstream(
  responder: (
    body: Record<string, unknown>,
    index: number,
  ) => UpstreamReply | Promise<UpstreamReply>,
): Promise<Upstream> {
  const paths: string[] = [];
  const requests: Array<Record<string, unknown>> = [];
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });
    request.on('end', () => {
      void (async () => {
        let body: Record<string, unknown> = {};
        try {
          const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
            body = parsed as Record<string, unknown>;
          }
        } catch {
          // Keep the empty object; the test asserts on a valid request.
        }
        paths.push(request.url ?? '');
        requests.push(body);
        const result = await responder(body, requests.length - 1);
        const text = JSON.stringify(result.payload);
        response.writeHead(result.status ?? 200, {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(text),
        });
        response.end(text);
      })();
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${address.port}`,
    paths,
    requests,
    close: async () => {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
    },
  };
}

function translateBody(content = 'Translate this paragraph into Chinese.'): Record<string, unknown> {
  return {
    model: 'test-model',
    temperature: 0,
    max_tokens: 2048,
    messages: [{ role: 'user', content }],
  };
}

async function callProxy(
  proxy: OpenAiProxyHandle,
  body: Record<string, unknown>,
): Promise<Response> {
  return fetch(`${proxy.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${proxy.apiKey}`,
    },
    body: JSON.stringify(body),
  });
}

let proxy: OpenAiProxyHandle | null = null;
let upstream: Upstream | null = null;

afterEach(async () => {
  await proxy?.close();
  await upstream?.close();
  proxy = null;
  upstream = null;
});

describe('startOpenAiProxy', () => {
  it('raises the output budget and replaces the local credential upstream', async () => {
    upstream = await startUpstream(() => replyPayload('译文'));
    proxy = await startOpenAiProxy({
      baseUrl: `${upstream.url}/v1`,
      apiKey: 'sk-real',
      retryDelayMs: 0,
    });

    const response = await callProxy(proxy, translateBody());

    expect(response.status).toBe(200);
    expect(upstream.paths).toEqual(['/v1/chat/completions']);
    expect(upstream.requests[0].max_tokens).toBe(32768);
    expect(upstream.requests[0].reasoning_effort).toBeUndefined();
    expect(proxy.apiKey).not.toBe('sk-real');
    expect(proxy.getFailure()).toBeNull();
  });

  it('keeps deepseek-flash thinking on at the provider default effort', async () => {
    upstream = await startUpstream(() => replyPayload('译文'));
    proxy = await startOpenAiProxy({
      baseUrl: `${upstream.url}/v1`,
      apiKey: 'sk-real',
      retryDelayMs: 0,
    });

    const response = await callProxy(proxy, {
      ...translateBody(),
      model: 'deepseek-flash',
    });

    expect(response.status).toBe(200);
    expect(upstream.requests[0]).toMatchObject({
      model: 'deepseek-flash',
      thinking: { type: 'enabled' },
      max_tokens: 32768,
    });
    expect(upstream.requests[0].reasoning_effort).toBeUndefined();
  });

  it('reports the lifecycle of a translation request to the job runner', async () => {
    const snapshots: ProxyActivity[] = [];
    upstream = await startUpstream(() => replyPayload('译文'));
    proxy = await startOpenAiProxy({
      baseUrl: upstream.url,
      apiKey: 'sk-real',
      retryDelayMs: 0,
      onActivity: (activity) => snapshots.push(activity),
    });

    const response = await callProxy(proxy, translateBody());

    expect(response.status).toBe(200);
    // First snapshot: the request is in flight. Last snapshot: it completed.
    expect(snapshots[0]).toMatchObject({ started: 1, completed: 0, inflight: 1 });
    expect(snapshots.at(-1)).toMatchObject({
      started: 1,
      completed: 1,
      inflight: 0,
      retries: 0,
      failed: 0,
    });
    expect(typeof snapshots.at(-1)?.lastDurationMs).toBe('number');
  });

  it('counts retries and permanent failures, and tracks glossary calls separately', async () => {
    const snapshots: ProxyActivity[] = [];
    upstream = await startUpstream((body) => {
      const content = JSON.stringify(body.messages ?? '');
      return /expert multilingual terminologist/i.test(content)
        ? replyPayload('[]')
        : replyPayload('');
    });
    proxy = await startOpenAiProxy({
      baseUrl: upstream.url,
      apiKey: 'sk-real',
      retryDelayMs: 0,
      onActivity: (activity) => snapshots.push(activity),
    });

    const failed = await callProxy(proxy, translateBody());
    expect(failed.status).toBe(502);
    expect(snapshots.at(-1)).toMatchObject({
      started: 1,
      completed: 0,
      inflight: 0,
      retries: 2,
      failed: 1,
      glossaryStarted: 0,
      glossaryCompleted: 0,
      glossaryInflight: 0,
    });

    const beforeGlossary = snapshots.length;
    const glossary = await callProxy(
      proxy,
      translateBody('You are an expert multilingual terminologist. Extract key terms.'),
    );
    expect(glossary.status).toBe(200);
    // Glossary extraction has its own counters so the heartbeat can say what
    // BabelDOC is doing instead of showing the stale "parsing PDF" message.
    expect(snapshots.length).toBeGreaterThan(beforeGlossary);
    expect(snapshots.at(-1)).toMatchObject({
      started: 1,
      completed: 0,
      inflight: 0,
      retries: 2,
      failed: 1,
      glossaryStarted: 1,
      glossaryCompleted: 1,
      glossaryInflight: 0,
    });
  });

  it('retries an empty answer and returns the next usable translation', async () => {
    upstream = await startUpstream((_body, index) =>
      index === 0 ? replyPayload('') : replyPayload('译文'),
    );
    proxy = await startOpenAiProxy({
      baseUrl: upstream.url,
      apiKey: 'sk-real',
      retryDelayMs: 0,
    });

    const response = await callProxy(proxy, translateBody());

    expect(response.status).toBe(200);
    expect(upstream.requests).toHaveLength(2);
    expect(upstream.requests[1].max_tokens).toBe(65536);
    expect(proxy.getFailure()).toBeNull();
  });

  it('records why the latest automatic retry happened', async () => {
    const snapshots: ProxyActivity[] = [];
    upstream = await startUpstream((_body, index) =>
      index === 0
        ? {
            payload: {
              choices: [
                {
                  index: 0,
                  message: { role: 'assistant', content: 'partial' },
                  finish_reason: 'length',
                },
              ],
            },
          }
        : replyPayload('译文'),
    );
    proxy = await startOpenAiProxy({
      baseUrl: upstream.url,
      apiKey: 'sk-real',
      retryDelayMs: 0,
      onActivity: (activity) => snapshots.push(activity),
    });

    const response = await callProxy(proxy, translateBody());

    expect(response.status).toBe(200);
    expect(snapshots.at(-1)).toMatchObject({
      retries: 1,
      lastRetryReason: 'truncated',
    });
  });

  it('reports a permanent empty answer and refuses to pass it through', async () => {
    upstream = await startUpstream(() => replyPayload(''));
    proxy = await startOpenAiProxy({
      baseUrl: upstream.url,
      apiKey: 'sk-real',
      retryDelayMs: 0,
    });

    const response = await callProxy(proxy, translateBody());

    expect(response.status).toBe(502);
    expect(await response.text()).toContain(PROXY_EMPTY_MARKER);
    expect(upstream.requests).toHaveLength(3);
    expect(upstream.requests.map((request) => request.max_tokens)).toEqual([
      32768,
      65536,
      65536,
    ]);
    expect(proxy.getFailure()).toBe('empty');
  });

  it('falls back to the requested budget when a model rejects the raised one', async () => {
    upstream = await startUpstream((_body, index) =>
      index === 0
        ? { status: 400, payload: { error: { message: 'max_tokens too large' } } }
        : replyPayload('译文'),
    );
    proxy = await startOpenAiProxy({
      baseUrl: upstream.url,
      apiKey: 'sk-real',
      retryDelayMs: 0,
    });

    const response = await callProxy(proxy, translateBody());

    expect(response.status).toBe(200);
    expect(upstream.requests.map((request) => request.max_tokens)).toEqual([
      32768,
      16384,
    ]);
  });

  it('keeps stepping down until a provider accepts the output budget', async () => {
    upstream = await startUpstream((_body, index) =>
      index < 2
        ? { status: 400, payload: { error: { message: 'max_tokens too large' } } }
        : replyPayload('译文'),
    );
    proxy = await startOpenAiProxy({
      baseUrl: `${upstream.url}/v1`,
      apiKey: 'sk-real',
      retryDelayMs: 0,
    });

    const response = await callProxy(proxy, translateBody());

    expect(response.status).toBe(200);
    expect(upstream.requests.map((request) => request.max_tokens)).toEqual([
      32768,
      16384,
      8192,
    ]);
  });

  it('retries a transient provider error before giving up', async () => {
    upstream = await startUpstream((_body, index) =>
      index === 0
        ? { status: 503, payload: { error: { message: 'overloaded' } } }
        : replyPayload('译文'),
    );
    proxy = await startOpenAiProxy({
      baseUrl: upstream.url,
      apiKey: 'sk-real',
      retryDelayMs: 0,
    });

    const response = await callProxy(proxy, translateBody());

    expect(response.status).toBe(200);
    expect(upstream.requests).toHaveLength(2);
    expect(proxy.getFailure()).toBeNull();
  });

  it('records a permanent provider error so the job is not bound', async () => {
    upstream = await startUpstream(() => ({
      status: 500,
      payload: { error: { message: 'provider failed' } },
    }));
    proxy = await startOpenAiProxy({
      baseUrl: upstream.url,
      apiKey: 'sk-real',
      retryDelayMs: 0,
    });

    const response = await callProxy(proxy, translateBody());

    expect(response.status).toBe(500);
    expect(upstream.requests).toHaveLength(3);
    expect(proxy.getFailure()).toBe('upstream');
  });

  it('forgets a failure when BabelDOC retries the same request successfully', async () => {
    upstream = await startUpstream((_body, index) =>
      index < 3
        ? { status: 500, payload: { error: { message: 'provider failed' } } }
        : replyPayload('译文'),
    );
    proxy = await startOpenAiProxy({
      baseUrl: upstream.url,
      apiKey: 'sk-real',
      retryDelayMs: 0,
    });

    const first = await callProxy(proxy, translateBody());
    expect(first.status).toBe(500);
    expect(proxy.getFailure()).toBe('upstream');

    const second = await callProxy(proxy, translateBody());
    expect(second.status).toBe(200);
    expect(proxy.getFailure()).toBeNull();
  });

  it('does not fail a job when term extraction returns nothing', async () => {
    upstream = await startUpstream(() => replyPayload(''));
    proxy = await startOpenAiProxy({
      baseUrl: upstream.url,
      apiKey: 'sk-real',
      retryDelayMs: 0,
    });

    const response = await callProxy(
      proxy,
      translateBody(
        'You are an expert multilingual terminologist. Extract key terms from the text.',
      ),
    );
    const payload = (await response.json()) as {
      choices: Array<{ message: { content: string } }>;
    };

    expect(response.status).toBe(200);
    expect(payload.choices[0].message.content).toBe('[]');
    expect(proxy.getFailure()).toBeNull();
  });

  it('treats a failed glossary request as no terms', async () => {
    upstream = await startUpstream(() => ({
      status: 500,
      payload: { error: { message: 'provider failed' } },
    }));
    proxy = await startOpenAiProxy({
      baseUrl: upstream.url,
      apiKey: 'sk-real',
      retryDelayMs: 0,
    });

    const response = await callProxy(
      proxy,
      translateBody('You are an expert multilingual terminologist.'),
    );
    const payload = (await response.json()) as {
      choices: Array<{ message: { content: string } }>;
    };

    expect(response.status).toBe(200);
    expect(payload.choices[0].message.content).toBe('[]');
    expect(upstream.requests).toHaveLength(3);
    expect(proxy.getFailure()).toBeNull();
  });

  it('rejects the wrong local credential without contacting the provider', async () => {
    upstream = await startUpstream(() => replyPayload('译文'));
    proxy = await startOpenAiProxy({
      baseUrl: upstream.url,
      apiKey: 'sk-real',
      retryDelayMs: 0,
    });

    const response = await fetch(`${proxy.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer wrong',
      },
      body: JSON.stringify(translateBody()),
    });

    expect(response.status).toBe(401);
    expect(upstream.requests).toHaveLength(0);
  });

  it('marks a transport failure as unreachable', async () => {
    const snapshots: ProxyActivity[] = [];
    proxy = await startOpenAiProxy({
      baseUrl: 'http://127.0.0.1:1',
      apiKey: 'sk-real',
      retryDelayMs: 0,
      onActivity: (activity) => snapshots.push(activity),
    });

    const response = await callProxy(proxy, translateBody());

    expect(response.status).toBe(502);
    expect(proxy.getFailure()).toBe('unreachable');
    expect(snapshots.at(-1)).toMatchObject({ failed: 1, inflight: 0 });
  });
});
