import { basename, dirname, join } from 'node:path';
import type { Paper } from '@shared/types';
import { BABELDOC_DUAL_NAME, BABELDOC_MONO_NAME } from '../storage/paths';

export interface TranslationVariantPaths {
  /**
   * The translated-only view. Null when the bound primary file is already the
   * bilingual output: offering it again as 仅译文 would show the wrong layout.
   */
  translated: string | null;
  /** The bilingual output, or null when the binding has no dual sibling. */
  bilingual: string | null;
}

function hasFileName(filePath: string, expected: string): boolean {
  return basename(filePath).toLowerCase() === expected.toLowerCase();
}

/** True when this path is the app's canonical bilingual BabelDOC output. */
export function isBilingualTranslationPath(filePath: string): boolean {
  return hasFileName(filePath, BABELDOC_DUAL_NAME);
}

/**
 * Resolves the two translated layouts without a database column: BabelDOC
 * writes both outputs into the same canonical folder, and the bound path
 * identifies which one is primary. A user-attached translation has no dual
 * sibling even when it happens to live next to other files.
 */
export function translationVariantPaths(
  paper: Pick<Paper, 'filePathTranslated'>,
): TranslationVariantPaths {
  const primary = paper.filePathTranslated;
  if (primary === null || primary === '') {
    return { translated: null, bilingual: null };
  }
  if (isBilingualTranslationPath(primary)) {
    return { translated: null, bilingual: primary };
  }
  if (hasFileName(primary, BABELDOC_MONO_NAME)) {
    return {
      translated: primary,
      bilingual: join(dirname(primary), BABELDOC_DUAL_NAME),
    };
  }
  return { translated: primary, bilingual: null };
}
