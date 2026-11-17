import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  BabeldocInstaller,
  MANAGED_ENGINE_FOLDER,
  MANAGED_UV_VERSION,
  buildInstallCommand,
  resolveManagedEnginePaths,
} from '@main/tools/babeldoc-installer';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'paperlens-babeldoc-installer-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function createInstaller(platform: NodeJS.Platform = 'win32'): BabeldocInstaller {
  return new BabeldocInstaller({
    env: {
      LOCALAPPDATA: root,
      USERPROFILE: 'C:\\Users\\me',
      APPDATA: 'C:\\Users\\me\\AppData\\Roaming',
      TEMP: join(root, 'user-temp'),
    },
    platform,
    tempDir: join(root, 'scripts'),
  });
}

describe('resolveManagedEnginePaths', () => {
  it('把引擎固定在 LOCALAPPDATA 下并为每个任务生成独立脚本目录', () => {
    const first = resolveManagedEnginePaths(
      { LOCALAPPDATA: root, USERPROFILE: 'C:\\Users\\me' },
      'job-a',
      join(root, 'scripts'),
    );
    const second = resolveManagedEnginePaths(
      { LOCALAPPDATA: root, USERPROFILE: 'C:\\Users\\me' },
      'job-b',
      join(root, 'scripts'),
    );

    expect(first.installRoot).toBe(join(root, MANAGED_ENGINE_FOLDER));
    expect(first.babeldocPath).toBe(
      join(root, MANAGED_ENGINE_FOLDER, 'bin', 'babeldoc.exe'),
    );
    expect(first.uvPath).toBe(join(root, MANAGED_ENGINE_FOLDER, 'uv', 'uv.exe'));
    expect(first.scriptPath).not.toBe(second.scriptPath);
    expect(first.configPath).not.toBe(second.configPath);
  });
});

describe('BabeldocInstaller.prepare', () => {
  it('生成带 UTF-8 BOM 的提权脚本、配置和 PowerShell 命令', () => {
    const installer = createInstaller();
    const plan = installer.prepare('job-1', 'C:\\Tools\\uv.exe');

    const script = readFileSync(plan.paths.scriptPath, 'utf8');
    expect(script.charCodeAt(0)).toBe(0xfeff);
    expect(script).toContain('Start-Process');
    expect(script).toContain('-Verb RunAs');
    expect(script).toContain('-WindowStyle Normal');
    expect(script).toContain('UV_PYTHON_INSTALL_MIRROR');
    expect(script).toContain('Install-ManagedUv');
    expect(script).toContain('https://mirrors.aliyun.com/pypi/simple');
    expect(script).toContain('https://mirrors.ustc.edu.cn/pypi/simple');
    expect(script).toContain("'BabelDOC==0.7.1'");
    expect(script).toContain(MANAGED_UV_VERSION);

    const config = JSON.parse(readFileSync(plan.paths.configPath, 'utf8')) as Record<
      string,
      unknown
    >;
    expect(config.installRoot).toBe(plan.paths.installRoot);
    expect(config.uvPath).toBe('C:\\Tools\\uv.exe');
    expect(config.localAppData).toBe(root);
    expect(config.resultPath).toBe(plan.paths.resultPath);

    expect(plan.command).toEqual(
      buildInstallCommand(plan.paths.scriptPath),
    );
    expect(plan.command).toEqual({
      file: 'powershell.exe',
      args: [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        plan.paths.scriptPath,
      ],
    });
  });

  it('重新准备时删除上次的日志和结果，避免旧成功被误读', () => {
    const installer = createInstaller();
    const oldPlan = installer.prepare('job-old', null);
    writeFileSync(oldPlan.paths.logPath, 'old log', 'utf8');
    writeFileSync(oldPlan.paths.resultPath, '{"ok":true}', 'utf8');

    const newPlan = installer.prepare('job-new', null);

    expect(newPlan.paths.scriptPath).not.toBe(oldPlan.paths.scriptPath);
    expect(existsSync(newPlan.paths.logPath)).toBe(false);
    expect(existsSync(newPlan.paths.resultPath)).toBe(false);
  });
});

describe('BabeldocInstaller.readOutcome', () => {
  it('读取成功结果并返回托管 BabelDOC 路径', () => {
    const installer = createInstaller();
    const plan = installer.prepare('job-1', null);
    writeFileSync(
      plan.paths.resultPath,
      `${String.fromCharCode(0xfeff)}${JSON.stringify({
        ok: true,
        canceled: false,
        message: '安装完成',
        babeldocPath: plan.paths.babeldocPath,
      })}`,
      'utf8',
    );

    expect(installer.readOutcome(plan)).toEqual({
      ok: true,
      canceled: false,
      message: '安装完成',
      babeldocPath: plan.paths.babeldocPath,
    });
  });

  it('保留取消标记与失败消息', () => {
    const installer = createInstaller();
    const plan = installer.prepare('job-1', null);
    writeFileSync(
      plan.paths.resultPath,
      JSON.stringify({
        ok: false,
        canceled: true,
        message: '已取消管理员授权，安装未开始',
      }),
      'utf8',
    );

    expect(installer.readOutcome(plan)).toEqual({
      ok: false,
      canceled: true,
      message: '已取消管理员授权，安装未开始',
      babeldocPath: null,
    });
  });

  it('结果缺失或内容损坏时返回 null', () => {
    const installer = createInstaller();
    const plan = installer.prepare('job-1', null);

    expect(installer.readOutcome(plan)).toBeNull();

    writeFileSync(plan.paths.resultPath, '{not json', 'utf8');
    expect(installer.readOutcome(plan)).toBeNull();
  });

  it('非 Windows 不读取安装结果', () => {
    const plan = resolveManagedEnginePaths(
      { LOCALAPPDATA: root },
      'job-1',
      join(root, 'scripts'),
    );
    const installer = createInstaller('linux');

    expect(
      installer.readOutcome({ paths: plan, command: buildInstallCommand('x') }),
    ).toBeNull();
  });
});
