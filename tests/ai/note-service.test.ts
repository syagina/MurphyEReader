import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiClient } from '@main/ai/client';
import type { AiMessage } from '@main/ai/client';
import { chunkPages } from '@main/ai/context';
import { generateNote } from '@main/ai/note-service';
import type { NoteDeps } from '@main/ai/note-service';
import {
  DEPTH_SYSTEM_PROMPT,
  INNOVATION_SYSTEM_PROMPT,
  SUMMARY_MINI_SYSTEM_PROMPT,
  SUMMARY_SYSTEM_PROMPT,
  buildSummaryUserPrompt,
} from '@main/ai/prompts';
import { openDb } from '@main/db';
import { createNote } from '@main/db/notes';
import { replacePages } from '@main/db/pages';
import { createPaper, updatePaper } from '@main/db/papers';
import type { AiSettings, Paper, PaperPage } from '@shared/types';

let db: Database.Database;

beforeEach(() => {
  db = openDb(':memory:');
});

afterEach(() => {
  vi.unstubAllGlobals();
  db.close();
});

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

function makePaper(title = '测试论文', tags: string[] = []): Paper {
  const paper = createPaper(db, {
    title,
    authors: '张三, 李四',
    year: 2024,
    filePathOriginal: 'C:/papers/test.pdf',
    filePathTranslated: null,
    pageCountOriginal: 5,
    pageCountTranslated: null,
    hasTextLayer: true,
    outline: [],
  });
  return tags.length === 0 ? paper : updatePaper(db, paper.id, { tags });
}

function seedPages(paperId: number, pages: { pageNo: number; text: string }[]): PaperPage[] {
  replacePages(db, paperId, pages);
  return pages.map((page) => ({ paperId, ...page }));
}

type CompleteResponder = (callIndex: number, messages: AiMessage[]) => string;

interface FakeComplete {
  ai: Pick<AiClient, 'complete'>;
  calls: AiMessage[][];
}

function createFakeComplete(responses: string | CompleteResponder): FakeComplete {
  const calls: AiMessage[][] = [];
  return {
    calls,
    ai: {
      async complete(messages) {
        calls.push(messages);
        return typeof responses === 'string'
          ? responses
          : responses(calls.length - 1, messages);
      },
    },
  };
}

function makeDeps(
  ai: Pick<AiClient, 'complete'>,
  settings: AiSettings = makeSettings(),
): NoteDeps {
  return {
    db,
    ai,
    getSettings: () => settings,
  };
}

function textOf(message: AiMessage): string {
  if (typeof message.content === 'string') {
    return message.content;
  }
  return message.content
    .map((part) => (part.type === 'text' ? part.text : part.image_url.url))
    .join('\n');
}

describe('generateNote summary', () => {
  it('预算内用一次调用生成 summary 笔记', async () => {
    const paper = makePaper('有限元方法综述', ['数值方法']);
    seedPages(paper.id, [
      { pageNo: 1, text: '第一页内容' },
      { pageNo: 2, text: '第二页内容' },
    ]);
    const fake = createFakeComplete('总结内容');

    const note = await generateNote(
      makeDeps(fake.ai, makeSettings({ tokenBudget: 100000 })),
      'summary',
      { paperId: paper.id },
    );

    expect(note).not.toBeNull();
    expect(fake.calls).toHaveLength(1);
    const [system, user] = fake.calls[0];
    expect(system.role).toBe('system');
    expect(textOf(system)).toContain(SUMMARY_SYSTEM_PROMPT);
    expect(textOf(system)).toContain('研究问题');
    expect(textOf(system)).toContain('方法核心');
    expect(textOf(system)).toContain('可借鉴点');
    expect(textOf(system)).toContain('有限元方法综述');
    expect(textOf(system)).toContain('第一页内容');
    expect(user.role).toBe('user');
    expect(textOf(user)).toBe(buildSummaryUserPrompt());

    expect(note).toMatchObject({
      paperId: paper.id,
      type: 'summary',
      title: '《有限元方法综述》核心思想总结',
      contentMd: '总结内容',
      tags: ['数值方法'],
    });
  });

  it('全文超预算时先分块摘要再汇总，保存最终汇总结果', async () => {
    const paper = makePaper('长论文');
    const pages = seedPages(
      paper.id,
      [1, 2, 3, 4, 5].map((pageNo) => ({
        pageNo,
        text: '长'.repeat(100) + `第${pageNo}页`,
      })),
    );
    const budget = 150;
    const chunks = chunkPages(pages, budget);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    const expectedCalls = chunks.length + 1;

    const fake = createFakeComplete((callIndex) =>
      callIndex === expectedCalls - 1 ? '最终总结' : `分块摘要${callIndex + 1}`,
    );

    const note = await generateNote(
      makeDeps(fake.ai, makeSettings({ tokenBudget: budget })),
      'summary',
      { paperId: paper.id },
    );

    expect(fake.calls.length).toBe(expectedCalls);
    expect(fake.calls.length).toBeGreaterThanOrEqual(3);

    for (let index = 0; index < chunks.length; index += 1) {
      const [miniSystem, miniUser] = fake.calls[index];
      expect(textOf(miniSystem)).toBe(SUMMARY_MINI_SYSTEM_PROMPT);
      for (const page of chunks[index]) {
        expect(textOf(miniUser)).toContain(`[第 ${page.pageNo} 页]`);
      }
    }

    const finalCall = fake.calls.at(-1);
    expect(finalCall).toBeDefined();
    expect(textOf(finalCall![0])).toBe(SUMMARY_SYSTEM_PROMPT);
    const finalUser = textOf(finalCall![1]);
    for (let index = 1; index <= chunks.length; index += 1) {
      expect(finalUser).toContain(`分块摘要${index}`);
    }
    expect(finalUser).toContain(buildSummaryUserPrompt());

    expect(note).toMatchObject({
      paperId: paper.id,
      type: 'summary',
      title: '《长论文》核心思想总结',
      contentMd: '最终总结',
    });
  });

  it('论文不存在时返回 null 且不调用 AI', async () => {
    const fake = createFakeComplete('不应调用');

    const note = await generateNote(makeDeps(fake.ai), 'summary', {
      paperId: 999,
    });

    expect(note).toBeNull();
    expect(fake.calls).toHaveLength(0);
  });

  it('AI 调用失败时抛出错误且不保存笔记', async () => {
    const paper = makePaper();
    seedPages(paper.id, [{ pageNo: 1, text: '第一页内容' }]);
    const ai: Pick<AiClient, 'complete'> = {
      async complete() {
        throw new Error('请求过于频繁或额度不足');
      },
    };

    await expect(
      generateNote(makeDeps(ai), 'summary', { paperId: paper.id }),
    ).rejects.toThrow('请求过于频繁或额度不足');
    expect(db.prepare('SELECT COUNT(*) AS count FROM notes').get()).toEqual({
      count: 0,
    });
  });
});

describe('generateNote concept', () => {
  it('使用整篇论文与选文生成概念卡，标题为概念名', async () => {
    const paper = makePaper('Transformer 综述');
    seedPages(paper.id, [
      { pageNo: 1, text: '第一页内容' },
      { pageNo: 2, text: '第二页介绍注意力机制' },
      { pageNo: 3, text: '第三页再次讨论注意力机制' },
    ]);
    const fake = createFakeComplete('概念讲解');

    const note = await generateNote(makeDeps(fake.ai), 'concept', {
      paperId: paper.id,
      conceptTitle: '注意力机制',
      selectionText: '注意力机制是……',
      currentPageNo: 2,
    });

    expect(note).toMatchObject({
      paperId: paper.id,
      type: 'concept',
      title: '注意力机制',
      contentMd: '概念讲解',
    });
    expect(fake.calls).toHaveLength(1);
    const [system, user] = fake.calls[0];
    expect(textOf(user)).toContain('注意力机制');
    expect(textOf(system)).toContain(DEPTH_SYSTEM_PROMPT);
    expect(textOf(system)).toContain('[第 1 页]');
    expect(textOf(system)).toContain('[第 2 页]');
    expect(textOf(system)).toContain('第二页介绍注意力机制');
    expect(textOf(system)).toContain('[第 3 页]');
    expect(textOf(system)).toContain('注意力机制是……');
  });

  it('全文超出预算时保留当前页并检索概念出现的其他页面', async () => {
    const paper = makePaper('长文');
    const filler = (marker: string) => `${marker}${'无关内容'.repeat(400)}`;
    seedPages(paper.id, [
      { pageNo: 1, text: filler('第一页') },
      { pageNo: 2, text: '第二页介绍注意力机制的定义' },
      { pageNo: 3, text: filler('第三页') },
      { pageNo: 4, text: '第四页讨论注意力机制的应用' },
      { pageNo: 5, text: filler('第五页') },
    ]);
    const fake = createFakeComplete('概念讲解');

    const note = await generateNote(
      makeDeps(fake.ai, makeSettings({ tokenBudget: 700 })),
      'concept',
      {
        paperId: paper.id,
        conceptTitle: '注意力机制',
        selectionText: '注意力机制是……',
        currentPageNo: 2,
      },
    );

    expect(note).not.toBeNull();
    expect(fake.calls).toHaveLength(1);
    const system = textOf(fake.calls[0][0]);
    expect(system).toContain(DEPTH_SYSTEM_PROMPT);
    expect(system).toContain('[第 2 页]');
    expect(system).toContain('第二页介绍注意力机制的定义');
    expect(system).toContain('[第 4 页]');
    expect(system).toContain('第四页讨论注意力机制的应用');
    // Only the current page and pages that mention the concept fit the budget.
    expect(system).not.toContain('[第 1 页]');
    expect(system).not.toContain('[第 3 页]');
    expect(system).not.toContain('[第 5 页]');
  });

  it('AI 请求超时时抛出「请求超时」且不保存笔记', async () => {
    const paper = makePaper();
    seedPages(paper.id, [{ pageNo: 1, text: '第一页内容' }]);
    vi.stubGlobal('fetch', () => new Promise<Response>(() => undefined));
    const ai = new AiClient(
      () => ({
        baseUrl: 'http://127.0.0.1:1',
        apiKey: 'sk-test',
        chatModel: 'chat-model',
        visionModel: 'vision-model',
        temperature: 0.3,
      }),
      10,
    );

    await expect(
      generateNote(makeDeps(ai), 'summary', { paperId: paper.id }),
    ).rejects.toThrow('请求超时');
    expect(db.prepare('SELECT COUNT(*) AS count FROM notes').get()).toEqual({
      count: 0,
    });
  });

  it('未提供概念名时取选文首行前 30 字，缺失时回退为“概念”', async () => {
    const paper = makePaper();
    seedPages(paper.id, [{ pageNo: 1, text: '第一页内容' }]);
    const fake = createFakeComplete('概念讲解');
    const longLine = '概'.repeat(25) + '念'.repeat(25);

    const fromSelection = await generateNote(makeDeps(fake.ai), 'concept', {
      paperId: paper.id,
      selectionText: `  ${longLine}\n第二行不应采用`,
      currentPageNo: 1,
    });
    expect(fromSelection?.title).toBe('概'.repeat(25) + '念'.repeat(5));

    const fallback = await generateNote(makeDeps(fake.ai), 'concept', {
      paperId: paper.id,
      currentPageNo: 1,
    });
    expect(fallback?.title).toBe('概念');
  });
});

describe('generateNote innovation', () => {
  it('注入共享标签的笔记并保存为 idea 笔记', async () => {
    const paper = makePaper('有限元方法综述', ['有限元']);
    seedPages(paper.id, [{ pageNo: 1, text: '第一页内容' }]);
    createNote(db, {
      paperId: paper.id,
      type: 'manual',
      title: '笔记甲',
      contentMd: '甲内容',
      tags: ['有限元'],
    });
    createNote(db, {
      paperId: paper.id,
      type: 'manual',
      title: '笔记乙',
      contentMd: '乙内容',
      tags: ['有限元'],
    });
    const fake = createFakeComplete('创新分析');

    const note = await generateNote(makeDeps(fake.ai), 'innovation', {
      paperId: paper.id,
      conceptTitle: '单元刚度矩阵',
      selectionText: '选文内容',
      currentPageNo: 1,
    });

    expect(note).toMatchObject({
      paperId: paper.id,
      type: 'idea',
      title: '《有限元方法综述》创新点分析',
      contentMd: '创新分析',
      tags: ['有限元'],
    });
    expect(fake.calls).toHaveLength(1);
    const [system, user] = fake.calls[0];
    expect(textOf(user)).toContain('笔记甲');
    expect(textOf(user)).toContain('笔记乙');
    expect(textOf(system)).toContain(INNOVATION_SYSTEM_PROMPT);
    expect(textOf(system)).toContain('第一页内容');
  });

  it('全文超出预算时只注入检索到的页面', async () => {
    const paper = makePaper('长文');
    seedPages(
      paper.id,
      [1, 2, 3, 4, 5].map((pageNo) => ({
        pageNo,
        text: `第${pageNo}页` + '长'.repeat(200),
      })),
    );
    const fake = createFakeComplete('创新分析');

    const note = await generateNote(
      makeDeps(fake.ai, makeSettings({ tokenBudget: 300 })),
      'innovation',
      { paperId: paper.id, currentPageNo: 3, selectionText: '第三页内容' },
    );

    expect(note).not.toBeNull();
    expect(fake.calls).toHaveLength(1);
    const system = textOf(fake.calls[0][0]);
    expect(system).toContain(INNOVATION_SYSTEM_PROMPT);
    expect(system).toContain('[第 3 页]');
    expect(system).toContain('第3页');
    expect(system).not.toContain('[第 1 页]');
    expect(system).not.toContain('[第 2 页]');
  });
});
