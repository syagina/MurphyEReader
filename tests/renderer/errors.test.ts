import { describe, expect, it } from 'vitest';
import { stripIpcErrorPrefix } from '@renderer/lib/errors';

describe('stripIpcErrorPrefix', () => {
  it('去掉 Electron 远程调用前缀与内部的 Error 标记', () => {
    expect(
      stripIpcErrorPrefix(
        "Error invoking remote method 'translation:warmup': Error: 未检测到 BabelDOC，请在设置中安装或指定路径",
      ),
    ).toBe('未检测到 BabelDOC，请在设置中安装或指定路径');
  });

  it('前缀没有内部 Error 标记时同样去掉', () => {
    expect(
      stripIpcErrorPrefix(
        "Error invoking remote method 'translation:install': 请先等待当前任务完成",
      ),
    ).toBe('请先等待当前任务完成');
  });

  it('没有前缀的中文消息原样返回', () => {
    expect(stripIpcErrorPrefix('无法运行该翻译引擎，请重新选择')).toBe(
      '无法运行该翻译引擎，请重新选择',
    );
  });

  it('未知消息原样返回，且只匹配开头的前缀', () => {
    expect(stripIpcErrorPrefix('boom')).toBe('boom');
    const embedded = "前缀 Error invoking remote method 'x': Error: boom";
    expect(stripIpcErrorPrefix(embedded)).toBe(embedded);
  });
});
