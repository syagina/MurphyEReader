import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
} from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { Paper } from '@shared/types';
import {
  clearAll,
  invalidatePaper,
  keyFor,
  load,
  peek,
} from '@renderer/lib/pdf-document-cache';

function makePaper(id: number, overrides: Partial<Paper> = {}): Paper {
  return {
    id,
    title: `论文 ${id}`,
    authors: '张三',
    year: 2020,
    filePathOriginal: `C:/papers/${id}.pdf`,
    filePathTranslated: `C:/papers/${id}-zh.pdf`,
    pageCountOriginal: 10,
    pageCountTranslated: 12,
    pageCountBilingual: 24,
    hasTextLayer: true,
    outline: [],
    tags: [],
    lastPageOriginal: 1,
    lastPageTranslated: 1,
    lastVersion: 'original',
    lastOffsetOriginal: 0,
    lastOffsetTranslated: 0,
    addedAt: 1000,
    lastReadAt: null,
    folderId: null,
    storageDir: null,
    fileHash: null,
    ...overrides,
  };
}

function fakeDocument(numPages = 1) {
  const destroy = vi.fn(async () => undefined);
  const loadingTask = { destroy } as unknown as PDFDocumentLoadingTask;
  const pdf = { numPages } as unknown as PDFDocumentProxy;
  return {
    parsed: { pdf, loadingTask, pageSizes: [] },
    destroy,
  };
}

beforeEach(() => {
  clearAll();
});

describe('keyFor', () => {
  it('按文献、版本、绑定路径与页数生成缓存键', () => {
    const paper = makePaper(1);
    const original = keyFor(paper, 'original');
    expect(original.key).toBe('1|original|C:/papers/1.pdf|10');

    expect(keyFor(paper, 'translated').key).toBe(
      '1|translated|C:/papers/1-zh.pdf|12',
    );
    // Both translated layouts share one binding path and page-count fallback.
    expect(keyFor(paper, 'bilingual').key).toBe(
      '1|bilingual|C:/papers/1-zh.pdf|24',
    );

    expect(keyFor(makePaper(2), 'original').key).not.toBe(original.key);
    expect(
      keyFor(makePaper(1, { pageCountOriginal: 11 }), 'original').key,
    ).not.toBe(original.key);
    expect(
      keyFor(makePaper(1, { filePathOriginal: 'D:/other.pdf' }), 'original').key,
    ).not.toBe(original.key);
  });
});

describe('load and peek', () => {
  it('载入后 peek 返回同一缓存项并更新最近使用时间', async () => {
    const paper = makePaper(1);
    const key = keyFor(paper, 'original');
    const { parsed } = fakeDocument(10);
    const loader = vi.fn(async () => parsed);

    const entry = await load(key, loader);

    expect(loader).toHaveBeenCalledTimes(1);
    expect(entry.pdf).toBe(parsed.pdf);
    const cached = peek(key);
    expect(cached).toBe(entry);
    expect(cached?.lastUsed).toBeGreaterThan(0);
  });

  it('同一个键的并发载入只调用一次 loader', async () => {
    const paper = makePaper(1);
    const key = keyFor(paper, 'original');
    const { parsed } = fakeDocument();
    let resolveLoader!: () => void;
    const gate = new Promise<void>((resolve) => {
      resolveLoader = resolve;
    });
    const loader = vi.fn(async () => {
      await gate;
      return parsed;
    });

    const first = load(key, loader);
    const second = load(key, loader);
    resolveLoader();

    const [a, b] = await Promise.all([first, second]);
    expect(a).toBe(b);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('同一个键再次 load 时直接复用缓存', async () => {
    const paper = makePaper(1);
    const key = keyFor(paper, 'original');
    const { parsed } = fakeDocument();
    const loader = vi.fn(async () => parsed);

    await load(key, loader);
    const again = await load(key, loader);

    expect(loader).toHaveBeenCalledTimes(1);
    expect(again.pdf).toBe(parsed.pdf);
  });
});

describe('invalidatePaper', () => {
  it('销毁旧缓存项并阻止旧代在途结果落入缓存', async () => {
    const paper = makePaper(1);
    const key = keyFor(paper, 'original');
    const { parsed, destroy } = fakeDocument();
    let resolveLoader!: () => void;
    const gate = new Promise<void>((resolve) => {
      resolveLoader = resolve;
    });
    const loading = load(key, async () => {
      await gate;
      return parsed;
    });

    invalidatePaper(paper.id);
    resolveLoader();

    await expect(loading).rejects.toThrow('PDF 缓存已失效');
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(peek(key)).toBeNull();

    // The new generation can load the same identity again.
    const fresh = fakeDocument();
    const freshKey = keyFor(paper, 'original');
    const entry = await load(freshKey, async () => fresh.parsed);
    expect(entry.pdf).toBe(fresh.parsed.pdf);
    expect(entry.generation).toBeGreaterThan(key.generation);
  });

  it('销毁已缓存项，且不影响其他文献', async () => {
    const paperA = makePaper(1);
    const paperB = makePaper(2);
    const a = fakeDocument();
    const b = fakeDocument();
    const keyA = keyFor(paperA, 'original');
    const keyB = keyFor(paperB, 'original');
    await load(keyA, async () => a.parsed);
    await load(keyB, async () => b.parsed);

    invalidatePaper(paperA.id);

    expect(a.destroy).toHaveBeenCalledTimes(1);
    expect(peek(keyFor(paperA, 'original'))).toBeNull();
    expect(peek(keyB)?.pdf).toBe(b.parsed.pdf);
    expect(b.destroy).not.toHaveBeenCalled();
  });
});

describe('clearAll', () => {
  it('销毁全部缓存，并让在途结果自行销毁', async () => {
    const paper = makePaper(1);
    const cached = fakeDocument();
    const cachedKey = keyFor(paper, 'original');
    await load(cachedKey, async () => cached.parsed);

    const paper2 = makePaper(2);
    const key2 = keyFor(paper2, 'translated');
    const inflight = fakeDocument();
    let resolveLoader!: () => void;
    const gate = new Promise<void>((resolve) => {
      resolveLoader = resolve;
    });
    const loading = load(key2, async () => {
      await gate;
      return inflight.parsed;
    });

    clearAll();
    resolveLoader();

    await expect(loading).rejects.toThrow('PDF 缓存已失效');
    expect(cached.destroy).toHaveBeenCalledTimes(1);
    expect(inflight.destroy).toHaveBeenCalledTimes(1);
    expect(peek(cachedKey)).toBeNull();
    expect(peek(key2)).toBeNull();
  });
});

describe('缓存容量', () => {
  it('超过三项时淘汰最久未使用的文档', async () => {
    const papers = [1, 2, 3, 4].map((id) => makePaper(id));
    const docs = papers.map(() => fakeDocument());
    const keys = papers.map((paper) => keyFor(paper, 'original'));

    for (let index = 0; index < papers.length; index += 1) {
      await load(keys[index], async () => docs[index].parsed);
    }

    expect(docs[0].destroy).toHaveBeenCalledTimes(1);
    expect(peek(keys[0])).toBeNull();
    expect(peek(keys[1])).not.toBeNull();
    expect(peek(keys[2])).not.toBeNull();
    expect(peek(keys[3])).not.toBeNull();
  });
});
