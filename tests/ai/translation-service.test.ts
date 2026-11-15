import { describe, expect, it, vi } from 'vitest';
import type { AiMessage } from '@main/ai/client';
import { translateSelection } from '@main/ai/translation-service';
import type { TranslationDeps } from '@main/ai/translation-service';

interface FakeComplete {
  complete: ReturnType<typeof vi.fn>;
  deps: TranslationDeps;
}

function makeDeps(
  responder: string | ((messages: AiMessage[]) => string | Promise<string>) = '损失函数',
  configured = true,
): FakeComplete {
  const complete = vi.fn(async (messages: AiMessage[]) =>
    typeof responder === 'string' ? responder : responder(messages),
  );
  return {
    complete,
    deps: {
      complete,
      isConfigured: () => configured,
    },
  };
}

function systemPromptOf(complete: ReturnType<typeof vi.fn>): string {
  const messages = complete.mock.calls[0][0] as AiMessage[];
  expect(messages[0].role).toBe('system');
  return typeof messages[0].content === 'string' ? messages[0].content : '';
}

describe('translateSelection', () => {
  it('trims the selection and calls the chat model with 0.2 temperature and a 60s timeout', async () => {
    const { complete, deps } = makeDeps();

    const result = await translateSelection(deps, { text: '  loss function  ' });

    expect(result).toEqual({ translation: '损失函数', targetLang: 'zh-CN' });
    expect(complete).toHaveBeenCalledWith(
      [
        expect.objectContaining({ role: 'system' }),
        { role: 'user', content: 'loss function' },
      ],
      { temperature: 0.2, timeoutMs: 60_000 },
    );
    expect(systemPromptOf(complete)).toBe(
      '你是专业的学术翻译。把用户提供的文本翻译成简体中文。只输出译文，保留公式、符号、术语与数字，不解释、不加引号。',
    );
  });

  it('rejects an empty selection before consulting configuration or the model', async () => {
    const isConfigured = vi.fn(() => true);
    const complete = vi.fn(async () => '译文');

    await expect(
      translateSelection({ complete, isConfigured }, { text: '   \n\t ' }),
    ).rejects.toThrow('请先选择要翻译的文本');
    expect(isConfigured).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
  });

  it('rejects more than 6000 code points as too long, before the configuration check', async () => {
    const isConfigured = vi.fn(() => false);
    const complete = vi.fn(async () => '译文');

    await expect(
      translateSelection({ complete, isConfigured }, { text: 'x'.repeat(6001) }),
    ).rejects.toThrow('选中文本过长，请分段翻译');
    expect(isConfigured).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
  });

  it('counts code points rather than UTF-16 units for the length limit', async () => {
    const { deps } = makeDeps();
    // 6000 emoji are 12000 UTF-16 units but exactly 6000 code points.
    await expect(translateSelection(deps, { text: '😀'.repeat(6001) })).rejects.toThrow(
      '选中文本过长，请分段翻译',
    );

    const accepted = makeDeps('译文');
    await expect(
      translateSelection(accepted.deps, { text: '😀'.repeat(6000) }),
    ).resolves.toEqual({ translation: '译文', targetLang: 'zh-CN' });
  });

  it('rejects an unconfigured AI without calling the model', async () => {
    const { complete, deps } = makeDeps('译文', false);

    await expect(translateSelection(deps, { text: 'hello' })).rejects.toThrow(
      '请先在设置中配置 AI 接口',
    );
    expect(complete).not.toHaveBeenCalled();
  });

  it('rejects an empty model answer distinctly', async () => {
    const { deps } = makeDeps('   ');

    await expect(translateSelection(deps, { text: 'loss' })).rejects.toThrow(
      '翻译结果为空，请重试',
    );
  });

  it('hides provider details behind a generic failure message', async () => {
    const { deps } = makeDeps(async () => {
      throw new Error('请求失败（HTTP 500）：relay exploded for sk-secret at https://relay/v1');
    });

    const error = await translateSelection(deps, { text: 'loss' }).then(
      () => null,
      (reason: unknown) => reason,
    );

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('翻译失败，请稍后重试');
    expect((error as Error).message).not.toContain('sk-secret');
    expect((error as Error).message).not.toContain('https://relay/v1');
  });

  it('sends an English target prompt for CJK source text', async () => {
    const { complete, deps } = makeDeps('Please explain this loss function.');

    const result = await translateSelection(deps, { text: '请解释这个损失函数。' });

    expect(result).toEqual({
      translation: 'Please explain this loss function.',
      targetLang: 'en',
    });
    expect(systemPromptOf(complete)).toBe(
      '你是专业的学术翻译。把用户提供的文本翻译成English。只输出译文，保留公式、符号、术语与数字，不解释、不加引号。',
    );
  });
});
