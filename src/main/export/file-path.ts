import { extname } from 'node:path';

/**
 * Adds the requested extension when the save dialog returned a path without
 * one (Windows does not always append the filter's extension). Existing
 * extensions are kept as typed, even when their case differs.
 */
export function ensureFileExtension(filePath: string, extension: string): string {
  const wanted = extension.startsWith('.') ? extension : `.${extension}`;
  return extname(filePath) === '' ? `${filePath}${wanted}` : filePath;
}
