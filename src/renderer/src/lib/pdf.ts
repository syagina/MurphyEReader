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

/**
 * Ceiling for the rasterization resolution, in device pixels per PDF point.
 * A page rendered above it would allocate an oversized canvas while adding
 * little to what the eye can resolve.
 */
export const MAX_RENDER_SCALE = 3.5;

/**
 * Device pixels per PDF point used to rasterize a page. Rendering at up to
 * twice the display resolution and letting the browser downsample keeps thin
 * CJK strokes from washing out; at 100% zoom a 10pt glyph is only ~10 device
 * pixels tall. The boost tapers off at {@link MAX_RENDER_SCALE} and never
 * drops below the display resolution.
 */
export function pdfRenderScale(zoom: number, devicePixelRatio: number): number {
  const displayScale = zoom * devicePixelRatio;
  return Math.max(displayScale, Math.min(displayScale * 2, MAX_RENDER_SCALE));
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

export interface SelectionInPage {
  text: string;
  range: Range;
}

/**
 * Returns the trimmed text and range of the current window selection when the
 * whole selection lives inside `pageRoot`; otherwise `null`.
 */
export function getSelectionInPage(pageRoot: HTMLElement): SelectionInPage | null {
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
  return { text, range };
}
