import {
  TRANSLATION_EMPTY_RESULT,
  TRANSLATION_EMPTY_SELECTION,
  TRANSLATION_FAILED,
  TRANSLATION_MAX_CHARS,
  TRANSLATION_NOT_CONFIGURED,
  TRANSLATION_TARGET_LABELS,
  TRANSLATION_TOO_LONG,
  detectTranslationTarget,
} from '@shared/translation';
import type { SelectionTranslationResult, TranslationTarget } from '@shared/types';
import type { AiMessage } from './client';

export interface TranslationDeps {
  /** Non-streaming chat completion; the main process owns endpoint and key. */
  complete(
    messages: AiMessage[],
    opts: { temperature?: number; timeoutMs?: number },
  ): Promise<string>;
  isConfigured(): boolean;
}

export interface TranslationInput {
  text: string;
}

const TRANSLATION_TEMPERATURE = 0.2;
const TRANSLATION_TIMEOUT_MS = 60_000;

function buildSystemPrompt(target: TranslationTarget): string {
  return `你是专业的学术翻译。把用户提供的文本翻译成${TRANSLATION_TARGET_LABELS[target]}。只输出译文，保留公式、符号、术语与数字，不解释、不加引号。`;
}

/**
 * Translates a free selection with the configured chat model. Nothing is
 * persisted: the function only reads text and returns the translation.
 *
 * Validation runs in a fixed order (empty, length, configuration) so the
 * renderer sees one predictable Chinese message per failure. Client errors are
 * replaced with a generic message so provider bodies, relay URLs and key
 * material never reach the renderer.
 */
export async function translateSelection(
  deps: TranslationDeps,
  input: TranslationInput,
): Promise<SelectionTranslationResult> {
  const text = input.text.trim();
  if (text === '') {
    throw new Error(TRANSLATION_EMPTY_SELECTION);
  }
  // Code points, not UTF-16 units: emoji and rare CJK count once.
  if ([...text].length > TRANSLATION_MAX_CHARS) {
    throw new Error(TRANSLATION_TOO_LONG);
  }
  let configured: boolean;
  try {
    configured = deps.isConfigured();
  } catch {
    // A settings/key-decryption failure must not leak its raw error either.
    throw new Error(TRANSLATION_FAILED);
  }
  if (!configured) {
    throw new Error(TRANSLATION_NOT_CONFIGURED);
  }

  const targetLang = detectTranslationTarget(text);
  const messages: AiMessage[] = [
    { role: 'system', content: buildSystemPrompt(targetLang) },
    { role: 'user', content: text },
  ];

  let answer: string;
  try {
    answer = await deps.complete(messages, {
      temperature: TRANSLATION_TEMPERATURE,
      timeoutMs: TRANSLATION_TIMEOUT_MS,
    });
  } catch {
    throw new Error(TRANSLATION_FAILED);
  }

  const translation = answer.trim();
  if (translation === '') {
    throw new Error(TRANSLATION_EMPTY_RESULT);
  }
  return { translation, targetLang };
}
