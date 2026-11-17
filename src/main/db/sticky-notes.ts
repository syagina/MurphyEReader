import type Database from 'better-sqlite3';
import type {
  AnnotationKind,
  PdfVersion,
  StickyNote,
  StickyNoteCreateData,
  StickyNoteSource,
  StickyNoteUpdatePatch,
} from '@shared/types';
import {
  STICKY_NOTE_LIMITS,
  parseAnnotationColor,
  parseAnnotationDrawing,
  parseAnnotationKind,
  parseAnnotationMarkStyle,
  parseAnnotationPin,
  parseAnnotationPopup,
  parseStickyNoteAnchor,
} from '@shared/sticky-notes';

interface StickyNoteRow {
  id: number;
  paper_id: number;
  pdf_version: PdfVersion;
  page_no: number;
  quote: string;
  content_md: string;
  anchor_json: string;
  source: StickyNoteSource;
  kind: string;
  mark_style: string;
  color: string | null;
  pin_json: string | null;
  popup_json: string | null;
  drawing_json: string | null;
  created_at: number;
  updated_at: number;
}

const MAX_DRAWINGS_PER_PAGE = 500;

const ORDER_BY = 'ORDER BY page_no ASC, created_at ASC, id ASC';

function serializeJson(value: unknown): string | null {
  return value === null ? null : JSON.stringify(value);
}

function mapRow(row: StickyNoteRow): StickyNote {
  const anchor = parseStickyNoteAnchor(row.anchor_json);
  // Design invariant: a page anchor is always markless. A v3 sticky note
  // upgraded by migration predates `mark_style`, so it still carries the v4
  // column default `'highlight'`; normalize at the read boundary rather than
  // trusting the stored pair.
  const pageAnchor = anchor.kind === 'page';
  const markStyle = pageAnchor
    ? 'none'
    : parseAnnotationMarkStyle(row.mark_style);
  const color = pageAnchor ? null : parseAnnotationColor(row.color);
  const drawing = parseAnnotationDrawing(row.drawing_json);
  return {
    id: row.id,
    paperId: row.paper_id,
    pdfVersion: row.pdf_version,
    pageNo: row.page_no,
    quote: row.quote,
    contentMd: row.content_md,
    anchor,
    source: row.source,
    kind: parseAnnotationKind(row.kind, row.content_md, markStyle, drawing),
    markStyle,
    color,
    pin: parseAnnotationPin(row.pin_json),
    popup: parseAnnotationPopup(row.popup_json),
    drawing,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createStickyNote(
  db: Database.Database,
  input: StickyNoteCreateData,
): StickyNote {
  if (input.kind === 'ink' || input.kind === 'shape') {
    const existing = countPageDrawings(
      db,
      input.paperId,
      input.pdfVersion,
      input.pageNo,
    );
    if (existing >= MAX_DRAWINGS_PER_PAGE) {
      throw new Error(`单页绘制标注不能超过 ${MAX_DRAWINGS_PER_PAGE} 条`);
    }
  }

  const now = Date.now();
  const result = db
    .prepare(
      `INSERT INTO sticky_notes (
        paper_id, pdf_version, page_no, quote, content_md, anchor_json,
        source, kind, mark_style, color, pin_json, popup_json, drawing_json,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.paperId,
      input.pdfVersion,
      input.pageNo,
      input.quote,
      input.contentMd,
      JSON.stringify(input.anchor),
      input.source,
      input.kind,
      input.markStyle,
      input.color,
      serializeJson(input.pin),
      serializeJson(input.popup),
      serializeJson(input.drawing),
      now,
      now,
    );

  const id = Number(result.lastInsertRowid);
  const note = getStickyNote(db, id);
  if (!note) {
    throw new Error(`标注写入后未找到: ${id}`);
  }
  return note;
}

export function listStickyNotes(
  db: Database.Database,
  paperId: number,
  version: PdfVersion,
): StickyNote[] {
  const rows = db
    .prepare(
      `SELECT * FROM sticky_notes
       WHERE paper_id = ? AND pdf_version = ?
       ${ORDER_BY}`,
    )
    .all(paperId, version) as StickyNoteRow[];
  return rows.map(mapRow);
}

export function getStickyNote(
  db: Database.Database,
  id: number,
): StickyNote | null {
  const row = db.prepare('SELECT * FROM sticky_notes WHERE id = ?').get(id) as
    | StickyNoteRow
    | undefined;
  return row ? mapRow(row) : null;
}

export function updateStickyNote(
  db: Database.Database,
  id: number,
  patch: StickyNoteUpdatePatch,
): StickyNote {
  const current = getStickyNote(db, id);
  if (!current) {
    throw new Error(`标注不存在: ${id}`);
  }
  if (current.kind === 'ink' || current.kind === 'shape') {
    throw new Error('绘制标注不能通过更新接口修改');
  }

  const contentMd = patch.contentMd ?? current.contentMd;
  if (contentMd.length > STICKY_NOTE_LIMITS.contentMd) {
    throw new Error(`标注内容不能超过 ${STICKY_NOTE_LIMITS.contentMd} 个字符`);
  }

  let markStyle = patch.markStyle ?? current.markStyle;
  let color = patch.color !== undefined ? patch.color : current.color;
  let pin = patch.pin !== undefined ? patch.pin : current.pin;
  let popup = patch.popup !== undefined ? patch.popup : current.popup;

  let kind: AnnotationKind;
  if (contentMd.trim() !== '') {
    kind = 'note';
  } else if (markStyle !== 'none') {
    kind = 'mark';
    pin = null;
    popup = null;
  } else {
    throw new Error('清空内容后请保留一种正文标记');
  }

  if (current.anchor.kind === 'page') {
    if (contentMd.trim() === '') {
      throw new Error('整页标注必须填写内容');
    }
    kind = 'note';
    markStyle = 'none';
    color = null;
  }

  if (markStyle === 'none') {
    color = null;
  }

  db.prepare(
    `UPDATE sticky_notes SET
       content_md = ?, kind = ?, mark_style = ?, color = ?,
       pin_json = ?, popup_json = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    contentMd,
    kind,
    markStyle,
    color,
    serializeJson(pin),
    serializeJson(popup),
    Date.now(),
    id,
  );

  const updated = getStickyNote(db, id);
  if (!updated) {
    throw new Error(`标注不存在: ${id}`);
  }
  return updated;
}

export function deleteStickyNote(db: Database.Database, id: number): void {
  db.prepare('DELETE FROM sticky_notes WHERE id = ?').run(id);
}

export function countPageDrawings(
  db: Database.Database,
  paperId: number,
  version: PdfVersion,
  pageNo: number,
): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS count FROM sticky_notes
       WHERE paper_id = ? AND pdf_version = ? AND page_no = ?
         AND kind IN ('ink','shape')`,
    )
    .get(paperId, version, pageNo) as { count: number };
  return row.count;
}

export function clearPageDrawings(
  db: Database.Database,
  paperId: number,
  version: PdfVersion,
  pageNo: number,
): number {
  const result = db
    .prepare(
      `DELETE FROM sticky_notes
       WHERE paper_id = ? AND pdf_version = ? AND page_no = ?
         AND kind IN ('ink','shape')`,
    )
    .run(paperId, version, pageNo);
  return result.changes;
}
