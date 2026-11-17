import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { legacyUserDataDir } from '@main/settings/legacy-user-data';

let root: string;
let appData: string;

function writeDb(dir: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'paperlens.db'), 'db');
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'murphyereader-legacy-'));
  appData = join(root, 'Roaming');
  mkdirSync(appData, { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('legacyUserDataDir', () => {
  it('reuses the pre-rename folder when the new location has no database', () => {
    const legacy = join(appData, 'paperlens');
    writeDb(legacy);

    expect(legacyUserDataDir(join(appData, 'MurphyEReader'), appData)).toBe(
      legacy,
    );
  });

  it('keeps the new folder when it already contains a database', () => {
    writeDb(join(appData, 'paperlens'));
    const current = join(appData, 'MurphyEReader');
    writeDb(current);

    expect(legacyUserDataDir(current, appData)).toBeNull();
  });

  it('returns null when no legacy database exists', () => {
    expect(
      legacyUserDataDir(join(appData, 'MurphyEReader'), appData),
    ).toBeNull();
  });

  it('does not switch when the legacy path is the current folder', () => {
    const current = join(appData, 'PaperLens');
    writeDb(current);

    expect(legacyUserDataDir(current, appData)).toBeNull();
  });
});
