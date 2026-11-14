import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '@main/db';
import { createPaper } from '@main/db/papers';
import type { NewPaperInput } from '@main/db/papers';
import { resolvePaperPath, toLoadPayload } from '@main/ipc/handlers';

let tempDir: string;
let db: Database.Database;

function makeInput(overrides: Partial<NewPaperInput> = {}): NewPaperInput {
  return {
    title: '有限元方法导论',
    authors: '张三, 李四',
    year: 2020,
    filePathOriginal: join(tempDir, 'original.pdf'),
    filePathTranslated: null,
    pageCountOriginal: 120,
    pageCountTranslated: null,
    hasTextLayer: true,
    outline: [],
    ...overrides,
  };
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'paperlens-ipc-'));
  db = openDb(':memory:');
});

afterEach(() => {
  db.close();
  rmSync(tempDir, { recursive: true, force: true });
});

describe('toLoadPayload', () => {
  it('读取文件并返回完整字节与文件名', async () => {
    const filePath = join(tempDir, 'sample.pdf');
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x00, 0x7f, 0x80, 0xfe, 0xff]);
    writeFileSync(filePath, bytes);

    const payload = await toLoadPayload(filePath);

    expect(payload.fileName).toBe('sample.pdf');
    expect(payload.data).toBeInstanceOf(ArrayBuffer);
    expect(payload.data.byteLength).toBe(bytes.byteLength);
    expect([...new Uint8Array(payload.data)]).toEqual([...bytes]);
  });

  it('文件不存在时抛出带路径的明确错误', async () => {
    const missing = join(tempDir, 'missing.pdf');

    await expect(toLoadPayload(missing)).rejects.toThrow(new Error(`文件不存在: ${missing}`));
  });
});

describe('resolvePaperPath', () => {
  it('original 版本返回原文路径', () => {
    const paper = createPaper(db, makeInput());

    expect(resolvePaperPath(db, paper.id, 'original')).toBe(paper.filePathOriginal);
  });

  it('已绑定译本时 translated 版本返回译本路径', () => {
    const translatedPath = join(tempDir, 'translated.pdf');
    const paper = createPaper(
      db,
      makeInput({ filePathTranslated: translatedPath, pageCountTranslated: 130 }),
    );

    expect(resolvePaperPath(db, paper.id, 'translated')).toBe(translatedPath);
  });

  it('译本未绑定（null）时抛出 未绑定译本', () => {
    const paper = createPaper(db, makeInput());

    expect(() => resolvePaperPath(db, paper.id, 'translated')).toThrow(new Error('未绑定译本'));
  });

  it('译本路径为空字符串时同样抛出 未绑定译本', () => {
    const paper = createPaper(db, makeInput({ filePathTranslated: '' }));

    expect(() => resolvePaperPath(db, paper.id, 'translated')).toThrow(new Error('未绑定译本'));
  });

  it('论文不存在时抛出 文献不存在', () => {
    expect(() => resolvePaperPath(db, 999, 'original')).toThrow(new Error('文献不存在: 999'));
  });
});
