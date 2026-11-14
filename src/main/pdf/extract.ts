import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { getDocument, VerbosityLevel } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { OutlineNode, PageText } from '@shared/types';

export interface ExtractedPdf {
  pageCount: number;
  pages: PageText[];
  hasTextLayer: boolean;
  outline: OutlineNode[];
  title: string | null;
  authors: string;
}

const TEXT_LAYER_MIN_CHARS = 100;

interface PdfOutlineItem {
  title: string;
  dest: string | unknown[] | null;
  items: PdfOutlineItem[];
}

async function loadPdf(filePath: string): Promise<PDFDocumentProxy> {
  const data = new Uint8Array(await readFile(filePath));
  return getDocument({ data, verbosity: VerbosityLevel.ERRORS }).promise;
}

// pdfjs-dist v6 no longer exposes PDFDocumentProxy.destroy(); destroying the
// loading task tears down the transport and worker attached to the document.
async function destroyPdf(pdf: PDFDocumentProxy): Promise<void> {
  await pdf.loadingTask.destroy();
}

type PdfTextContentItem = Awaited<ReturnType<PDFPageProxy['getTextContent']>>['items'][number];

function textContentToString(items: readonly PdfTextContentItem[]): string {
  let text = '';
  for (const item of items) {
    if ('str' in item) {
      text += item.str;
      if (item.hasEOL) {
        text += '\n';
      }
    }
  }
  return text;
}

async function resolveDestPageNo(
  pdf: PDFDocumentProxy,
  dest: PdfOutlineItem['dest'],
): Promise<number | null> {
  try {
    const resolved = typeof dest === 'string' ? await pdf.getDestination(dest) : dest;
    if (Array.isArray(resolved) && resolved.length > 0) {
      const pageIndex = await pdf.getPageIndex(resolved[0]);
      return pageIndex + 1;
    }
  } catch {
    // Best effort only: unresolved destinations fall back to pageNo: null.
  }
  return null;
}

async function mapOutlineItem(
  pdf: PDFDocumentProxy,
  item: PdfOutlineItem,
): Promise<OutlineNode> {
  const pageNo = await resolveDestPageNo(pdf, item.dest);
  const children: OutlineNode[] = [];
  for (const child of item.items ?? []) {
    children.push(await mapOutlineItem(pdf, child));
  }
  return { title: item.title, pageNo, children };
}

async function extractOutline(pdf: PDFDocumentProxy): Promise<OutlineNode[]> {
  try {
    const items = await pdf.getOutline();
    const outline: OutlineNode[] = [];
    for (const item of items ?? []) {
      outline.push(await mapOutlineItem(pdf, item));
    }
    return outline;
  } catch {
    return [];
  }
}

async function extractMetadata(
  pdf: PDFDocumentProxy,
): Promise<{ title: string | null; authors: string }> {
  try {
    const { info } = await pdf.getMetadata();
    const record = info as Record<string, unknown>;
    const title =
      typeof record.Title === 'string' && record.Title.trim() !== '' ? record.Title : null;
    const authors = typeof record.Author === 'string' ? record.Author : '';
    return { title, authors };
  } catch {
    return { title: null, authors: '' };
  }
}

export async function extractPdf(filePath: string): Promise<ExtractedPdf> {
  const pdf = await loadPdf(filePath);
  try {
    const pages: PageText[] = [];
    for (let pageNo = 1; pageNo <= pdf.numPages; pageNo += 1) {
      const page = await pdf.getPage(pageNo);
      const content = await page.getTextContent();
      pages.push({ pageNo, text: textContentToString(content.items) });
    }

    const hasTextLayer =
      pages.reduce((total, page) => total + page.text.trim().length, 0) >=
      TEXT_LAYER_MIN_CHARS;
    const outline = await extractOutline(pdf);
    const metadata = await extractMetadata(pdf);

    return {
      pageCount: pdf.numPages,
      pages,
      hasTextLayer,
      outline,
      title: metadata.title ?? basename(filePath, extname(filePath)),
      authors: metadata.authors,
    };
  } finally {
    await destroyPdf(pdf);
  }
}

export async function getPdfPageCount(filePath: string): Promise<number> {
  const pdf = await loadPdf(filePath);
  try {
    return pdf.numPages;
  } finally {
    await destroyPdf(pdf);
  }
}
