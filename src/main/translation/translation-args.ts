export interface TranslationArgsInput {
  configPath: string;
  filePathOriginal: string;
  outDir: string;
}

/**
 * BabelDOC arguments for one whole-paper translation. Every page is
 * translated, bibliography included: once the provider returns a non-empty
 * response, BabelDOC preserves those pages like any other prose page.
 */
export function buildTranslationArgs(input: TranslationArgsInput): string[] {
  return [
    '--config',
    input.configPath,
    '--files',
    input.filePathOriginal,
    '--output',
    input.outDir,
    // BabelDOC caches whichever string the provider returns, including an
    // empty one produced by a transient failure. Every later run would then
    // reuse that empty translation and reproduce the missing paragraph.
    '--ignore-cache',
  ];
}
