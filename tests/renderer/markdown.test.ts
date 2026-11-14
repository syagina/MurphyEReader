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

  it('未闭合的粗体与行内代码按原文保留', () => {
    expect(parseMarkdown('**未闭合 和 `代码')).toEqual([
      { type: 'paragraph', children: [{ type: 'text', text: '**未闭合 和 `代码' }] },
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
