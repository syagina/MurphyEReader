import { describe, expect, it } from 'vitest';
import { sanitizeFileNamePart } from '@shared/file-name';

describe('sanitizeFileNamePart', () => {
  it('保留普通标题', () => {
    expect(sanitizeFileNamePart('有限元方法导论', 'paper')).toBe('有限元方法导论');
  });

  it('把 Windows 非法字符与控制字符替换为下划线', () => {
    expect(sanitizeFileNamePart('A/B: C? <D>|E*F"G\\H\u0001', 'paper')).toBe(
      'A_B_ C_ _D_E_F_G_H',
    );
  });

  it('连续非法字符合并为一个下划线', () => {
    expect(sanitizeFileNamePart('a///b', 'paper')).toBe('a_b');
  });

  it('折叠空白并去掉首尾的空白、点和下划线', () => {
    expect(sanitizeFileNamePart('  .hello__   world.  ', 'paper')).toBe(
      'hello__ world',
    );
  });

  it('只有非法字符时返回 fallback', () => {
    expect(sanitizeFileNamePart(':?*"<>|/\\', 'paper')).toBe('paper');
    expect(sanitizeFileNamePart('', 'paper')).toBe('paper');
  });

  it('默认限制为 80 个字符', () => {
    expect(sanitizeFileNamePart('a'.repeat(100), 'paper')).toBe('a'.repeat(80));
  });

  it('支持自定义限制', () => {
    expect(sanitizeFileNamePart('x'.repeat(100), 'paper', 60)).toBe('x'.repeat(60));
    expect(sanitizeFileNamePart('a/b:c?', 'paper', 60)).toBe('a_b_c');
  });

  it('按 code point 截断，不拆分 emoji', () => {
    expect(sanitizeFileNamePart('😀'.repeat(70), 'paper', 60)).toBe('😀'.repeat(60));
    expect(sanitizeFileNamePart(`${'a'.repeat(58)}😀😀`, 'paper', 60)).toBe(
      `${'a'.repeat(58)}😀😀`,
    );
  });

  it('截断后再次去掉末尾的点和下划线', () => {
    expect(
      sanitizeFileNamePart(`${'x'.repeat(59)}  tail`, 'paper', 60),
    ).toBe('x'.repeat(59));
  });
});
