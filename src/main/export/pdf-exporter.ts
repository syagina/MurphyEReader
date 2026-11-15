import { randomUUID } from 'node:crypto';
import { BrowserWindow } from 'electron';
import type { WebContents } from 'electron';
import type { PdfExportJob } from '@shared/types';

export interface PdfExporterOptions {
  /** Compiled preload script shared with the main window. */
  preloadPath: string;
  /** Built renderer entry used outside `electron-vite dev`. */
  rendererFile: string;
  /** Development renderer URL; absent in packaged builds. */
  rendererUrl: string | undefined;
  /** Upper bound on waiting for the renderer to finish fonts and layout. */
  timeoutMs?: number;
}

interface ExportJob {
  token: string;
  payload: PdfExportJob;
  window: BrowserWindow;
  ready: Promise<void>;
  resolveReady(): void;
  rejectReady(error: Error): void;
  timer: NodeJS.Timeout | null;
  readySettled: boolean;
}

const DEFAULT_TIMEOUT_MS = 20_000;

/**
 * A4 with readable Chinese-document margins. Chromium's Page.printToPDF
 * measures custom margins in inches, so 56/64 CSS px at 96 dpi become 0.58
 * and 0.67 in. (Electron's typings still say pixels, but values in pixels are
 * rejected at runtime: "margins must be less than or equal to pageSize".)
 */
const PDF_OPTIONS: Electron.PrintToPDFOptions = {
  printBackground: true,
  pageSize: 'A4',
  landscape: false,
  preferCSSPageSize: false,
  margins: {
    marginType: 'custom',
    top: 0.58,
    bottom: 0.67,
    left: 0.58,
    right: 0.58,
  },
  displayHeaderFooter: true,
  headerTemplate: '<span></span>',
  footerTemplate:
    '<div style="width:100%;font-family:\'Segoe UI\',\'Microsoft YaHei\',sans-serif;' +
    'font-size:8px;color:#6b7280;text-align:center;">' +
    '<span class="pageNumber"></span> / <span class="totalPages"></span></div>',
};

/**
 * Renders Markdown to PDF through a hidden BrowserWindow. The renderer gets
 * only a random token in its query string; the document content stays in this
 * main-process map and can be fetched only by that window's webContents.
 */
export class PdfExporter {
  private readonly jobs = new Map<string, ExportJob>();
  private readonly timeoutMs: number;

  constructor(private readonly options: PdfExporterOptions) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async render(payload: PdfExportJob): Promise<Buffer> {
    const token = randomUUID();
    const win = new BrowserWindow({
      show: false,
      width: 900,
      height: 1200,
      useContentSize: true,
      autoHideMenuBar: true,
      backgroundColor: '#ffffff',
      webPreferences: {
        preload: this.options.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    });

    let resolveReady!: () => void;
    let rejectReady!: (error: Error) => void;
    const ready = new Promise<void>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    const job: ExportJob = {
      token,
      payload,
      window: win,
      ready,
      resolveReady,
      rejectReady,
      timer: null,
      readySettled: false,
    };
    job.timer = setTimeout(() => {
      this.rejectReady(job, new Error('生成 PDF 超时，请重试'));
    }, this.timeoutMs);
    this.jobs.set(token, job);

    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (event, url) => {
      // The initial programmatic load carries this job's token. Any other
      // navigation (a stray link inside rendered Markdown is plain text, but
      // defense in depth) is denied.
      if (!url.includes(token)) {
        event.preventDefault();
      }
    });
    win.webContents.on('will-attach-webview', (event) => {
      event.preventDefault();
    });
    win.webContents.on('render-process-gone', (_event, details) => {
      this.rejectReady(job, new Error(`导出页面渲染失败: ${details.reason}`));
    });
    win.on('closed', () => {
      this.rejectReady(job, new Error('导出窗口意外关闭'));
      this.dispose(token, win);
    });

    try {
      await this.loadExportPage(win, token);
      await ready;
      return await win.webContents.printToPDF(PDF_OPTIONS);
    } finally {
      this.dispose(token, win);
    }
  }

  getJob(token: string, sender: WebContents): PdfExportJob | null {
    const job = this.validJob(token, sender);
    if (job === null) {
      return null;
    }
    return { title: job.payload.title, markdown: job.payload.markdown };
  }

  markReady(token: string, sender: WebContents): void {
    const job = this.validJob(token, sender);
    if (job === null) {
      throw new Error('无效的 PDF 导出任务');
    }
    if (job.readySettled) {
      return;
    }
    job.readySettled = true;
    if (job.timer !== null) {
      clearTimeout(job.timer);
    }
    job.resolveReady();
  }

  markFailed(token: string, sender: WebContents, message: string): void {
    const job = this.validJob(token, sender);
    if (job === null) {
      return;
    }
    this.rejectReady(job, new Error(message.trim() === '' ? '导出页面渲染失败' : message));
  }

  private rejectReady(job: ExportJob, error: Error): void {
    if (job.readySettled) {
      return;
    }
    job.readySettled = true;
    if (job.timer !== null) {
      clearTimeout(job.timer);
    }
    job.rejectReady(error);
  }

  private validJob(token: string, sender: WebContents): ExportJob | null {
    const job = this.jobs.get(token);
    if (job === undefined || job.window.isDestroyed()) {
      return null;
    }
    if (job.window.webContents !== sender) {
      return null;
    }
    return job;
  }

  private dispose(token: string, win: BrowserWindow): void {
    const job = this.jobs.get(token);
    if (job !== undefined) {
      if (job.timer !== null) {
        clearTimeout(job.timer);
      }
      this.jobs.delete(token);
    }
    if (!win.isDestroyed()) {
      win.destroy();
    }
  }

  private async loadExportPage(win: BrowserWindow, token: string): Promise<void> {
    const devUrl = this.options.rendererUrl;
    if (devUrl !== undefined && devUrl !== '') {
      const url = new URL(devUrl);
      url.searchParams.set('exportJob', token);
      await win.loadURL(url.toString());
      return;
    }
    await win.loadFile(this.options.rendererFile, { query: { exportJob: token } });
  }
}
