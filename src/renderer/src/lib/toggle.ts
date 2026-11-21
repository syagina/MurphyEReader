import type { PdfVersion } from '@shared/types';
import { mapReadingPosition, positionAt } from './reading-position';
import type { ReadingPosition } from './reading-position';

/**
 * Resolves the position to show after switching versions. The live reading
 * progress is mapped onto the target layout's page count; a version's own
 * historical page is deliberately not consulted.
 */
export function resolveTogglePosition(input: {
  from: PdfVersion;
  to: PdfVersion;
  position: ReadingPosition;
  fromPageCount: number;
  toPageCount: number;
}): ReadingPosition {
  if (input.from === input.to) {
    return positionAt(
      input.position.page,
      input.position.offset,
      input.toPageCount,
    );
  }
  return mapReadingPosition(
    input.position,
    input.fromPageCount,
    input.toPageCount,
  );
}
