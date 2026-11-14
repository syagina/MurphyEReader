import { beforeAll, describe, expect, it } from 'vitest';
import { extractPdf, getPdfPageCount } from '@main/pdf/extract';
import {
  generateFixtures,
  SAMPLE_SCANNED_PDF,
  SAMPLE_TEXT_PDF,
} from '../fixtures/generate';

beforeAll(async () => {
  await generateFixtures();
});

describe('extractPdf 文本版 PDF', () => {
  it('逐页提取文本并识别出文本层', async () => {
    const extracted = await extractPdf(SAMPLE_TEXT_PDF);

    expect(extracted.pageCount).toBe(2);
    expect(extracted.pages).toHaveLength(2);
    expect(extracted.pages.map((page) => page.pageNo)).toEqual([1, 2]);
    expect(extracted.pages[0].text).toContain('PaperLens sample page 1');
    expect(extracted.pages[1].text).toContain('PaperLens sample page 2');
    expect(extracted.hasTextLayer).toBe(true);
    expect(extracted.outline).toEqual([]);
  });

  it('没有内嵌题名时以去掉扩展名的文件名作为 title', async () => {
    const extracted = await extractPdf(SAMPLE_TEXT_PDF);

    expect(extracted.title).toBe('sample-text');
    expect(extracted.authors).toBe('');
  });
});

describe('extractPdf 扫描版 PDF', () => {
  it('没有文字层时 hasTextLayer 为 false', async () => {
    const extracted = await extractPdf(SAMPLE_SCANNED_PDF);

    expect(extracted.pageCount).toBe(1);
    expect(extracted.pages).toHaveLength(1);
    expect(extracted.pages[0].text.trim()).toBe('');
    expect(extracted.hasTextLayer).toBe(false);
  });
});

describe('getPdfPageCount', () => {
  it('返回 PDF 的总页数', async () => {
    await expect(getPdfPageCount(SAMPLE_TEXT_PDF)).resolves.toBe(2);
    await expect(getPdfPageCount(SAMPLE_SCANNED_PDF)).resolves.toBe(1);
  });
});
