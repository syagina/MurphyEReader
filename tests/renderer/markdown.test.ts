import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '@renderer/lib/markdown';

describe('parseMarkdown', () => {
  it('解析段落并把换行保留为 break 段', () => {
    expect(parseMarkdown('第一行\n第二行\n\n新段落')).toEqual([
      {
        type: 'paragraph',
        children: [
          { type: 'text', text: '第一行' },
          { type: 'break' },
          { type: 'text', text: '第二行' },
        ],
      },
      { type: 'paragraph', children: [{ type: 'text', text: '新段落' }] },
    ]);
  });

  it('解析围栏代码块（含语言标记），内部不做行内解析', () => {
    expect(parseMarkdown('```ts\nconst a = 1;\n**不加粗**\n```')).toEqual([
      { type: 'codeBlock', lang: 'ts', text: 'const a = 1;\n**不加粗**' },
    ]);
  });

  it('未闭合的围栏代码块读到文末', () => {
    expect(parseMarkdown('```\nlet x = 1;')).toEqual([
      { type: 'codeBlock', lang: '', text: 'let x = 1;' },
    ]);
  });

  it('解析行内代码', () => {
    expect(parseMarkdown('使用 `useState` 钩子')).toEqual([
      {
        type: 'paragraph',
        children: [
          { type: 'text', text: '使用 ' },
          { type: 'code', text: 'useState' },
          { type: 'text', text: ' 钩子' },
        ],
      },
    ]);
  });

  it('解析粗体，并允许粗体内包含行内代码', () => {
    expect(parseMarkdown('**重点**和**使用 `x`**')).toEqual([
      {
        type: 'paragraph',
        children: [
          { type: 'bold', children: [{ type: 'text', text: '重点' }] },
          { type: 'text', text: '和' },
          {
            type: 'bold',
            children: [
              { type: 'text', text: '使用 ' },
              { type: 'code', text: 'x' },
            ],
          },
        ],
      },
    ]);
  });

  it('解析标题', () => {
    expect(parseMarkdown('## 方法')).toEqual([
      { type: 'heading', level: 2, children: [{ type: 'text', text: '方法' }] },
    ]);
    expect(parseMarkdown('# 一级\n###### 六级')).toEqual([
      { type: 'heading', level: 1, children: [{ type: 'text', text: '一级' }] },
      { type: 'heading', level: 6, children: [{ type: 'text', text: '六级' }] },
    ]);
  });

  it('解析无序列表', () => {
    expect(parseMarkdown('- 甲\n- 乙')).toEqual([
      {
        type: 'list',
        ordered: false,
        items: [[{ type: 'text', text: '甲' }], [{ type: 'text', text: '乙' }]],
      },
    ]);
  });

  it('解析有序列表', () => {
    expect(parseMarkdown('1. 第一\n2. 第二')).toEqual([
      {
        type: 'list',
        ordered: true,
        items: [[{ type: 'text', text: '第一' }], [{ type: 'text', text: '第二' }]],
      },
    ]);
  });

  it('列表在空行或其他块开始时结束', () => {
    expect(parseMarkdown('- 甲\n普通段落')).toEqual([
      { type: 'list', ordered: false, items: [[{ type: 'text', text: '甲' }]] },
      { type: 'paragraph', children: [{ type: 'text', text: '普通段落' }] },
    ]);
  });

  it('未知语法按原文渲染', () => {
    expect(parseMarkdown('*斜体* 与 [链接](https://example.com)')).toEqual([
      {
        type: 'paragraph',
        children: [{ type: 'text', text: '*斜体* 与 [链接](https://example.com)' }],
      },
    ]);
  });

  it('原始 HTML 标签保留为纯文本，不会被解析为标记', () => {
    expect(parseMarkdown('<script>alert("x")</script>')).toEqual([
      {
        type: 'paragraph',
        children: [{ type: 'text', text: '<script>alert("x")</script>' }],
      },
    ]);
    expect(parseMarkdown('# <b>标题</b>')).toEqual([
      { type: 'heading', level: 1, children: [{ type: 'text', text: '<b>标题</b>' }] },
    ]);
  });

  it('未闭合的粗体与行内代码按原文保留', () => {
    expect(parseMarkdown('**未闭合 和 `代码')).toEqual([
      { type: 'paragraph', children: [{ type: 'text', text: '**未闭合 和 `代码' }] },
    ]);
  });

  it('解析单行 display 公式', () => {
    expect(
      parseMarkdown('$$\\mathcal{L}(x) = \\mathcal{L}_{rec} - \\frac{\\beta}{2}\\mathcal{L}_{KL}$$'),
    ).toEqual([
      {
        type: 'mathBlock',
        text: '\\mathcal{L}(x) = \\mathcal{L}_{rec} - \\frac{\\beta}{2}\\mathcal{L}_{KL}',
      },
    ]);
  });

  it('解析跨行 display 公式与 \\[ ... \\] 形式', () => {
    expect(parseMarkdown('$$\na + b\n= c\n$$')).toEqual([
      { type: 'mathBlock', text: 'a + b\n= c' },
    ]);
    expect(parseMarkdown('\\[\nx^2\n\\]')).toEqual([{ type: 'mathBlock', text: 'x^2' }]);
  });

  it('解析行内 $ 与 \\( \\) 公式', () => {
    expect(parseMarkdown('当 $a^2+b^2=c^2$ 时，\\(x>0\\)。')).toEqual([
      {
        type: 'paragraph',
        children: [
          { type: 'text', text: '当 ' },
          { type: 'math', text: 'a^2+b^2=c^2', display: false },
          { type: 'text', text: ' 时，' },
          { type: 'math', text: 'x>0', display: false },
          { type: 'text', text: '。' },
        ],
      },
    ]);
  });

  it('行内 $$ 公式标记为 display', () => {
    expect(parseMarkdown('前 $$x$$ 后')).toEqual([
      {
        type: 'paragraph',
        children: [
          { type: 'text', text: '前 ' },
          { type: 'math', text: 'x', display: true },
          { type: 'text', text: ' 后' },
        ],
      },
    ]);
  });

  it('货币金额、未闭合公式与代码块内的 $ 保持原文', () => {
    expect(parseMarkdown('花费 $5 和 $10')).toEqual([
      { type: 'paragraph', children: [{ type: 'text', text: '花费 $5 和 $10' }] },
    ]);
    expect(parseMarkdown('公式 $x+1 未闭合')).toEqual([
      { type: 'paragraph', children: [{ type: 'text', text: '公式 $x+1 未闭合' }] },
    ]);
    expect(parseMarkdown('```\n$$x$$\n```')).toEqual([
      { type: 'codeBlock', lang: '', text: '$$x$$' },
    ]);
  });

  it('转义的美元符号保持为普通文本', () => {
    expect(parseMarkdown('价格 \\$5')).toEqual([
      { type: 'paragraph', children: [{ type: 'text', text: '价格 $5' }] },
    ]);
  });

  it('公式内允许使用粗体解析器不误伤的下划线等 LaTeX 语法', () => {
    expect(parseMarkdown('$\\mathbb{E}[X]=\\sum_i x_i p_i$')).toEqual([
      {
        type: 'paragraph',
        children: [
          { type: 'math', text: '\\mathbb{E}[X]=\\sum_i x_i p_i', display: false },
        ],
      },
    ]);
  });

  it('空文本与纯空白返回空数组', () => {
    expect(parseMarkdown('')).toEqual([]);
    expect(parseMarkdown('  \n\n')).toEqual([]);
  });

  it('还原 CRLF 换行', () => {
    expect(parseMarkdown('第一行\r\n第二行')).toEqual([
      {
        type: 'paragraph',
        children: [
          { type: 'text', text: '第一行' },
          { type: 'break' },
          { type: 'text', text: '第二行' },
        ],
      },
    ]);
  });
});
