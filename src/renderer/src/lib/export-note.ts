import type { ExportContext, ExportFormat } from '@shared/types';

export const EXPORT_FORMAT_LABELS: Record<ExportFormat, string> = {
  pdf: 'PDF',
  docx: 'Word',
  md: 'Markdown',
};

/**
 * Saves generated Markdown in the requested format. Markdown stays plain
 * text; PDF goes through the hidden print window; Word is built in the
 * renderer (formulas become images) and written by the main process.
 */
export async function exportNoteDocument(
  fileName: string,
  title: string,
  markdown: string,
  format: ExportFormat,
  context?: ExportContext,
): Promise<string | null> {
  switch (format) {
    case 'md':
      return window.api.exportFile.save(fileName, markdown, context);
    case 'pdf':
      return window.api.exportFile.printPdf(fileName, title, markdown, context);
    case 'docx': {
      const { buildNotesDocx } = await import('./docx-export');
      const data = await buildNotesDocx(markdown, title);
      return window.api.exportFile.saveDocx(fileName, data, context);
    }
  }
}
