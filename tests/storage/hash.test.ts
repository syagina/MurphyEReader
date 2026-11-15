import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sha256File } from '@main/storage/hash';

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'paperlens-hash-'));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe('sha256File', () => {
  it('返回 abc 的标准 SHA-256 小写十六进制', async () => {
    writeFileSync(join(tempDir, 'abc.txt'), 'abc');

    await expect(sha256File(join(tempDir, 'abc.txt'))).resolves.toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('空文件返回空内容的哈希', async () => {
    writeFileSync(join(tempDir, 'empty.txt'), '');

    await expect(sha256File(join(tempDir, 'empty.txt'))).resolves.toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('分块读取大文件的结果与一次性计算一致', async () => {
    const content = Buffer.alloc(1024 * 1024 + 7);
    for (let index = 0; index < content.length; index += 1) {
      content[index] = index % 251;
    }
    const filePath = join(tempDir, 'large.pdf');
    writeFileSync(filePath, content);

    const expected = createHash('sha256').update(content).digest('hex');
    await expect(sha256File(filePath)).resolves.toBe(expected);
  });

  it('结果为 64 位小写十六进制', async () => {
    writeFileSync(join(tempDir, 'mixed.bin'), Buffer.from([0, 255, 1, 254]));

    const digest = await sha256File(join(tempDir, 'mixed.bin'));

    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('文件不存在时拒绝', async () => {
    await expect(sha256File(join(tempDir, 'missing.pdf'))).rejects.toThrow();
  });
});
