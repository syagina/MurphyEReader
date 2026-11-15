import {
  TRANSLATION_EMPTY_RESULT,
  TRANSLATION_EMPTY_SELECTION,
  TRANSLATION_FAILED,
  TRANSLATION_NOT_CONFIGURED,
  TRANSLATION_TOO_LONG,
} from '@shared/translation';
import { errorMessage } from './errors';

/**
 * Electron wraps every rejected `ipcMain.handle` message, e.g.
 * `Error invoking remote method 'translate:text': Error: 选中文本过长，请分段翻译`.
 */
const IPC_ERROR_PREFIX = /^Error invoking remote method '[^']+': (?:Error: )?/;

/** Service messages the card may show verbatim; anything else is generic. */
const KNOWN_TRANSLATION_ERRORS: ReadonlySet<string> = new Set([
  TRANSLATION_EMPTY_SELECTION,
  TRANSLATION_TOO_LONG,
  TRANSLATION_NOT_CONFIGURED,
  TRANSLATION_EMPTY_RESULT,
  TRANSLATION_FAILED,
]);

/**
 * Turns a translation IPC rejection into the exact Chinese message the card
 * should display: drops Electron's English prefix and replaces unknown
 * transport/provider text with the generic failure message.
 */
export function normalizeTranslationError(error: unknown): string {
  const message = errorMessage(error).replace(IPC_ERROR_PREFIX, '');
  return KNOWN_TRANSLATION_ERRORS.has(message) ? message : TRANSLATION_FAILED;
}
