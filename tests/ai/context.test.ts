import { describe, expect, it } from 'vitest';
import type { ChatMessage, Note, Paper, PaperPage } from '@shared/types';
import {
  assembleChatContext,
  buildPaperContextBlock,
  chunkPages,
  estimateTokens,
  retrieveRelevantPages,
  selectRelatedNotes,
} from '@main/ai/context';
import { ASK_SYSTEM_PROMPT } from '@main/ai/prompts';

function makePaper(overrides: Partial<Paper> = {}): Paper {
  return {
    id: 1,
    title: '有限元方法综述',
    authors: '张三, 李四',
    year: 2024,
    filePathOriginal: 'C:/papers/fe.pdf',
    filePathTranslated: null,
    pageCountOriginal: 3,
    pageCountTranslated: null,
    hasTextLayer: true,
    outline: [
      {
        title: '第一章 引言',
        pageNo: 1,
        children: [{ title: '1.1 背景', pageNo: 1, children: [] }],
      },
      { title: '第二章 方法', pageNo: 2, children: [] },
      { title: '附录', pageNo: null, children: [] },
    ],
    tags: ['有限元', '数值方法'],
    lastPageOriginal: 1,
    lastPageTranslated: 1,
    addedAt: 1000,
    lastReadAt: null,
    ...overrides,
  };
}

function makePages(texts: string[], paperId = 1): PaperPage[] {
  return texts.map((text, index) => ({ paperId, pageNo: index + 1, text }));
}

function makeMessage(
  id: number,
  role: ChatMessage['role'],
  content: string,
): ChatMessage {
  return {
    id,
    conversationId: 1,
    role,
    content,
    selectionText: null,
    pageNo: null,
    createdAt: id * 1000,
  };
}

function makeNote(overrides: Partial<Note> & Pick<Note, 'id'>): Note {
  return {
    paperId: 1,
    type: 'manual',
    title: `笔记${overrides.id}`,
    contentMd: '内容',
    tags: [],
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  };
}

describe('estimateTokens', () => {
  it('CJK 字符计 1，其余字符计 1/4，结果向上取整', () => {
    expect(estimateTokens('你好')).toBe(2);
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('a')).toBe(1);
    expect(estimateTokens('你好ab')).toBe(3);
    expect(estimateTokens('、、')).toBe(2);
  });

  it('增补平面字符按单个码点计 1/4，而不是按代理对计两次', () => {
    expect(estimateTokens('𠀀')).toBe(1);
  });
});

describe('buildPaperContextBlock', () => {
  it('包含标题/作者/年份、缩进目录、页块与选中文本', () => {
    const paper = makePaper();
    const pages = makePages(['第一页内容', '第二页内容']);

    const block = buildPaperContextBlock(paper, pages, '选中的句子', 2);

    expect(block).toContain('标题：有限元方法综述');
    expect(block).toContain('作者：张三, 李四');
    expect(block).toContain('年份：2024');
    expect(block).toContain('当前页：2');
    expect(block).toContain('第一章 引言（第 1 页）');
    expect(block).toContain('  - 1.1 背景（第 1 页）');
    expect(block).toContain('附录');
    expect(block).not.toContain('附录（第');
    expect(block).toContain('[第 1 页]\n第一页内容');
    expect(block).toContain('[第 2 页]\n第二页内容');
    expect(block).toContain('【选中文本】\n选中的句子');
  });

  it('无选中文本时不出现选中块；年份缺失显示未知；未给当前页时不标注', () => {
    const block = buildPaperContextBlock(
      makePaper({ year: null, outline: [] }),
      makePages(['内容']),
    );

    expect(block).not.toContain('【选中文本】');
    expect(block).toContain('年份：未知');
    expect(block).not.toContain('当前页：');
  });
});

describe('assembleChatContext 全文模式', () => {
  const question = '请总结全文';
  const pageTexts = ['中'.repeat(10), '中'.repeat(10), '中'.repeat(10)];

  it('预算充足时包含全部页面且 trimmed 为 false', () => {
    const result = assembleChatContext({
      paper: makePaper(),
      pages: makePages(pageTexts),
      history: [],
      question,
      fullTextMode: true,
      budgetTokens: 10_000,
    });

    expect(result.includedPageNos).toEqual([1, 2, 3]);
    expect(result.trimmed).toBe(false);
    expect(result.system.startsWith(ASK_SYSTEM_PROMPT)).toBe(true);
    expect(result.system).toContain('[第 3 页]');
    expect(result.messages.at(-1)).toEqual({ role: 'user', content: question });
  });

  it('超预算时保留当前页与选文、不含全部页面，并标记 trimmed', () => {
    const paper = makePaper();
    const pages = makePages(pageTexts);
    const selectionText = '这是选中的原文';
    const currentPageNo = 2;
    const onePageSystem = `${ASK_SYSTEM_PROMPT}\n\n${buildPaperContextBlock(
      paper,
      [pages[1]],
      selectionText,
      currentPageNo,
    )}`;
    const budgetTokens = estimateTokens(onePageSystem) + estimateTokens(question) + 2;

    const result = assembleChatContext({
      paper,
      pages,
      history: [],
      question,
      selectionText,
      currentPageNo,
      fullTextMode: true,
      budgetTokens,
    });

    expect(result.trimmed).toBe(true);
    expect(result.includedPageNos).toContain(currentPageNo);
    expect(result.includedPageNos).toHaveLength(1);
    expect(result.includedPageNos).not.toEqual([1, 2, 3]);
    expect(result.system).toContain('[第 2 页]');
    expect(result.system).toContain('【选中文本】');
    expect(result.system).toContain(selectionText);
  });

  it('页面全部装得下但历史超预算时只裁剪历史，trimmed 仍为 false', () => {
    const paper = makePaper();
    const pages = makePages(pageTexts);
    const fullSystem = `${ASK_SYSTEM_PROMPT}\n\n${buildPaperContextBlock(paper, pages)}`;
    const history = [
      makeMessage(1, 'user', '中'.repeat(50)),
      makeMessage(2, 'assistant', '中'.repeat(50)),
    ];

    const result = assembleChatContext({
      paper,
      pages,
      history,
      question,
      fullTextMode: true,
      budgetTokens: estimateTokens(fullSystem) + estimateTokens(question),
    });

    expect(result.trimmed).toBe(false);
    expect(result.includedPageNos).toEqual([1, 2, 3]);
    expect(result.messages).toEqual([{ role: 'user', content: question }]);
  });
});

describe('assembleChatContext 非全文模式', () => {
  it('只带当前页（缺省回退第 1 页），即使超预算也保留且 trimmed 恒为 false', () => {
    const paper = makePaper();
    const pages = makePages(['第一页', '第二页', '第三页']);

    const withCurrent = assembleChatContext({
      paper,
      pages,
      history: [],
      question: '这是什么',
      currentPageNo: 2,
      fullTextMode: false,
      budgetTokens: 1,
    });

    expect(withCurrent.includedPageNos).toEqual([2]);
    expect(withCurrent.system).toContain('[第 2 页]\n第二页');
    expect(withCurrent.system).not.toContain('[第 1 页]');
    expect(withCurrent.trimmed).toBe(false);

    const fallback = assembleChatContext({
      paper,
      pages,
      history: [],
      question: '这是什么',
      fullTextMode: false,
      budgetTokens: 1,
    });

    expect(fallback.includedPageNos).toEqual([1]);
    expect(fallback.system).toContain('[第 1 页]\n第一页');
    expect(fallback.trimmed).toBe(false);
  });
});

describe('assembleChatContext 历史裁剪', () => {
  it('保留最近的若干条历史，旧消息先被丢弃，question 始终在最后并计入预算', () => {
    const paper = makePaper();
    const pages = makePages(['当前页正文']);
    const question = '继续解释';
    const history = Array.from({ length: 10 }, (_, index) =>
      makeMessage(
        index + 1,
        index % 2 === 0 ? 'user' : 'assistant',
        `${String.fromCharCode(97 + index)}${'中'.repeat(10)}`,
      ),
    );
    const system = `${ASK_SYSTEM_PROMPT}\n\n${buildPaperContextBlock(paper, pages, undefined, 1)}`;
    const perMessageTokens = estimateTokens(history[0].content);
    const budgetTokens =
      estimateTokens(system) + estimateTokens(question) + 3 * perMessageTokens;

    const result = assembleChatContext({
      paper,
      pages,
      history,
      question,
      currentPageNo: 1,
      fullTextMode: false,
      budgetTokens,
    });

    expect(result.messages).toHaveLength(4);
    expect(result.messages.slice(0, 3)).toEqual(
      history.slice(-3).map((message) => ({
        role: message.role,
        content: message.content,
      })),
    );
    expect(result.messages.at(-1)).toEqual({ role: 'user', content: question });
    expect(result.trimmed).toBe(false);
  });
});

describe('retrieveRelevantPages', () => {
  const pages = makePages(['有限元 方法', '无关内容', '有限元 有限元 finite element']);

  it('按词项重合打分，当前页必选，返回结果按页码升序', () => {
    const result = retrieveRelevantPages(pages, '有限元 finite element', 10_000, 2);

    expect(result.map((page) => page.pageNo)).toEqual([1, 2, 3]);
  });

  it('预算为 0 时仍保留当前页', () => {
    const result = retrieveRelevantPages(pages, '有限元', 0, 2);

    expect(result.map((page) => page.pageNo)).toEqual([2]);
  });

  it('预算只够一页时优先加入得分最高的非当前页', () => {
    const forcedCost = estimateTokens(`[第 2 页]\n${pages[1].text}`);
    const bestCost = estimateTokens(`[第 3 页]\n${pages[2].text}`);

    const result = retrieveRelevantPages(
      pages,
      '有限元 finite element',
      forcedCost + bestCost,
      2,
    );

    expect(result.map((page) => page.pageNo)).toEqual([2, 3]);
  });

  it('拉丁词大小写不敏感，长度小于 2 的词与单个字母不当选', () => {
    const latinPages = makePages(['nothing here', 'FEM method']);
    const femCost = estimateTokens(`[第 2 页]\n${latinPages[1].text}`);

    const caseInsensitive = retrieveRelevantPages(latinPages, 'fem', femCost);
    expect(caseInsensitive.map((page) => page.pageNo)).toEqual([2]);

    const singleLetterPages = makePages(['nothing', 'a value']);
    const singleLetterCost = estimateTokens(`[第 1 页]\n${singleLetterPages[0].text}`);
    const singleLetter = retrieveRelevantPages(
      singleLetterPages,
      'a',
      singleLetterCost,
    );
    expect(singleLetter.map((page) => page.pageNo)).toEqual([1]);
  });
});

describe('chunkPages', () => {
  it('按页顺序贪心装箱：5 页各 4 token、预算 12 → 块大小 [3,2]', () => {
    const pages = makePages(Array.from({ length: 5 }, () => '中'.repeat(4)));

    const chunks = chunkPages(pages, 12);

    expect(chunks.map((chunk) => chunk.length)).toEqual([3, 2]);
    for (const chunk of chunks) {
      const totalTokens = chunk.reduce((sum, page) => sum + estimateTokens(page.text), 0);
      expect(totalTokens).toBeLessThanOrEqual(12);
    }
    expect(chunks.flat().map((page) => page.pageNo)).toEqual([1, 2, 3, 4, 5]);
  });

  it('单页自身超预算时独占一块，其余页继续按顺序装箱', () => {
    const pages = makePages(['中'.repeat(2), '中'.repeat(10), '中'.repeat(2)]);

    const chunks = chunkPages(pages, 4);

    expect(chunks.map((chunk) => chunk.map((page) => page.pageNo))).toEqual([
      [1],
      [2],
      [3],
    ]);
  });
});

describe('selectRelatedNotes', () => {
  const currentPaper = makePaper({ tags: ['有限元', '数值方法'] });
  const notes = [
    makeNote({ id: 1, title: '旧相关', contentMd: '相关内容一', tags: ['有限元'], updatedAt: 1000 }),
    makeNote({ id: 2, title: '最新无关', contentMd: '无关内容一', tags: ['实验'], updatedAt: 5000 }),
    makeNote({ id: 3, title: '新相关', contentMd: '相关内容二', tags: ['数值方法'], updatedAt: 3000 }),
    makeNote({ id: 4, title: '较新无关', contentMd: '无关内容二', tags: [], updatedAt: 4000 }),
  ];

  it('共享标签的笔记排前，组内按 updatedAt 倒序、id 倒序', () => {
    const result = selectRelatedNotes(notes, currentPaper, 1000);

    expect(result.map((note) => note.id)).toEqual([3, 1, 2, 4]);
  });

  it('按 maxChars 只收录完整笔记，超出预算的下一条不截断收录', () => {
    const result = selectRelatedNotes(notes, currentPaper, 16);

    expect(result.map((note) => note.id)).toEqual([3, 1]);
    const totalChars = result.reduce(
      (sum, note) => sum + note.title.length + note.contentMd.length,
      0,
    );
    expect(totalChars).toBeLessThanOrEqual(16);
  });

  it('updatedAt 相同的相关笔记按 id 倒序', () => {
    const tied = [
      makeNote({ id: 5, title: '甲', contentMd: '一', tags: ['有限元'], updatedAt: 2000 }),
      makeNote({ id: 2, title: '乙', contentMd: '二', tags: ['有限元'], updatedAt: 2000 }),
    ];

    expect(selectRelatedNotes(tied, currentPaper, 1000).map((note) => note.id)).toEqual([
      5, 2,
    ]);
  });
});
