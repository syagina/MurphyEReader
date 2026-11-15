/** Windows refuses these characters in file names; controls are also unsafe. */
const ILLEGAL_FILENAME_CHARS = /[<>:"/\\|?*\u0000-\u001f\u007f]+/g;

/** Default length cap for one component of a file name, in code points. */
const DEFAULT_FILE_NAME_PART_LIMIT = 80;

/**
 * Sanitizes one component of a file name. Illegal Windows characters become
 * `_`; whitespace is collapsed; leading/trailing dots, underscores and spaces
 * are stripped; very long values are shortened so a paper title plus a note
 * title still leaves room for folders and extensions. The length cap is
 * applied by code points, so a surrogate pair (for example an emoji) is never
 * split. A value with nothing usable returns `fallback`.
 */
export function sanitizeFileNamePart(
  value: string,
  fallback: string,
  limit = DEFAULT_FILE_NAME_PART_LIMIT,
): string {
  const sanitized = value
    .replace(ILLEGAL_FILENAME_CHARS, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[._\s]+|[._\s]+$/g, '');
  const shortened = Array.from(sanitized)
    .slice(0, Math.max(0, limit))
    .join('')
    .replace(/[._\s]+$/g, '');
  return shortened === '' ? fallback : shortened;
}
