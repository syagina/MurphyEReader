import {
  TRANSLATION_EMPTY_RESULT,
  TRANSLATION_EMPTY_SELECTION,
  TRANSLATION_FAILED,
  TRANSLATION_NOT_CONFIGURED,
  TRANSLATION_TOO_LONG,
} from '@shared/translation';
import { errorMessage, stripIpcErrorPrefix } from './errors';

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
  const message = stripIpcErrorPrefix(errorMessage(error));
  return KNOWN_TRANSLATION_ERRORS.has(message) ? message : TRANSLATION_FAILED;
}
