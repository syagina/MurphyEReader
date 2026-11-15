import type { CommandInvocation } from '@shared/types';

/** Environment probing seams so detection order is testable without spawning. */
export interface CandidateOptions {
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  exists(path: string): boolean;
  which(command: string): string[];
}

export interface BabeldocCandidateOptions extends CandidateOptions {
  configuredPath?: string;
}

/** Characters that force a cmd.exe argument to be wrapped in double quotes. */
const CMD_QUOTE_PATTERN = /[\s"]/;

function quoteCmdArgument(value: string): string {
  if (!CMD_QUOTE_PATTERN.test(value)) {
    return value;
  }
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value;
  }
  return `"${value}"`;
}

/**
 * Turns an executable plus its arguments into the spawn file/args pair.
 * Windows batch shims (.cmd/.bat) must run through `cmd.exe /d /s /c` so a
 * path containing spaces stays a single executable argument (Review Focus #4).
 */
export function buildCommandInvocation(
  executable: string,
  args: string[],
  platform: NodeJS.Platform = process.platform,
): CommandInvocation {
  const lower = executable.toLowerCase();
  if (platform === 'win32' && (lower.endsWith('.cmd') || lower.endsWith('.bat'))) {
    const command = [`"${executable}"`, ...args.map(quoteCmdArgument)].join(' ');
    return { file: 'cmd.exe', args: ['/d', '/s', '/c', command] };
  }
  return { file: executable, args: [...args] };
}

function addCandidate(candidates: string[], value: string | null | undefined): void {
  if (value === null || value === undefined) {
    return;
  }
  const trimmed = value.trim();
  if (trimmed === '' || candidates.includes(trimmed)) {
    return;
  }
  candidates.push(trimmed);
}

function environmentPath(
  env: NodeJS.ProcessEnv,
  key: string,
  suffix: string,
): string | null {
  const base = env[key];
  if (base === undefined || base.trim() === '') {
    return null;
  }
  return `${base.trim()}\\${suffix}`;
}

/**
 * BabelDOC candidates in detection order: the configured path, `where.exe
 * babeldoc`, then the `uv tool install` shim and the common Python user-script
 * directory. Only paths that exist are returned.
 */
export function babeldocCandidates(options: BabeldocCandidateOptions): string[] {
  const candidates: string[] = [];
  addCandidate(candidates, options.configuredPath);
  for (const found of options.which('babeldoc')) {
    addCandidate(candidates, found);
  }
  if (options.platform === 'win32') {
    addCandidate(
      candidates,
      environmentPath(options.env, 'USERPROFILE', '.local\\bin\\babeldoc.exe'),
    );
    addCandidate(
      candidates,
      environmentPath(options.env, 'APPDATA', 'Python\\Scripts\\babeldoc.exe'),
    );
  }
  return candidates.filter((candidate) => options.exists(candidate));
}

/** uv candidates in detection order; only paths that exist are returned. */
export function uvCandidates(options: CandidateOptions): string[] {
  const candidates: string[] = [];
  for (const found of options.which('uv')) {
    addCandidate(candidates, found);
  }
  if (options.platform === 'win32') {
    addCandidate(
      candidates,
      environmentPath(options.env, 'USERPROFILE', '.local\\bin\\uv.exe'),
    );
    addCandidate(candidates, environmentPath(options.env, 'LOCALAPPDATA', 'uv\\uv.exe'));
  }
  return candidates.filter((candidate) => options.exists(candidate));
}
