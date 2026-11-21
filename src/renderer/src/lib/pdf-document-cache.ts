import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
} from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { Paper, PdfVersion } from '@shared/types';
import { configurePdfWorker } from './pdf';
import { pageCountFor } from './reading-position';

/** One page's unscaled viewport size. */
export interface PageSize {
  width: number;
  height: number;
}

/** A parsed document plus everything needed to display or destroy it. */
export interface ParsedPdfDocument {
  pdf: PDFDocumentProxy;
  loadingTask: PDFDocumentLoadingTask;
  pageSizes: PageSize[];
}

/** Identity of one cached document, including the generation that owns it. */
export interface PdfCacheKey {
  key: string;
  paperId: number;
  version: PdfVersion;
  generation: number;
}

export interface PdfDocumentEntry extends ParsedPdfDocument {
  key: string;
  paperId: number;
  version: PdfVersion;
  lastUsed: number;
  generation: number;
}

interface InflightLoad {
  key: PdfCacheKey;
  promise: Promise<PdfDocumentEntry>;
}

const MAX_ENTRIES = 3;

/** Rejection message for a load whose generation was invalidated mid-flight. */
export const PDF_CACHE_INVALIDATED = 'PDF 缓存已失效';

const entries = new Map<string, PdfDocumentEntry>();
const inflight = new Map<string, InflightLoad>();
const generations = new Map<number, number>();
let clock = 0;

function generationFor(paperId: number): number {
  return generations.get(paperId) ?? 0;
}

function touch(entry: PdfDocumentEntry): void {
  clock += 1;
  entry.lastUsed = clock;
}

function destroyEntry(entry: PdfDocumentEntry): void {
  void entry.loadingTask.destroy().catch(() => undefined);
}

function evictOverflow(): void {
  while (entries.size > MAX_ENTRIES) {
    let oldest: PdfDocumentEntry | null = null;
    for (const entry of entries.values()) {
      if (oldest === null || entry.lastUsed < oldest.lastUsed) {
        oldest = entry;
      }
    }
    if (oldest === null) {
      return;
    }
    entries.delete(oldest.key);
    destroyEntry(oldest);
  }
}

/** Stable identity for one paper/version/binding/page-count combination. */
export function keyFor(paper: Paper, version: PdfVersion): PdfCacheKey {
  const bindingPath =
    version === 'original' ? paper.filePathOriginal : (paper.filePathTranslated ?? '');
  const pageCount = pageCountFor(paper, version);
  return {
    key: [paper.id, version, bindingPath, pageCount].join('|'),
    paperId: paper.id,
    version,
    generation: generationFor(paper.id),
  };
}

/** Returns a live cache entry, discarding one from a previous generation. */
export function peek(key: PdfCacheKey): PdfDocumentEntry | null {
  const entry = entries.get(key.key);
  if (entry === undefined) {
    return null;
  }
  if (entry.generation !== generationFor(entry.paperId)) {
    entries.delete(entry.key);
    destroyEntry(entry);
    return null;
  }
  touch(entry);
  return entry;
}

/**
 * Returns the cached entry, joins an in-flight load for the same key, or runs
 * the loader. A loader that finishes after invalidation destroys its own
 * document instead of inserting a stale entry.
 */
export function load(
  key: PdfCacheKey,
  loader: () => Promise<ParsedPdfDocument>,
): Promise<PdfDocumentEntry> {
  const cached = peek(key);
  if (cached !== null) {
    return Promise.resolve(cached);
  }
  const pending = inflight.get(key.key);
  if (pending !== undefined) {
    return pending.promise;
  }

  const generation = key.generation;
  const promise = (async (): Promise<PdfDocumentEntry> => {
    const parsed = await loader();
    if (generationFor(key.paperId) !== generation) {
      void parsed.loadingTask.destroy().catch(() => undefined);
      throw new Error(PDF_CACHE_INVALIDATED);
    }
    const entry: PdfDocumentEntry = {
      ...parsed,
      key: key.key,
      paperId: key.paperId,
      version: key.version,
      lastUsed: 0,
      generation,
    };
    touch(entry);
    entries.set(entry.key, entry);
    evictOverflow();
    return entry;
  })();

  const record: InflightLoad = { key, promise };
  inflight.set(key.key, record);
  void promise.then(
    () => {
      if (inflight.get(key.key) === record) {
        inflight.delete(key.key);
      }
    },
    () => {
      if (inflight.get(key.key) === record) {
        inflight.delete(key.key);
      }
    },
  );
  return promise;
}

/** Destroys every entry and in-flight result for one paper. */
export function invalidatePaper(paperId: number): void {
  generations.set(paperId, generationFor(paperId) + 1);
  for (const entry of [...entries.values()]) {
    if (entry.paperId === paperId) {
      entries.delete(entry.key);
      destroyEntry(entry);
    }
  }
}

/** Destroys all cached documents and prevents older in-flight results landing. */
export function clearAll(): void {
  const paperIds = new Set<number>();
  for (const entry of entries.values()) {
    paperIds.add(entry.paperId);
  }
  for (const record of inflight.values()) {
    paperIds.add(record.key.paperId);
  }
  for (const paperId of paperIds) {
    generations.set(paperId, generationFor(paperId) + 1);
  }
  for (const entry of entries.values()) {
    destroyEntry(entry);
  }
  entries.clear();
}

/** Parses a PDF buffer and measures every page at scale 1. */
export async function parsePdfDocument(
  data: ArrayBuffer,
): Promise<ParsedPdfDocument> {
  configurePdfWorker();
  const loadingTask = getDocument({ data: new Uint8Array(data) });
  const pdf = await loadingTask.promise;
  try {
    const pageSizes: PageSize[] = [];
    for (let pageNo = 1; pageNo <= pdf.numPages; pageNo += 1) {
      const page = await pdf.getPage(pageNo);
      const viewport = page.getViewport({ scale: 1 });
      pageSizes.push({ width: viewport.width, height: viewport.height });
    }
    return { pdf, loadingTask, pageSizes };
  } catch (error) {
    void loadingTask.destroy().catch(() => undefined);
    throw error;
  }
}
