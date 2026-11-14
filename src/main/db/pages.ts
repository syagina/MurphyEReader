import type Database from 'better-sqlite3';
import type { PageText, PaperPage } from '@shared/types';

interface PageRow {
  paper_id: number;
  page_no: number;
  text: string;
}

export function replacePages(
  db: Database.Database,
  paperId: number,
  pages: PageText[],
): void {
  const deletePages = db.prepare('DELETE FROM pages WHERE paper_id = ?');
  const insertPage = db.prepare(
    'INSERT INTO pages (paper_id, page_no, text) VALUES (?, ?, ?)',
  );

  const replace = db.transaction((items: PageText[]) => {
    deletePages.run(paperId);
    for (const page of items) {
      insertPage.run(paperId, page.pageNo, page.text);
    }
  });

  replace(pages);
}

export function getPages(db: Database.Database, paperId: number): PaperPage[] {
  const rows = db
    .prepare(
      'SELECT paper_id, page_no, text FROM pages WHERE paper_id = ? ORDER BY page_no',
    )
    .all(paperId) as PageRow[];

  return rows.map((row) => ({
    paperId: row.paper_id,
    pageNo: row.page_no,
    text: row.text,
  }));
}

export function getPageText(
  db: Database.Database,
  paperId: number,
  pageNo: number,
): string | null {
  const row = db
    .prepare('SELECT text FROM pages WHERE paper_id = ? AND page_no = ?')
    .get(paperId, pageNo) as { text: string } | undefined;
  return row ? row.text : null;
}

export function getFullText(db: Database.Database, paperId: number): string {
  return getPages(db, paperId)
    .map((page) => `[第 ${page.pageNo} 页]\n${page.text}`)
    .join('\n\n');
}
