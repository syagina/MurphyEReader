import { describe, expect, it } from 'vitest';
import { parseTags } from '@renderer/lib/format';

describe('parseTags', () => {
  it('按中英文逗号拆分并去掉空白项', () => {
    expect(parseTags('弹性, 数值，有限元, ,')).toEqual(['弹性', '数值', '有限元']);
  });

  it('保留标签内部空格', () => {
    expect(parseTags(' 结构 优化 , fem')).toEqual(['结构 优化', 'fem']);
  });

  it('只有分隔符或空白时返回空数组', () => {
    expect(parseTags(' , ， ')).toEqual([]);
    expect(parseTags('')).toEqual([]);
  });
});
