import { describe, expect, it } from 'vitest';
import type { PageText } from '@shared/types';
import {
  findIncompletePages,
  inspectCompleteness,
} from '@main/translation/completeness';

function page(pageNo: number, text: string): PageText {
  return { pageNo, text };
}

const ENGLISH_PAGE = 'The soil moisture form allows an implicit solution. '.repeat(70);
const CHINESE_PAGE = '土壤水分形式允许隐式求解，并且能够保持质量守恒。'.repeat(25);

describe('inspectCompleteness', () => {
  it('reports the threshold and explains each failed page', () => {
    const original = [
      page(1, ENGLISH_PAGE),
      page(2, ENGLISH_PAGE),
      page(3, ENGLISH_PAGE),
    ];
    const translated = [page(1, CHINESE_PAGE), page(2, '译'.repeat(5))];

    const report = inspectCompleteness(original, translated);

    expect(report.incompletePages).toEqual([2, 3]);
    expect(report.medianRatio).toBeGreaterThan(0);
    expect(report.threshold).toBeGreaterThan(0);

    const short = report.pages.find((entry) => entry.pageNo === 2)!;
    expect(short.missing).toBe(false);
    expect(short.cjk).toBe(5);
    expect(short.ratio).toBeLessThan(report.threshold);

    const missing = report.pages.find((entry) => entry.pageNo === 3)!;
    expect(missing.missing).toBe(true);
    expect(missing.cjk).toBe(0);
  });
});

describe('findIncompletePages', () => {
  it('flags a prose page whose Chinese translation is nearly empty', () => {
    const original = [page(1, ENGLISH_PAGE), page(2, ENGLISH_PAGE)];
    const translated = [page(1, CHINESE_PAGE), page(2, '译'.repeat(20))];

    expect(findIncompletePages(original, translated)).toEqual([2]);
  });

  it('keeps pages that translate at the document median', () => {
    const original = [page(1, ENGLISH_PAGE), page(2, ENGLISH_PAGE)];
    const translated = [page(1, CHINESE_PAGE), page(2, CHINESE_PAGE)];

    expect(findIncompletePages(original, translated)).toEqual([]);
  });

  it('flags a partially lost page even when some original text remained', () => {
    const original = [1, 2, 3, 4, 5].map((pageNo) => page(pageNo, ENGLISH_PAGE));
    const translated = [
      page(1, CHINESE_PAGE),
      page(2, CHINESE_PAGE),
      page(3, CHINESE_PAGE),
      page(4, '译'.repeat(38)),
      page(5, CHINESE_PAGE),
    ];

    expect(findIncompletePages(original, translated)).toEqual([4]);
  });

  it('ignores sparse pages', () => {
    const original = [page(1, 'short caption')];

    expect(findIncompletePages(original, [])).toEqual([]);
  });

  it('ignores figure- and table-heavy pages that carry few letters', () => {
    const numericPage = `${'12.34 56.78 90.12 '.repeat(40)}${'A'.repeat(80)}`;
    const original = [page(1, ENGLISH_PAGE), page(2, numericPage)];
    const translated = [page(1, CHINESE_PAGE), page(2, '')];

    expect(findIncompletePages(original, translated)).toEqual([]);
  });

  it('flags missing output pages but compares by page number', () => {
    const original = [page(1, ENGLISH_PAGE), page(2, ENGLISH_PAGE)];
    const translated = [page(2, CHINESE_PAGE)];

    expect(findIncompletePages(original, translated)).toEqual([1]);
  });

  it('reports every page when the translation is systemically empty', () => {
    const original = [page(1, ENGLISH_PAGE), page(2, ENGLISH_PAGE)];
    const translated = [page(1, ''), page(2, '')];

    expect(findIncompletePages(original, translated)).toEqual([1, 2]);
  });

  it('does not mistake a naturally lower bibliography ratio for a loss', () => {
    const original = [
      page(1, ENGLISH_PAGE),
      page(2, ENGLISH_PAGE),
      page(3, 'Reference entry. '.repeat(40)),
    ];
    const translated = [
      page(1, CHINESE_PAGE.repeat(10)),
      page(2, CHINESE_PAGE.repeat(10)),
      // 500 CJK over ~640 Latin letters: below half the body median, yet far
      // above an empty or dropped translation.
      page(3, '译'.repeat(500)),
    ];

    expect(findIncompletePages(original, translated)).toEqual([]);
  });

  it('judges bibliography pages like any other prose page', () => {
    const original = [
      page(1, ENGLISH_PAGE),
      page(2, ENGLISH_PAGE),
      page(3, `${'Reference entry. '.repeat(40)}`),
    ];
    const translated = [
      page(1, CHINESE_PAGE),
      page(2, CHINESE_PAGE),
      page(3, 'Reference entry. '.repeat(40)),
    ];

    expect(findIncompletePages(original, translated)).toEqual([3]);
  });

  it('accepts dual output where the original accompanies the translation', () => {
    const original = [page(1, ENGLISH_PAGE), page(2, ENGLISH_PAGE)];
    const translated = [
      page(1, `${ENGLISH_PAGE}${CHINESE_PAGE}`),
      page(2, `${ENGLISH_PAGE}${CHINESE_PAGE}`),
    ];

    expect(findIncompletePages(original, translated)).toEqual([]);
  });
});
