import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  BABELDOC_DUAL_NAME,
  BABELDOC_MONO_NAME,
  CUSTOM_TRANSLATED_NAME,
  ORIGINAL_PDF_NAME,
  canonicalPaperFolderName,
  canonicalStorageDir,
  ensureLibraryLayout,
  isCanonicalStorageDir,
  isPathInside,
  isSafeStorageDir,
  samePath,
  storageFile,
} from '@main/storage/paths';

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'paperlens-storage-'));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe('存储文件名常量', () => {
  it('原文、手动译本与 BabelDOC 输出使用固定文件名', () => {
    expect(ORIGINAL_PDF_NAME).toBe('original.pdf');
    expect(CUSTOM_TRANSLATED_NAME).toBe('translated.custom.pdf');
    expect(BABELDOC_MONO_NAME).toBe('translated.zh-CN.mono.pdf');
    expect(BABELDOC_DUAL_NAME).toBe('translated.zh-CN.dual.pdf');
  });
});

describe('canonicalPaperFolderName', () => {
  it('清洗标题并追加文献 id', () => {
    expect(canonicalPaperFolderName(12, 'A/B: C?')).toBe('A_B_ C (12)');
  });

  it('标题清空后回退为 paper', () => {
    expect(canonicalPaperFolderName(3, ':?*"<>|/\\')).toBe('paper (3)');
  });

  it('标题按 60 个字符截断后再追加 id', () => {
    expect(canonicalPaperFolderName(7, 'x'.repeat(100))).toBe(
      `${'x'.repeat(60)} (7)`,
    );
  });
});

describe('canonicalStorageDir', () => {
  it('返回 papers 下的规范文献文件夹', () => {
    expect(canonicalStorageDir(12, 'A/B: C?')).toBe(join('papers', 'A_B_ C (12)'));
  });

  it('长标题按 60 个字符截断后再追加 id', () => {
    expect(canonicalStorageDir(7, 'x'.repeat(100))).toBe(
      join('papers', `${'x'.repeat(60)} (7)`),
    );
  });
});

describe('isSafeStorageDir', () => {
  it('接受两种分隔符写法的规范形状', () => {
    expect(isSafeStorageDir('papers/A (1)')).toBe(true);
    expect(isSafeStorageDir('papers\\A (1)')).toBe(true);
    expect(isSafeStorageDir(canonicalStorageDir(12, 'A/B'))).toBe(true);
  });

  it('拒绝绝对路径、盘符与超出两段的路径', () => {
    expect(isSafeStorageDir('/papers/A (1)')).toBe(false);
    expect(isSafeStorageDir('\\papers\\A (1)')).toBe(false);
    expect(isSafeStorageDir('C:\\papers\\A (1)')).toBe(false);
    expect(isSafeStorageDir('C:papers/A (1)')).toBe(false);
    expect(isSafeStorageDir('papers/A (1)/notes')).toBe(false);
    expect(isSafeStorageDir('papers')).toBe(false);
    expect(isSafeStorageDir('other/A (1)')).toBe(false);
  });

  it('拒绝空段与 . / .. 段', () => {
    expect(isSafeStorageDir('')).toBe(false);
    expect(isSafeStorageDir('papers/')).toBe(false);
    expect(isSafeStorageDir('papers//A (1)')).toBe(false);
    expect(isSafeStorageDir('..\\Shared')).toBe(false);
    expect(isSafeStorageDir('papers/..')).toBe(false);
    expect(isSafeStorageDir('papers/.')).toBe(false);
  });
});

describe('isCanonicalStorageDir', () => {
  it('规范文件夹自身有效', () => {
    expect(isCanonicalStorageDir(canonicalStorageDir(12, 'A/B'), 12)).toBe(true);
  });

  it('标题之后被修改的旧文件夹仍然有效', () => {
    expect(isCanonicalStorageDir('papers/Old Title (12)', 12)).toBe(true);
  });

  it('id 不匹配时无效', () => {
    expect(isCanonicalStorageDir('papers/Shared (13)', 12)).toBe(false);
  });

  it('stem 必须已经清洗过', () => {
    expect(isCanonicalStorageDir('papers/evil?name (12)', 12)).toBe(false);
    expect(isCanonicalStorageDir('papers/evilname  (12)', 12)).toBe(false);
  });

  it('缺少后缀、空 stem 或形状不安全时无效', () => {
    expect(isCanonicalStorageDir('papers/Foo', 12)).toBe(false);
    expect(isCanonicalStorageDir('papers/Foo (12', 12)).toBe(false);
    expect(isCanonicalStorageDir('papers/Foo(12)', 12)).toBe(false);
    expect(isCanonicalStorageDir('papers/ (12)', 12)).toBe(false);
    expect(isCanonicalStorageDir('..\\Shared (12)', 12)).toBe(false);
  });
});

describe('storageFile', () => {
  it('拼接库根目录与相对文献文件夹', () => {
    expect(storageFile(tempDir, 'papers/A (1)', ORIGINAL_PDF_NAME)).toBe(
      join(tempDir, 'papers/A (1)', ORIGINAL_PDF_NAME),
    );
  });

  it('storageDir 不安全时抛出中文错误', () => {
    expect(() => storageFile(tempDir, '..\\Shared', 'original.pdf')).toThrow(
      '文献文件夹路径无效',
    );
    expect(() => storageFile(tempDir, 'papers', 'original.pdf')).toThrow(
      '文献文件夹路径无效',
    );
  });
});

describe('isPathInside', () => {
  it('按分隔符边界判断，前缀相同的兄弟目录不算内部', () => {
    expect(isPathInside('C:\\Docs', 'C:\\Docs2', 'win32')).toBe(false);
    expect(isPathInside('C:\\Docs', 'C:\\Docs\\PaperLens\\x', 'win32')).toBe(true);
  });

  it('自身不算严格位于内部', () => {
    expect(isPathInside('C:\\Docs', 'C:\\Docs', 'win32')).toBe(false);
    expect(isPathInside('/data/lib', '/data/lib', 'linux')).toBe(false);
  });

  it('win32 下统一分隔符并忽略大小写', () => {
    expect(isPathInside('C:/Docs', 'c:\\docs\\x', 'win32')).toBe(true);
    expect(isPathInside('C:\\', 'C:\\x', 'win32')).toBe(true);
    expect(isPathInside('C:\\Docs\\', 'C:\\Docs\\x', 'win32')).toBe(true);
  });

  it('posix 下区分大小写', () => {
    expect(isPathInside('/data/lib', '/data/lib/papers/x', 'linux')).toBe(true);
    expect(isPathInside('/data/lib', '/data/library/x', 'linux')).toBe(false);
    expect(isPathInside('/Data', '/data/x', 'linux')).toBe(false);
  });

  it('默认使用当前平台的路径规则', () => {
    expect(isPathInside(tempDir, join(tempDir, 'papers', 'x'))).toBe(true);
  });
});

describe('samePath', () => {
  it('win32 下忽略大小写与分隔符差异', () => {
    expect(samePath('C:/Docs', 'c:\\docs', 'win32')).toBe(true);
    expect(samePath('C:\\Docs', 'C:\\Docs2', 'win32')).toBe(false);
  });

  it('posix 下归一化路径但区分大小写', () => {
    expect(samePath('/a/./b', '/a/b', 'linux')).toBe(true);
    expect(samePath('/Data', '/data', 'linux')).toBe(false);
  });
});

describe('ensureLibraryLayout', () => {
  it('创建 papers 与 exports 目录', async () => {
    await ensureLibraryLayout(tempDir);

    expect(statSync(join(tempDir, 'papers')).isDirectory()).toBe(true);
    expect(statSync(join(tempDir, 'exports')).isDirectory()).toBe(true);
  });

  it('重复调用保持幂等', async () => {
    await ensureLibraryLayout(tempDir);
    await expect(ensureLibraryLayout(tempDir)).resolves.toBeUndefined();

    expect(existsSync(join(tempDir, 'papers'))).toBe(true);
    expect(existsSync(join(tempDir, 'exports'))).toBe(true);
  });

  it('库根目录不存在时一并创建', async () => {
    const nested = join(tempDir, 'nested', 'PaperLens');
    await ensureLibraryLayout(nested);

    expect(existsSync(join(nested, 'papers'))).toBe(true);
    expect(existsSync(join(nested, 'exports'))).toBe(true);
  });
});
