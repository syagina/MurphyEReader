import { describe, expect, it } from 'vitest';
import { parseCitations } from '@renderer/lib/citations';

describe('parseCitations', () => {
  it('把 [p.N] 拆成可点击的引用段', () => {
    expect(parseCitations('见 [p.3] 与 [p.12]')).toEqual([
      { type: 'text', text: '见 ' },
      { type: 'cite', pageNo: 3 },
      { type: 'text', text: ' 与 ' },
      { type: 'cite', pageNo: 12 },
    ]);
  });

  it('没有引用的纯文本返回单个文本段', () => {
    expect(parseCitations('这是一段普通文字。')).toEqual([
      { type: 'text', text: '这是一段普通文字。' },
    ]);
  });

  it('大写 P 不识别，按原文保留', () => {
    expect(parseCitations('见 [P.3]')).toEqual([{ type: 'text', text: '见 [P.3]' }]);
  });

  it('相邻引用之间不产生空文本段', () => {
    expect(parseCitations('[p.1][p.2]')).toEqual([
      { type: 'cite', pageNo: 1 },
      { type: 'cite', pageNo: 2 },
    ]);
  });

  it('引用位于文本开头或结尾时也能正确切分', () => {
    expect(parseCitations('[p.7]结论见 [p.9]')).toEqual([
      { type: 'cite', pageNo: 7 },
      { type: 'text', text: '结论见 ' },
      { type: 'cite', pageNo: 9 },
    ]);
  });

  it('空字符串返回空数组', () => {
    expect(parseCitations('')).toEqual([]);
  });
});
