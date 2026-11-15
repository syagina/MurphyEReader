/**
 * Normalizes an unknown thrown value into a message suitable for the UI.
 * `Error` instances expose their message; anything else is stringified.
 */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Electron wraps every rejected `ipcMain.handle` message, e.g.
 * `Error invoking remote method 'translate:text': Error: 选中文本过长，请分段翻译`.
 */
const IPC_ERROR_PREFIX = /^Error invoking remote method '[^']+': (?:Error: )?/;

/**
 * Drops Electron's English IPC wrapper from a user-visible message. Messages
 * without the anchored prefix (including unknown ones) are returned intact.
 */
export function stripIpcErrorPrefix(message: string): string {
  return message.replace(IPC_ERROR_PREFIX, '');
}

/**
 * UI-facing normalizer: `errorMessage` plus Electron's IPC wrapper removed, so
 * messages from `ipcMain.handle` rejections render as the Chinese text alone.
 */
export function uiErrorMessage(error: unknown): string {
  return stripIpcErrorPrefix(errorMessage(error));
}
