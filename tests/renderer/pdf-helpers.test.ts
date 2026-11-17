// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildPageWindow,
  clampPage,
  findInDocument,
  getSelectionInPage,
} from '@renderer/lib/pdf';

interface FakeTextItem {
  str?: string;
}

interface FakeTextPage {
  getTextContent(): Promise<{ items: FakeTextItem[] }>;
}

function makeFakePdf(pages: FakeTextItem[][]) {
  const getPage = vi.fn(
    async (pageNo: number): Promise<FakeTextPage> => ({
      getTextContent: async () => ({ items: pages[pageNo - 1] ?? [] }),
    }),
  );
  return { numPages: pages.length, getPage };
}

afterEach(() => {
  window.getSelection()?.removeAllRanges();
  document.body.replaceChildren();
});

describe('buildPageWindow', () => {
  it('以当前页为中心返回半径内的页码', () => {
    expect(buildPageWindow(5, 10, 2)).toEqual([3, 4, 5, 6, 7]);
  });

  it('首页与末页按边界裁剪', () => {
    expect(buildPageWindow(1, 10, 2)).toEqual([1, 2, 3]);
    // Binding ruling formula: [max(1, c-radius) … min(pageCount, c+radius)].
    expect(buildPageWindow(9, 10, 2)).toEqual([7, 8, 9, 10]);
    expect(buildPageWindow(10, 10, 2)).toEqual([8, 9, 10]);
  });

  it('没有任何页面时返回空数组', () => {
    expect(buildPageWindow(1, 0, 2)).toEqual([]);
    expect(buildPageWindow(1, -3, 2)).toEqual([]);
  });

  it('越界的当前页先被钳制到合法范围', () => {
    expect(buildPageWindow(99, 10, 1)).toEqual([9, 10]);
    expect(buildPageWindow(0, 10, 1)).toEqual([1, 2]);
  });
});

describe('clampPage', () => {
  it('把页码钳制在 1 到总页数之间', () => {
    expect(clampPage(0, 10)).toBe(1);
    expect(clampPage(99, 10)).toBe(10);
    expect(clampPage(5, 10)).toBe(5);
    expect(clampPage(-4, 10)).toBe(1);
  });

  it('小数页码四舍五入', () => {
    expect(clampPage(5.4, 10)).toBe(5);
    expect(clampPage(5.6, 10)).toBe(6);
  });

  it('非有限页码与空文档返回第 1 页', () => {
    expect(clampPage(Number.NaN, 10)).toBe(1);
    expect(clampPage(Number.POSITIVE_INFINITY, 10)).toBe(1);
    expect(clampPage(3, 0)).toBe(1);
  });
});

describe('findInDocument', () => {
  it('返回包含关键词的页码（大小写不敏感）', async () => {
    const pdf = makeFakePdf([
      [{ str: '引言：有限元空间' }, { str: '的构造' }],
      [{ str: 'nothing here' }],
    ]);

    await expect(findInDocument(pdf, '有限元空间')).resolves.toEqual([1]);
    await expect(findInDocument(pdf, 'NOTHING')).resolves.toEqual([2]);
  });

  it('把同一页的多个文本片段拼接后再匹配', async () => {
    const pdf = makeFakePdf([[{ str: 'Paper' }, {}, { str: 'Lens' }]]);

    await expect(findInDocument(pdf, 'paperlens')).resolves.toEqual([1]);
  });

  it('空查询返回空数组且不访问任何页面', async () => {
    const pdf = makeFakePdf([[{ str: '有限元空间' }]]);

    await expect(findInDocument(pdf, '   ')).resolves.toEqual([]);
    expect(pdf.getPage).not.toHaveBeenCalled();
  });
});

describe('getSelectionInPage', () => {
  it('返回页面内的选中文本', () => {
    const pageRoot = document.createElement('div');
    pageRoot.textContent = '有限元空间';
    document.body.append(pageRoot);

    const range = document.createRange();
    range.selectNodeContents(pageRoot);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    const selected = getSelectionInPage(pageRoot);
    expect(selected).toMatchObject({ text: '有限元空间' });
    expect(selected?.range).toBeInstanceOf(Range);
  });

  it('没有选区或选区在页面之外时返回 null', () => {
    const pageRoot = document.createElement('div');
    pageRoot.textContent = '页内文本';
    const outside = document.createElement('p');
    outside.textContent = '页外文本';
    document.body.append(pageRoot, outside);

    const selection = window.getSelection();
    selection?.removeAllRanges();
    expect(getSelectionInPage(pageRoot)).toBeNull();

    const range = document.createRange();
    range.selectNodeContents(outside);
    selection?.addRange(range);
    expect(getSelectionInPage(pageRoot)).toBeNull();
  });
});
