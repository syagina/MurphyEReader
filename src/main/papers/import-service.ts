import { basename, extname } from 'node:path';
import type Database from 'better-sqlite3';
import type { Paper } from '@shared/types';
import { createPaper, updatePaper } from '../db/papers';
import { replacePages } from '../db/pages';
import { extractPdf, getPdfPageCount } from '../pdf/extract';

export async function importPaper(
  db: Database.Database,
  filePath: string,
): Promise<Paper> {
  const extracted = await extractPdf(filePath);

  const paper = createPaper(db, {
    title: extracted.title ?? basename(filePath, extname(filePath)),
    authors: extracted.authors,
    year: null,
    filePathOriginal: filePath,
    filePathTranslated: null,
    pageCountOriginal: extracted.pageCount,
    pageCountTranslated: null,
    hasTextLayer: extracted.hasTextLayer,
    outline: extracted.outline,
  });

  replacePages(db, paper.id, extracted.pages);
  return paper;
}

export async function attachTranslatedPdf(
  db: Database.Database,
  paperId: number,
  filePath: string,
): Promise<Paper> {
  const pageCountTranslated = await getPdfPageCount(filePath);

  return updatePaper(db, paperId, {
    filePathTranslated: filePath,
    pageCountTranslated,
  });
}
