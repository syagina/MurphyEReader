import { dirname, join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  prepareExportDefaultPath,
  resolveExportDefaultPath,
} from '@main/export/default-path';

describe('resolveExportDefaultPath', () => {
  it('已托管文献的单篇笔记默认写入文献文件夹的 notes/', () => {
    expect(
      resolveExportDefaultPath({
        root: join('C:', 'lib'),
        storageDir: 'papers/A (1)',
        fallbackDir: 'C:\\Docs',
        fileName: 'note.pdf',
        scope: 'note',
      }),
    ).toBe(join('C:', 'lib', 'papers/A (1)', 'notes', 'note.pdf'));
  });

  it('未托管文献的单篇笔记退回 Documents', () => {
    expect(
      resolveExportDefaultPath({
        root: join('C:', 'lib'),
        storageDir: null,
        fallbackDir: 'C:\\Docs',
        fileName: 'note.pdf',
        scope: 'note',
      }),
    ).toBe(join('C:\\Docs', 'note.pdf'));
  });

  it('全部笔记默认写入文献库的 exports/', () => {
    expect(
      resolveExportDefaultPath({
        root: join('C:', 'lib'),
        storageDir: 'papers/A (1)',
        fallbackDir: 'C:\\Docs',
        fileName: 'all.pdf',
        scope: 'all',
      }),
    ).toBe(join('C:', 'lib', 'exports', 'all.pdf'));
  });

  it('没有文献库根目录时退回 Documents', () => {
    expect(
      resolveExportDefaultPath({
        root: null,
        storageDir: 'papers/A (1)',
        fallbackDir: 'C:\\Docs',
        fileName: 'all.pdf',
        scope: 'all',
      }),
    ).toBe(join('C:\\Docs', 'all.pdf'));
  });

  it('不安全的 storageDir 退回 Documents', () => {
    expect(
      resolveExportDefaultPath({
        root: join('C:', 'lib'),
        storageDir: '..\\shared',
        fallbackDir: 'C:\\Docs',
        fileName: 'note.pdf',
        scope: 'note',
      }),
    ).toBe(join('C:\\Docs', 'note.pdf'));
  });

  it('只取文件名的 basename，不让文件名逃出目标目录', () => {
    expect(
      resolveExportDefaultPath({
        root: join('C:', 'lib'),
        storageDir: 'papers/B (2)',
        fallbackDir: 'C:\\Docs',
        fileName: 'nested/note.pdf',
        scope: 'note',
      }),
    ).toBe(join('C:', 'lib', 'papers/B (2)', 'notes', 'note.pdf'));
  });
});

describe('prepareExportDefaultPath', () => {
  it('创建默认目录后返回解析出的路径', async () => {
    const mkdir = vi.fn(async () => undefined);
    const expected = join('C:', 'lib', 'papers/A (1)', 'notes', 'note.pdf');

    const path = await prepareExportDefaultPath(
      {
        root: join('C:', 'lib'),
        storageDir: 'papers/A (1)',
        fallbackDir: 'C:\\Docs',
        fileName: 'note.pdf',
        scope: 'note',
      },
      mkdir,
    );

    expect(path).toBe(expected);
    expect(mkdir).toHaveBeenCalledWith(dirname(expected), { recursive: true });
  });

  it('退回 Documents 时同样创建目标目录', async () => {
    const mkdir = vi.fn(async () => undefined);
    const expected = join('C:\\Docs', 'note.pdf');

    const path = await prepareExportDefaultPath(
      {
        root: join('C:', 'lib'),
        storageDir: null,
        fallbackDir: 'C:\\Docs',
        fileName: 'note.pdf',
        scope: 'note',
      },
      mkdir,
    );

    expect(path).toBe(expected);
    expect(mkdir).toHaveBeenCalledWith(dirname(expected), { recursive: true });
  });

  it('目录创建失败时抛出中文错误', async () => {
    await expect(
      prepareExportDefaultPath(
        {
          root: join('C:', 'lib'),
          storageDir: 'papers/A (1)',
          fallbackDir: 'C:\\Docs',
          fileName: 'note.pdf',
          scope: 'note',
        },
        async () => {
          throw new Error('EACCES');
        },
      ),
    ).rejects.toThrow('无法写入文献库目录：EACCES');
  });
});
