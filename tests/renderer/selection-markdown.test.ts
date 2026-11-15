// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  readAssistantSelection,
  serializeRange,
} from '@renderer/lib/selection-markdown';

function assistantArticle(id: number, markdownHtml: string): HTMLElement {
  const article = document.createElement('article');
  article.className = 'chat-message chat-message-assistant';
  article.dataset['messageId'] = String(id);
  article.innerHTML = `<div class="chat-message-role">AI</div><div class="markdown-view">${markdownHtml}</div>`;
  return article;
}

function selectRange(
  startNode: Node,
  startOffset: number,
  endNode: Node,
  endOffset: number,
): Range {
  const range = document.createRange();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);
  const selection = window.getSelection();
  if (selection === null) {
    throw new Error('jsdom selection unavailable');
  }
  selection.removeAllRanges();
  selection.addRange(range);
  return range;
}

beforeEach(() => {
  document.body.innerHTML = '';
  // jsdom leaves Range client rects at zero; keep the API deterministic for
  // tests that inspect popup placement.
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      left: 10,
      top: 20,
      right: 110,
      bottom: 40,
      width: 100,
      height: 20,
      x: 10,
      y: 20,
      toJSON: () => ({}),
    }),
  });
});

afterEach(() => {
  window.getSelection()?.removeAllRanges();
  document.body.innerHTML = '';
});

describe('serializeRange', () => {
  it('serializes inline text, bold, inline code, and formulas', () => {
    const article = assistantArticle(
      1,
      '<p>前 <span class="markdown-math" aria-label="x^2"><span class="katex">x²</span></span> 后 <strong>重点</strong> 和 <code>useState</code></p>',
    );
    document.body.appendChild(article);
    const paragraph = article.querySelector('p');
    if (paragraph === null) {
      throw new Error('missing paragraph');
    }

    const markdown = serializeRange(selectRange(paragraph, 0, paragraph, paragraph.childNodes.length));

    expect(markdown).toBe('前 $x^2$ 后 **重点** 和 `useState`');
  });

  it('serializes a partial selection inside a formula as the whole formula', () => {
    const article = assistantArticle(
      1,
      '<p>看 <span class="markdown-math" aria-label="\\frac{a}{b}"><span class="katex">ab</span></span> 这里</p>',
    );
    document.body.appendChild(article);
    const katexText = article.querySelector('.katex')?.firstChild;
    if (katexText === null || katexText === undefined) {
      throw new Error('missing katex text');
    }

    const markdown = serializeRange(selectRange(katexText, 0, katexText, 1));

    expect(markdown).toBe('$\\frac{a}{b}$');
  });

  it('serializes display formulas, code fences, and lists', () => {
    const article = assistantArticle(
      1,
      '<div class="markdown-math-block"><span class="markdown-math markdown-math-display" aria-label="a^2+b^2=c^2"><span class="katex">rendered</span></span></div>' +
        '<pre class="markdown-code"><code>const a = 1;\n\nconst b = 2;</code></pre>' +
        '<ul class="markdown-list"><li>甲</li><li>乙</li></ul>',
    );
    document.body.appendChild(article);
    const view = article.querySelector('.markdown-view');
    if (view === null) {
      throw new Error('missing markdown view');
    }

    const markdown = serializeRange(selectRange(view, 0, view, view.childNodes.length));

    expect(markdown).toContain('$$\na^2+b^2=c^2\n$$');
    expect(markdown).toContain('```\nconst a = 1;\n\nconst b = 2;\n```');
    expect(markdown).toContain('- 甲\n- 乙');
  });

  it('uses the MathML annotation when aria-label is absent', () => {
    const article = assistantArticle(
      1,
      '<p><span class="katex"><span class="katex-mathml"><math><semantics><annotation encoding="application/x-tex">y = mx + b</annotation></semantics></math></span>y=mx+b</span></p>',
    );
    document.body.appendChild(article);
    const paragraph = article.querySelector('p');
    if (paragraph === null) {
      throw new Error('missing paragraph');
    }

    const markdown = serializeRange(selectRange(paragraph, 0, paragraph, 1));

    expect(markdown).toBe('$y = mx + b$');
  });

  it('falls back to selected text when the fragment has no known structure', () => {
    const article = assistantArticle(1, '<p>普通文字</p>');
    document.body.appendChild(article);
    const text = article.querySelector('p')?.firstChild;
    if (text === null || text === undefined) {
      throw new Error('missing text');
    }

    expect(serializeRange(selectRange(text, 1, text, 3))).toBe('通文');
  });
});

describe('readAssistantSelection', () => {
  it('returns the markdown and message id for a selection in an AI answer', () => {
    const article = assistantArticle(42, '<p>这是一段回答</p>');
    document.body.appendChild(article);
    const text = article.querySelector('p')?.firstChild;
    if (text === null || text === undefined) {
      throw new Error('missing text');
    }

    selectRange(text, 2, text, 6);
    const selection = readAssistantSelection();

    expect(selection).not.toBeNull();
    expect(selection?.messageId).toBe(42);
    expect(selection?.markdown).toBe('一段回答');
    expect(selection?.rect.left).toBe(10);
  });

  it('ignores selections outside assistant messages', () => {
    const article = document.createElement('article');
    article.className = 'chat-message chat-message-user';
    article.dataset['messageId'] = '1';
    article.innerHTML = '<div class="markdown-view"><p>我的问题</p></div>';
    document.body.appendChild(article);
    const text = article.querySelector('p')?.firstChild;
    if (text === null || text === undefined) {
      throw new Error('missing text');
    }

    selectRange(text, 0, text, 2);

    expect(readAssistantSelection()).toBeNull();
  });

  it('ignores selections spanning two assistant messages', () => {
    const first = assistantArticle(1, '<p>第一条</p>');
    const second = assistantArticle(2, '<p>第二条</p>');
    document.body.append(first, second);
    const firstText = first.querySelector('p')?.firstChild;
    const secondText = second.querySelector('p')?.firstChild;
    if (firstText === null || firstText === undefined || secondText === null || secondText === undefined) {
      throw new Error('missing text');
    }

    selectRange(firstText, 0, secondText, 2);

    expect(readAssistantSelection()).toBeNull();
  });

  it('ignores the per-answer action row', () => {
    const article = assistantArticle(
      1,
      '<p>回答</p><div class="chat-message-actions"><button class="chat-note-button">存为笔记</button></div>',
    );
    document.body.appendChild(article);
    const buttonText = article.querySelector('button')?.firstChild;
    if (buttonText === null || buttonText === undefined) {
      throw new Error('missing button text');
    }

    selectRange(buttonText, 0, buttonText, 2);

    expect(readAssistantSelection()).toBeNull();
  });

  it('ignores collapsed selections', () => {
    const article = assistantArticle(1, '<p>回答</p>');
    document.body.appendChild(article);
    const text = article.querySelector('p')?.firstChild;
    if (text === null || text === undefined) {
      throw new Error('missing text');
    }
    selectRange(text, 1, text, 1);

    expect(readAssistantSelection()).toBeNull();
  });
});
