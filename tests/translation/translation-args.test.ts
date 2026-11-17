import { describe, expect, it } from 'vitest';
import { buildTranslationArgs } from '@main/translation/translation-args';

const BASE = {
  configPath: 'C:\\tmp\\config.toml',
  filePathOriginal: 'C:\\docs\\paper.pdf',
  outDir: 'C:\\tmp\\output',
};

describe('buildTranslationArgs', () => {
  it('translates every page, including the bibliography', () => {
    const args = buildTranslationArgs(BASE);

    expect(args).toEqual([
      '--config',
      BASE.configPath,
      '--files',
      BASE.filePathOriginal,
      '--output',
      BASE.outDir,
      '--ignore-cache',
    ]);
    expect(args).not.toContain('--pages');
  });

  it('always bypasses BabelDOC cache so a failed run can be repaired', () => {
    const args = buildTranslationArgs(BASE);

    expect(args).toContain('--ignore-cache');
  });
});
