import { useEffect, useState } from 'react';
import type { PdfExportJob } from '@shared/types';
import { errorMessage } from '../lib/errors';
import { loadKatexFonts, nextFrame } from '../lib/katex-fonts';
import { MarkdownView } from './MarkdownView';

interface ExportDocumentProps {
  token: string;
}

/**
 * Wait until KaTeX has written its DOM, the browser has laid it out, and the
 * math fonts have finished loading. Printing before this produces missing
 * glyphs or clipped formulas in the PDF.
 */
async function waitForPrintReady(): Promise<void> {
  await nextFrame();
  await loadKatexFonts();
  await nextFrame();
}

/**
 * Hidden-window document used only by the PDF export flow. It fetches the
 * job from the main process by token, renders the same Markdown AST as the
 * reader, then tells main it is ready to print.
 */
export function ExportDocument({ token }: ExportDocumentProps): React.JSX.Element {
  const [job, setJob] = useState<PdfExportJob | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const nextJob = await window.api.exportFile.getJob(token);
        if (nextJob === null) {
          throw new Error('导出内容不存在或已失效');
        }
        if (cancelled) {
          return;
        }
        document.title = nextJob.title;
        setJob(nextJob);
      } catch (loadError) {
        if (cancelled) {
          return;
        }
        const message = errorMessage(loadError);
        setError(message);
        void window.api.exportFile.fail(token, message).catch(() => undefined);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    if (job === null) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        await waitForPrintReady();
        if (!cancelled) {
          await window.api.exportFile.ready(token);
        }
      } catch (renderError) {
        if (cancelled) {
          return;
        }
        const message = errorMessage(renderError);
        setError(message);
        void window.api.exportFile.fail(token, message).catch(() => undefined);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [job, token]);

  if (error !== null) {
    return (
      <div className="export-error" role="alert">
        导出失败：{error}
      </div>
    );
  }

  if (job === null) {
    return <div className="export-loading">正在准备文档…</div>;
  }

  return (
    <main className="export-document">
      <MarkdownView text={job.markdown} />
    </main>
  );
}
