import { createServer } from 'node:http';
import type { IncomingHttpHeaders, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { AiClient } from '@main/ai/client';
import type { AiConfig, AiMessage } from '@main/ai/client';

interface RecordedRequest {
  method: string | undefined;
  url: string | undefined;
  headers: IncomingHttpHeaders;
  body: string;
}

interface TestServer {
  baseUrl: string;
  requests: RecordedRequest[];
  close: () => Promise<void>;
}

type TestHandler = (request: RecordedRequest, response: ServerResponse) => void;

const servers: TestServer[] = [];

async function startServer(handler: TestHandler): Promise<TestServer> {
  let closed = false;
  const requests: RecordedRequest[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const request: RecordedRequest = {
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      };
      requests.push(request);
      handler(request, res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  const testServer: TestServer = {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    close: async () => {
      if (closed) {
        return;
      }
      closed = true;
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
  servers.push(testServer);
  return testServer;
}

afterEach(async () => {
  const started = servers.splice(0);
  await Promise.all(started.map((server) => server.close()));
});

function createClient(baseUrl: string, overrides: Partial<AiConfig> = {}): AiClient {
  const config: AiConfig = {
    baseUrl,
    apiKey: 'sk-test',
    chatModel: 'chat-default',
    visionModel: 'vision-override',
    temperature: 0.4,
    ...overrides,
  };
  return new AiClient(() => config);
}

const MESSAGES: AiMessage[] = [{ role: 'user', content: '请总结这篇论文' }];

function sseData(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function deltaChunk(content: string): string {
  return sseData({ choices: [{ delta: { content } }] });
}

describe('AiClient.streamChat', () => {
  it('解析 SSE 增量（忽略注释、坏 JSON 与角色块），[DONE] 结束后返回拼接全文', async () => {
    const server = await startServer((_request, response) => {
      response.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8' });
      response.write(': keep-alive\n\n');
      response.write(sseData({ choices: [{ delta: { role: 'assistant' } }] }));
      response.write('data: {"choices":[{"delta":{"content":"Hel');
      response.write('lo"}}]}\r\n\r\n');
      response.write('data: {not valid json\n\n');
      response.write(deltaChunk(' '));
      response.write(deltaChunk('world'));
      response.write('data: [DONE]\n\n');
      response.end();
    });
    const client = createClient(`${server.baseUrl}/`);

    const deltas: string[] = [];
    const result = await client.streamChat(MESSAGES, (delta) => {
      deltas.push(delta);
    });

    expect(deltas).toEqual(['Hello', ' ', 'world']);
    expect(result).toBe('Hello world');

    expect(server.requests).toHaveLength(1);
    const request = server.requests[0];
    expect(request.method).toBe('POST');
    expect(request.url).toBe('/chat/completions');
    expect(request.headers.authorization).toBe('Bearer sk-test');
    expect(request.headers['content-type']).toContain('application/json');
    expect(JSON.parse(request.body)).toEqual({
      model: 'chat-default',
      messages: [{ role: 'user', content: '请总结这篇论文' }],
      temperature: 0.4,
      stream: true,
    });
  });

  it('响应不是 SSE 时按 JSON 读取，onDelta 一次性收到全文，且 opts.model 覆盖 chatModel', async () => {
    const server = await startServer((_request, response) => {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(
        JSON.stringify({ choices: [{ message: { role: 'assistant', content: '完整回答' } }] }),
      );
    });
    const client = createClient(server.baseUrl);

    const deltas: string[] = [];
    const result = await client.streamChat(
      MESSAGES,
      (delta) => {
        deltas.push(delta);
      },
      { model: 'vision-override' },
    );

    expect(deltas).toEqual(['完整回答']);
    expect(result).toBe('完整回答');
    const body = JSON.parse(server.requests[0].body) as Record<string, unknown>;
    expect(body.model).toBe('vision-override');
    expect(body.stream).toBe(true);
  });

  it('AbortController 中止流式读取时抛出「已取消」', async () => {
    const server = await startServer((_request, response) => {
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      response.write(deltaChunk('first'));
      // 保持连接不结束，等待客户端中止。
    });
    const client = createClient(server.baseUrl);
    const controller = new AbortController();
    const deltas: string[] = [];

    await expect(
      client.streamChat(
        MESSAGES,
        (delta) => {
          deltas.push(delta);
          controller.abort();
        },
        { signal: controller.signal },
      ),
    ).rejects.toThrow('已取消');

    expect(deltas).toEqual(['first']);
  });
});

describe('AiClient.complete', () => {
  it('返回 choices[0].message.content，opts.model 覆盖配置且 stream 为 false', async () => {
    const server = await startServer((_request, response) => {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ choices: [{ message: { content: '非流式回答' } }] }));
    });
    const client = createClient(server.baseUrl);

    const result = await client.complete(MESSAGES, { model: 'vision-override' });

    expect(result).toBe('非流式回答');
    expect(server.requests[0].method).toBe('POST');
    expect(server.requests[0].url).toBe('/chat/completions');
    const body = JSON.parse(server.requests[0].body) as Record<string, unknown>;
    expect(body.model).toBe('vision-override');
    expect(body.temperature).toBe(0.4);
    expect(body.stream).toBe(false);
  });

  it('响应缺少 content 时返回空字符串', async () => {
    const server = await startServer((_request, response) => {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ choices: [{ message: {} }] }));
    });
    const client = createClient(server.baseUrl);

    await expect(client.complete(MESSAGES)).resolves.toBe('');
  });
});

describe('AiClient 错误映射', () => {
  it('401 映射为「API Key 无效或已过期」，streamChat 与 complete 一致', async () => {
    const server = await startServer((_request, response) => {
      response.writeHead(401, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: { message: 'invalid key' } }));
    });
    const client = createClient(server.baseUrl);

    await expect(client.streamChat(MESSAGES, () => {})).rejects.toThrow(
      'API Key 无效或已过期',
    );
    await expect(client.complete(MESSAGES)).rejects.toThrow('API Key 无效或已过期');
  });

  it('429 映射为「请求过于频繁或额度不足」', async () => {
    const server = await startServer((_request, response) => {
      response.writeHead(429, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: { message: 'rate limited' } }));
    });
    const client = createClient(server.baseUrl);

    await expect(client.streamChat(MESSAGES, () => {})).rejects.toThrow(
      '请求过于频繁或额度不足',
    );
  });

  it('其他非 2xx 带状态码并优先使用 JSON error.message', async () => {
    const server = await startServer((_request, response) => {
      response.writeHead(500, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: { message: 'relay exploded' } }));
    });
    const client = createClient(server.baseUrl);

    await expect(client.streamChat(MESSAGES, () => {})).rejects.toThrow(
      '请求失败（HTTP 500）：relay exploded',
    );
  });

  it('非 JSON 错误体回退到原始文本并截断到 500 字符', async () => {
    const longBody = 'x'.repeat(800);
    const server = await startServer((_request, response) => {
      response.writeHead(502, { 'Content-Type': 'text/plain' });
      response.end(longBody);
    });
    const client = createClient(server.baseUrl);

    const error = await client.streamChat(MESSAGES, () => {}).then(
      () => null,
      (reason: unknown) => reason,
    );

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(`请求失败（HTTP 502）：${'x'.repeat(500)}`);
  });

  it('网络错误保留原始错误消息', async () => {
    const server = await startServer((_request, response) => {
      response.end();
    });
    const client = createClient(server.baseUrl);
    await server.close();

    await expect(client.streamChat(MESSAGES, () => {})).rejects.toThrow(
      /fetch failed|ECONNREFUSED|connect/i,
    );
  });
});

describe('AiClient.testConnection', () => {
  it('GET /models 返回 2xx 时为 ok（baseUrl 末尾斜杠被规范化）', async () => {
    const server = await startServer((_request, response) => {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ data: [] }));
    });
    const client = createClient(`${server.baseUrl}/`);

    await expect(client.testConnection()).resolves.toEqual({ ok: true });
    expect(server.requests[0].method).toBe('GET');
    expect(server.requests[0].url).toBe('/models');
    expect(server.requests[0].headers.authorization).toBe('Bearer sk-test');
  });

  it('401 时返回 ok:false 及映射后的错误消息', async () => {
    const server = await startServer((_request, response) => {
      response.writeHead(401, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: { message: 'invalid key' } }));
    });
    const client = createClient(server.baseUrl);

    await expect(client.testConnection()).resolves.toEqual({
      ok: false,
      error: 'API Key 无效或已过期',
    });
  });

  it('网络错误时返回 ok:false 及原始错误消息', async () => {
    const server = await startServer((_request, response) => {
      response.end();
    });
    const client = createClient(server.baseUrl);
    await server.close();

    const result = await client.testConnection();

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/fetch failed|ECONNREFUSED|connect/i);
  });
});
