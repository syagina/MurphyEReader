import { mkdir } from 'node:fs/promises';
import { join, posix, win32 } from 'node:path';
import { sanitizeFileNamePart } from '@shared/file-name';

export const ORIGINAL_PDF_NAME = 'original.pdf';
export const CUSTOM_TRANSLATED_NAME = 'translated.custom.pdf';
export const BABELDOC_MONO_NAME = 'translated.zh-CN.mono.pdf';
export const BABELDOC_DUAL_NAME = 'translated.zh-CN.dual.pdf';

/** Length cap agreed for the title-derived part of a paper folder name. */
const PAPER_FOLDER_STEM_LIMIT = 60;

const INVALID_STORAGE_DIR_MESSAGE = '文献文件夹路径无效';

const STORAGE_DIR_SEPARATOR = /[\\/]/;
const DRIVE_PREFIX = /^[A-Za-z]:/;
const LEADING_SEPARATOR = /^[\\/]/;

/** Builds the stable folder name `<sanitized title> (<paperId>)`. */
export function canonicalPaperFolderName(paperId: number, title: string): string {
  return `${sanitizeFileNamePart(title, 'paper', PAPER_FOLDER_STEM_LIMIT)} (${paperId})`;
}

/**
 * The storage directory relative to the library root, e.g.
 * `papers/Attention Is All You Need (12)`. The id in the name keeps the
 * folder stable across title edits.
 */
export function canonicalStorageDir(paperId: number, title: string): string {
  return join('papers', canonicalPaperFolderName(paperId, title));
}

function storageDirSegments(storageDir: string): string[] | null {
  if (storageDir === '') {
    return null;
  }
  if (LEADING_SEPARATOR.test(storageDir) || DRIVE_PREFIX.test(storageDir)) {
    return null;
  }
  const segments = storageDir.split(STORAGE_DIR_SEPARATOR);
  if (
    segments.length !== 2 ||
    segments.some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    return null;
  }
  return segments;
}

/**
 * A safe storage directory is exactly two relative segments below the library
 * root: `papers/<folder>`. Both `/` and `\` count as separators because the
 * canonical path is produced with the host's `join`. Absolute paths, drive
 * prefixes, empty, `.` and `..` segments are rejected.
 */
export function isSafeStorageDir(storageDir: string): boolean {
  const segments = storageDirSegments(storageDir);
  return segments !== null && segments[0] === 'papers';
}

/**
 * A canonical storage directory keeps the ` (<paperId>)` suffix of its final
 * segment and a stem that is already sanitized (and therefore stable). It
 * deliberately does not compare the stem with the paper's current title: a
 * later title edit must not invalidate an existing folder.
 */
export function isCanonicalStorageDir(storageDir: string, paperId: number): boolean {
  const segments = storageDirSegments(storageDir);
  if (segments === null || segments[0] !== 'papers') {
    return false;
  }
  const folderName = segments[1];
  const suffix = ` (${paperId})`;
  if (!folderName.endsWith(suffix)) {
    return false;
  }
  const stem = folderName.slice(0, folderName.length - suffix.length);
  return sanitizeFileNamePart(stem, 'paper', PAPER_FOLDER_STEM_LIMIT) === stem;
}

/**
 * Resolves one file inside a managed paper folder. Throws a Chinese error
 * when the stored relative directory is not a safe storage directory.
 */
export function storageFile(root: string, storageDir: string, fileName: string): string {
  if (!isSafeStorageDir(storageDir)) {
    throw new Error(INVALID_STORAGE_DIR_MESSAGE);
  }
  return join(root, storageDir, fileName);
}

function platformPath(platform: NodeJS.Platform): typeof posix {
  return platform === 'win32' ? win32 : posix;
}

function normalizedPath(value: string, platform: NodeJS.Platform): string {
  const resolved = platformPath(platform).resolve(value);
  return platform === 'win32' ? resolved.toLowerCase() : resolved;
}

/**
 * True when `child` is strictly inside `parent`. Comparison uses resolved,
 * platform-normalized paths (separators normalized, case-insensitive on
 * win32) and requires a separator boundary, so `C:\Docs2` is not inside
 * `C:\Docs`.
 */
export function isPathInside(
  parent: string,
  child: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  const normalizedParent = normalizedPath(parent, platform);
  const normalizedChild = normalizedPath(child, platform);
  if (normalizedChild === normalizedParent) {
    return false;
  }
  const separator = platformPath(platform).sep;
  const prefix = normalizedParent.endsWith(separator)
    ? normalizedParent
    : `${normalizedParent}${separator}`;
  return normalizedChild.startsWith(prefix);
}

/** True when both paths resolve to the same location on `platform`. */
export function samePath(
  a: string,
  b: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  return normalizedPath(a, platform) === normalizedPath(b, platform);
}

/** Creates the library root's `papers/` and `exports/` directories. */
export async function ensureLibraryLayout(root: string): Promise<void> {
  await mkdir(join(root, 'papers'), { recursive: true });
  await mkdir(join(root, 'exports'), { recursive: true });
}
