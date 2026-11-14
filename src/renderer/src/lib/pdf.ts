import { GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

/**
 * The subset of `PDFDocumentProxy` used by `findInDocument`. `type` is
 * optional only so pdfjs's `TextMarkedContent` items satisfy the structure;
 * only `str` is ever read.
 */
export interface SearchablePdf {
  numPages: number;
  getPage(pageNo: number): Promise<{
    getTextContent(): Promise<{ items: Array<{ str?: string; type?: string }> }>;
  }>;
}

/** Creates a fresh text layer for the current document. */
export function configurePdfWorker(): void {
  GlobalWorkerOptions.workerSrc = workerUrl;
}

/** Rounds `page` and clamps it into `[1, pageCount]`; empty documents report page 1. */
export function clampPage(page: number, pageCount: number): number {
  if (pageCount <= 0) {
    return 1;
  }
  if (!Number.isFinite(page)) {
    return 1;
  }
  return Math.min(pageCount, Math.max(1, Math.round(page)));
}

/** Inclusive ascending page numbers around `currentPage`, limited to `radius`. */
export function buildPageWindow(currentPage: number, pageCount: number, radius = 2): number[] {
  if (pageCount <= 0) {
    return [];
  }
  const current = clampPage(currentPage, pageCount);
  const first = Math.max(1, current - radius);
  const last = Math.min(pageCount, current + radius);
  const pages: number[] = [];
  for (let page = first; page <= last; page += 1) {
    pages.push(page);
  }
  return pages;
}

/**
 * Scans every page of `pdf` for a case-insensitive substring match.
 * Returns ascending 1-based page numbers. Empty/blank queries short-circuit to
 * `[]` without touching the document; text extraction errors propagate.
 */
export async function findInDocument(pdf: SearchablePdf, query: string): Promise<number[]> {
  const needle = query.trim().toLowerCase();
  if (needle === '') {
    return [];
  }
  const matches: number[] = [];
  for (let pageNo = 1; pageNo <= pdf.numPages; pageNo += 1) {
    const page = await pdf.getPage(pageNo);
    const content = await page.getTextContent();
    let text = '';
    for (const item of content.items) {
      text += item.str ?? '';
    }
    if (text.toLowerCase().includes(needle)) {
      matches.push(pageNo);
    }
  }
  return matches;
}

/**
 * Returns the trimmed text of the current window selection when the whole
 * selection lives inside `pageRoot`; otherwise `null`.
 */
export function getSelectionInPage(pageRoot: HTMLElement): { text: string } | null {
  const selection = window.getSelection();
  if (selection === null || selection.isCollapsed || selection.rangeCount === 0) {
    return null;
  }
  const text = selection.toString().trim();
  if (text === '') {
    return null;
  }
  const range = selection.getRangeAt(0);
  // `contains` is true for the root itself as well as its descendants.
  if (!pageRoot.contains(range.commonAncestorContainer)) {
    return null;
  }
  return { text };
}
