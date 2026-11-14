/**
 * Normalizes an unknown thrown value into a message suitable for the UI.
 * `Error` instances expose their message; anything else is stringified.
 */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
