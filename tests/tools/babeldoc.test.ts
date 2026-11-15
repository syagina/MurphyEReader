import { describe, expect, it } from 'vitest';
import {
  babeldocCandidates,
  buildCommandInvocation,
  uvCandidates,
} from '@main/tools/babeldoc';

const ENV = {
  USERPROFILE: 'C:\\Users\\me',
  APPDATA: 'C:\\Users\\me\\AppData\\Roaming',
  LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local',
};

const PATH_BABELDOC = 'C:\\PATH\\babeldoc.exe';
const PROFILE_BABELDOC = 'C:\\Users\\me\\.local\\bin\\babeldoc.exe';
const APPDATA_BABELDOC = 'C:\\Users\\me\\AppData\\Roaming\\Python\\Scripts\\babeldoc.exe';
const PATH_UV = 'C:\\PATH\\uv.exe';
const PROFILE_UV = 'C:\\Users\\me\\.local\\bin\\uv.exe';
const LOCALAPPDATA_UV = 'C:\\Users\\me\\AppData\\Local\\uv\\uv.exe';

describe('buildCommandInvocation', () => {
  // Review Focus #4: a .cmd shim with spaces stays one executable argument.
  it('win32 的 .cmd 通过 cmd.exe /d /s /c 调用并把带空格的路径整体加引号', () => {
    const invocation = buildCommandInvocation(
      'C:\\Program Files\\My Tools\\babeldoc.cmd',
      ['--help'],
      'win32',
    );

    expect(invocation.file).toBe('cmd.exe');
    expect(invocation.args.slice(0, 3)).toEqual(['/d', '/s', '/c']);
    expect(invocation.args[3]).toContain('"C:\\Program Files\\My Tools\\babeldoc.cmd"');
    expect(invocation.args[3]).toContain('--help');
  });

  it('win32 的 .bat 同样通过 cmd.exe 调用', () => {
    const invocation = buildCommandInvocation('C:\\Tools\\run.bat', ['--warmup'], 'win32');

    expect(invocation.file).toBe('cmd.exe');
    expect(invocation.args[3]).toBe('"C:\\Tools\\run.bat" --warmup');
  });

  it('.exe 直接 spawn，参数原样传递', () => {
    const invocation = buildCommandInvocation(
      'C:\\Tools\\babeldoc.exe',
      ['--config', 'a.toml'],
      'win32',
    );

    expect(invocation).toEqual({
      file: 'C:\\Tools\\babeldoc.exe',
      args: ['--config', 'a.toml'],
    });
  });

  it('非 win32 不会把 .cmd 当作批处理脚本处理', () => {
    const invocation = buildCommandInvocation('/opt/tools/babeldoc.cmd', ['--help'], 'linux');

    expect(invocation).toEqual({ file: '/opt/tools/babeldoc.cmd', args: ['--help'] });
  });

  it('只为包含空白或引号的参数加引号，安全参数保持原样', () => {
    const invocation = buildCommandInvocation(
      'C:\\Tools\\babeldoc.cmd',
      ['--config', 'C:\\My Files\\config.toml', '--qps', '4'],
      'win32',
    );

    expect(invocation.args[3]).toBe(
      '"C:\\Tools\\babeldoc.cmd" --config "C:\\My Files\\config.toml" --qps 4',
    );
  });
});

describe('babeldocCandidates', () => {
  it('已配置的路径排在第一位', () => {
    const candidates = babeldocCandidates({
      configuredPath: 'C:\\Tools\\babeldoc.cmd',
      env: ENV,
      platform: 'win32',
      exists: () => true,
      which: () => [PATH_BABELDOC],
    });

    expect(candidates[0]).toBe('C:\\Tools\\babeldoc.cmd');
  });

  it('按 where.exe、用户 bin、Python Scripts 的顺序返回存在的候选', () => {
    const candidates = babeldocCandidates({
      configuredPath: '',
      env: ENV,
      platform: 'win32',
      exists: () => true,
      which: (command) => (command === 'babeldoc' ? [PATH_BABELDOC] : []),
    });

    expect(candidates).toEqual([PATH_BABELDOC, PROFILE_BABELDOC, APPDATA_BABELDOC]);
  });

  it('过滤掉不存在的路径', () => {
    const existing = new Set([PATH_BABELDOC]);
    const candidates = babeldocCandidates({
      configuredPath: 'C:\\Missing\\babeldoc.exe',
      env: ENV,
      platform: 'win32',
      exists: (path) => existing.has(path),
      which: () => [PATH_BABELDOC],
    });

    expect(candidates).toEqual([PATH_BABELDOC]);
  });

  it('where.exe 不可用时只依赖配置路径，缺失的环境变量被跳过', () => {
    const candidates = babeldocCandidates({
      configuredPath: '',
      env: {},
      platform: 'win32',
      exists: () => true,
      which: () => [],
    });

    expect(candidates).toEqual([]);
  });

  it('重复的候选路径只保留一次', () => {
    const candidates = babeldocCandidates({
      configuredPath: PATH_BABELDOC,
      env: ENV,
      platform: 'win32',
      exists: () => true,
      which: () => [PATH_BABELDOC],
    });

    expect(candidates).toEqual([PATH_BABELDOC, PROFILE_BABELDOC, APPDATA_BABELDOC]);
  });
});

describe('uvCandidates', () => {
  it('按 where.exe uv、用户 bin、LOCALAPPDATA 的顺序返回存在的候选', () => {
    const candidates = uvCandidates({
      env: ENV,
      platform: 'win32',
      exists: () => true,
      which: (command) => (command === 'uv' ? [PATH_UV] : []),
    });

    expect(candidates).toEqual([PATH_UV, PROFILE_UV, LOCALAPPDATA_UV]);
  });

  it('过滤掉不存在的 uv', () => {
    const candidates = uvCandidates({
      env: ENV,
      platform: 'win32',
      exists: (path) => path === LOCALAPPDATA_UV,
      which: () => [PATH_UV],
    });

    expect(candidates).toEqual([LOCALAPPDATA_UV]);
  });
});
