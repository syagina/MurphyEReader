import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import type Database from 'better-sqlite3';
import * as electron from 'electron';
import type { BrowserWindow } from 'electron';
import type {
  AiSettingsInput,
  AppSettings,
  AppSettingsUpdate,
  ChatSendRequest,
  ExportContext,
  LegacyMigrationSummary,
  NoteType,
  PaperUpdatePatch,
} from '@shared/types';
import { abortChat, startChat } from '../ai/chat-service';
import { AiClient } from '../ai/client';
import { generateNote } from '../ai/note-service';
import {
  createConversation,
  deleteConversation,
  listConversations,
  listMessages,
  renameConversation,
} from '../db/conversations';
import { createFolder, getFolder, listFolders, removeFolder, renameFolder } from '../db/folders';
import { createNote, deleteNote, listNotes, updateNote } from '../db/notes';
import { getPaper, listPapers, markRead, updatePaper } from '../db/papers';
import { searchGlobal } from '../db/search';
import { prepareExportDefaultPath } from '../export/default-path';
import { ensureFileExtension } from '../export/file-path';
import { PdfExporter } from '../export/pdf-exporter';
import { JobRegistry } from '../jobs/job-registry';
import { getApiKey, getSettings, setSettings } from '../settings';
import { getStoredAppSettings, setStoredAppSettings } from '../settings/app-settings';
import type { SecretStore } from '../settings/secret-store';
import { migrateLegacyPapers } from '../storage/legacy-migration';
import { PaperLibrary } from '../storage/library-service';
import { isCanonicalStorageDir } from '../storage/paths';
import { changeLibraryRoot } from '../storage/root-change';
import { readStorageInfo } from '../storage/storage-info';

export interface HandlerDeps {
  db: Database.Database;
  secret: SecretStore;
  documentsDir: string;
  emit: (channel: string, payload: unknown) => void;
  mainWindow: () => BrowserWindow | null;
}

type NoteCreateInput = {
  paperId: number;
  type: NoteType;
  title: string;
  contentMd: string;
  tags: string[];
};

type NoteGenerateParams = {
  paperId: number;
  selectionText?: string;
  conceptTitle?: string;
  currentPageNo?: number;
};

/**
 * Resolves the PDF path for a paper version. Missing papers and unbound
 * translations are explicit errors so the renderer can show a message instead
 * of crashing (Review Focus #4).
 */
export function resolvePaperPath(
  db: Database.Database,
  paperId: number,
  version: 'original' | 'translated',
): string {
  const paper = getPaper(db, paperId);
  if (paper === null) {
    throw new Error(`文献不存在: ${paperId}`);
  }
  if (version === 'translated') {
    if (paper.filePathTranslated === null || paper.filePathTranslated === '') {
      throw new Error('未绑定译本');
    }
    return paper.filePathTranslated;
  }
  return paper.filePathOriginal;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const EXPORT_CONTEXT_ERROR = '导出参数无效';

/** A context is valid when it names a known scope and, if present, a real paper id. */
function isValidExportContext(context: unknown): context is ExportContext {
  if (typeof context !== 'object' || context === null) {
    return false;
  }
  const candidate = context as { scope?: unknown; paperId?: unknown };
  if (candidate.scope !== 'note' && candidate.scope !== 'all') {
    return false;
  }
  if (candidate.paperId === undefined) {
    return true;
  }
  return (
    typeof candidate.paperId === 'number' &&
    Number.isInteger(candidate.paperId) &&
    candidate.paperId > 0
  );
}

/**
 * Reads a PDF into an ArrayBuffer that contains exactly the file bytes (no
 * shared Buffer-pool overrun) plus the base name for the viewer.
 */
export async function toLoadPayload(
  filePath: string,
): Promise<{ data: ArrayBuffer; fileName: string }> {
  if (!existsSync(filePath)) {
    throw new Error(`文件不存在: ${filePath}`);
  }
  const buffer = await readFile(filePath);
  const data = buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  ) as ArrayBuffer;
  return { data, fileName: basename(filePath) };
}

export function registerIpcHandlers(deps: HandlerDeps): {
  jobs: JobRegistry;
  startStorageMigration(): Promise<void>;
} {
  const { db, secret, emit } = deps;
  const jobs = new JobRegistry((state) => {
    emit('storage:busy', state);
    emit('translation:state', state);
  });
  const libraryRoot = (): string =>
    getStoredAppSettings(db, deps.documentsDir).libraryRoot;
  // Without a context the v1.2 behavior is unchanged: the dialog starts at the
  // suggested name. A note export uses the paper's canonical managed folder;
  // an unmanaged paper, a missing row or a non-canonical folder still exports
  // into Documents rather than blocking.
  const exportDefaultPath = async (
    suggestedName: string,
    context: ExportContext | undefined,
  ): Promise<string> => {
    if (context === undefined) {
      return suggestedName;
    }
    if (!isValidExportContext(context)) {
      throw new Error(EXPORT_CONTEXT_ERROR);
    }
    let storageDir: string | null = null;
    if (context.scope === 'note' && context.paperId !== undefined) {
      const paper = getPaper(db, context.paperId);
      if (
        paper !== null &&
        paper.storageDir !== null &&
        isCanonicalStorageDir(paper.storageDir, paper.id)
      ) {
        storageDir = paper.storageDir;
      }
    }
    return prepareExportDefaultPath({
      root: libraryRoot(),
      storageDir,
      fallbackDir: deps.documentsDir,
      fileName: suggestedName,
      scope: context.scope,
    });
  };
  const library = new PaperLibrary({
    db,
    jobs,
    getRoot: libraryRoot,
    emit,
  });
  // Task 12 replaces the detected engine path with a real probe; until then
  // the field is present but empty.
  const readAppSettings = (): AppSettings => ({
    ...getStoredAppSettings(db, deps.documentsDir),
    babeldocDetectedPath: null,
  });
  const pdfExporter = new PdfExporter({
    preloadPath: join(__dirname, '../preload/index.js'),
    rendererFile: join(__dirname, '../renderer/index.html'),
    rendererUrl: process.env['ELECTRON_RENDERER_URL'],
  });

  // Migration status survives worker failures so the storage info page can
  // report the last pass and its Chinese error instead of losing it.
  let lastMigration: LegacyMigrationSummary | null = null;
  let lastStorageError: string | null = null;

  const runStorageMigration = async (): Promise<LegacyMigrationSummary> => {
    try {
      const summary = await migrateLegacyPapers(db, jobs, libraryRoot(), emit);
      lastMigration = summary;
      lastStorageError = null;
      return summary;
    } catch (error) {
      lastStorageError = errorMessage(error);
      throw error;
    }
  };

  const pickPdf = async (): Promise<string | null> => {
    const result = await electron.dialog.showOpenDialog({
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    return result.filePaths[0];
  };

  // Reads settings and the decrypted key on every call so changes apply to
  // subsequent requests without restarting the app.
  const ai = new AiClient(() => {
    const settings = getSettings(db, secret);
    return {
      baseUrl: settings.baseUrl,
      apiKey: getApiKey(db, secret),
      chatModel: settings.chatModel,
      visionModel: settings.visionModel,
      temperature: settings.temperature,
    };
  });

  electron.ipcMain.handle('papers:list', () => listPapers(db));

  electron.ipcMain.handle('papers:get', (_event, id: number) => getPaper(db, id));

  electron.ipcMain.handle('papers:import', async () => {
    const filePath = await pickPdf();
    if (filePath === null) {
      return null;
    }
    return library.importPaper(filePath);
  });

  electron.ipcMain.handle('papers:attachTranslated', async (_event, id: number) => {
    const filePath = await pickPdf();
    if (filePath === null) {
      return null;
    }
    return library.attachTranslated(id, filePath);
  });

  electron.ipcMain.handle(
    'papers:update',
    (_event, id: number, patch: PaperUpdatePatch) => {
      // `folderId` may clear the folder (null) but never point at a missing one.
      if (
        patch.folderId !== undefined &&
        patch.folderId !== null &&
        getFolder(db, patch.folderId) === null
      ) {
        throw new Error('文件夹不存在');
      }
      return updatePaper(db, id, patch);
    },
  );

  electron.ipcMain.handle('papers:remove', (_event, id: number) => library.removePaper(id));

  electron.ipcMain.handle('folders:list', () => listFolders(db));

  electron.ipcMain.handle('folders:create', (_event, name: string) => createFolder(db, name));

  electron.ipcMain.handle('folders:rename', (_event, id: number, name: string) => {
    // The DB layer reports `文件夹不存在: <id>`; the UI needs the bare message.
    if (getFolder(db, id) === null) {
      throw new Error('文件夹不存在');
    }
    return renameFolder(db, id, name);
  });

  electron.ipcMain.handle('folders:remove', (_event, id: number) => {
    removeFolder(db, id);
  });

  electron.ipcMain.handle(
    'papers:markRead',
    (_event, id: number, version: 'original' | 'translated', pageNo: number) => {
      markRead(db, id, version, pageNo);
    },
  );

  electron.ipcMain.handle('papers:checkFiles', () =>
    listPapers(db).map((paper) => ({
      id: paper.id,
      originalExists: paper.filePathOriginal !== '' && existsSync(paper.filePathOriginal),
      translatedExists:
        paper.filePathTranslated !== null &&
        paper.filePathTranslated !== '' &&
        existsSync(paper.filePathTranslated),
    })),
  );

  electron.ipcMain.handle(
    'papers:relocate',
    async (_event, id: number, version: 'original' | 'translated') => {
      const filePath = await pickPdf();
      if (filePath === null) {
        return null;
      }
      return library.relocate(id, version, filePath);
    },
  );

  electron.ipcMain.handle(
    'pdf:load',
    async (_event, paperId: number, version: 'original' | 'translated') =>
      toLoadPayload(resolvePaperPath(db, paperId, version)),
  );

  electron.ipcMain.handle('conversations:list', (_event, paperId: number) =>
    listConversations(db, paperId),
  );

  electron.ipcMain.handle(
    'conversations:create',
    (_event, paperId: number, title: string) => createConversation(db, paperId, title),
  );

  electron.ipcMain.handle('conversations:rename', (_event, id: number, title: string) => {
    renameConversation(db, id, title);
  });

  electron.ipcMain.handle('conversations:remove', (_event, id: number) => {
    deleteConversation(db, id);
  });

  electron.ipcMain.handle('messages:list', (_event, conversationId: number) =>
    listMessages(db, conversationId),
  );

  electron.ipcMain.handle('chat:send', (_event, req: ChatSendRequest) =>
    startChat(
      {
        db,
        ai,
        getSettings: () => getSettings(db, secret),
        emit,
        newRequestId: () => randomUUID(),
      },
      req,
    ),
  );

  electron.ipcMain.handle('chat:abort', (_event, requestId: string) => {
    abortChat(requestId);
  });

  electron.ipcMain.handle('notes:list', (_event, paperId?: number) => listNotes(db, paperId));

  electron.ipcMain.handle('notes:create', (_event, input: NoteCreateInput) =>
    createNote(db, input),
  );

  electron.ipcMain.handle(
    'notes:update',
    (_event, id: number, patch: { title?: string; contentMd?: string; tags?: string[] }) =>
      updateNote(db, id, patch),
  );

  electron.ipcMain.handle('notes:remove', (_event, id: number) => {
    deleteNote(db, id);
  });

  electron.ipcMain.handle(
    'notes:generate',
    (_event, kind: 'summary' | 'concept' | 'innovation', params: NoteGenerateParams) =>
      generateNote({ db, ai, getSettings: () => getSettings(db, secret) }, kind, params),
  );

  electron.ipcMain.handle('search:global', (_event, query: string) => searchGlobal(db, query));

  electron.ipcMain.handle(
    'export:save',
    async (
      _event,
      suggestedName: string,
      content: string,
      context?: ExportContext,
    ) => {
      const defaultPath = await exportDefaultPath(suggestedName, context);
      const result = await electron.dialog.showSaveDialog({
        defaultPath,
        filters: [{ name: 'Markdown', extensions: ['md'] }],
      });
      if (result.canceled || !result.filePath) {
        return null;
      }
      await writeFile(result.filePath, content, 'utf8');
      return result.filePath;
    },
  );

  electron.ipcMain.handle(
    'export:saveDocx',
    async (
      _event,
      suggestedName: string,
      data: Uint8Array,
      context?: ExportContext,
    ) => {
      if (typeof suggestedName !== 'string' || !(data instanceof Uint8Array)) {
        throw new Error('Word 导出数据无效');
      }
      const defaultPath = await exportDefaultPath(suggestedName, context);
      const result = await electron.dialog.showSaveDialog({
        defaultPath,
        filters: [{ name: 'Word 文档', extensions: ['docx'] }],
      });
      if (result.canceled || !result.filePath) {
        return null;
      }
      const target = ensureFileExtension(result.filePath, '.docx');
      await writeFile(target, Buffer.from(data));
      return target;
    },
  );

  electron.ipcMain.handle(
    'export:printPdf',
    async (
      _event,
      suggestedName: string,
      title: string,
      markdown: string,
      context?: ExportContext,
    ): Promise<string | null> => {
      if (
        typeof suggestedName !== 'string' ||
        typeof title !== 'string' ||
        typeof markdown !== 'string'
      ) {
        throw new Error('PDF 导出参数无效');
      }
      if (markdown.length > 20_000_000) {
        throw new Error('导出内容过大');
      }
      const defaultPath = await exportDefaultPath(suggestedName, context);
      const result = await electron.dialog.showSaveDialog({
        defaultPath,
        filters: [{ name: 'PDF 文档', extensions: ['pdf'] }],
      });
      if (result.canceled || !result.filePath) {
        return null;
      }
      const target = ensureFileExtension(result.filePath, '.pdf');
      const pdf = await pdfExporter.render({
        title: title.trim() === '' ? 'PaperLens 笔记' : title,
        markdown,
      });
      await writeFile(target, pdf);
      return target;
    },
  );

  electron.ipcMain.handle('export:getJob', (event, token: string) =>
    typeof token === 'string' ? pdfExporter.getJob(token, event.sender) : null,
  );

  electron.ipcMain.handle('export:ready', (event, token: string) => {
    if (typeof token !== 'string') {
      throw new Error('无效的 PDF 导出任务');
    }
    pdfExporter.markReady(token, event.sender);
  });

  electron.ipcMain.handle('export:fail', (event, token: string, message: string) => {
    if (typeof token === 'string' && typeof message === 'string') {
      pdfExporter.markFailed(token, event.sender, message);
    }
  });

  electron.ipcMain.handle('window:setFullscreen', (_event, fullscreen: boolean) => {
    const win = deps.mainWindow();
    if (win === null) {
      return false;
    }
    win.setFullScreen(fullscreen);
    return win.isFullScreen();
  });

  electron.ipcMain.handle('settings:get', () => getSettings(db, secret));

  electron.ipcMain.handle('settings:set', (_event, input: AiSettingsInput) =>
    setSettings(db, secret, input),
  );

  electron.ipcMain.handle('settings:test', (_event, input: AiSettingsInput) => {
    const client = new AiClient(() => ({
      baseUrl: input.baseUrl,
      apiKey: input.apiKey === undefined ? getApiKey(db, secret) : input.apiKey,
      chatModel: input.chatModel,
      visionModel: input.visionModel,
      temperature: input.temperature,
    }));
    return client.testConnection();
  });

  electron.ipcMain.handle('storage:getInfo', () =>
    readStorageInfo(db, deps.documentsDir, lastMigration, lastStorageError),
  );

  // A manual retry reports its failure to the caller after recording it; the
  // startup run below swallows it so the window still opens.
  electron.ipcMain.handle('storage:migrateLegacy', () => runStorageMigration());

  electron.ipcMain.handle('storage:chooseRoot', async () => {
    const result = await electron.dialog.showOpenDialog({
      defaultPath: libraryRoot(),
      properties: ['openDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    return result.filePaths[0];
  });

  electron.ipcMain.handle('storage:changeRoot', async (_event, newRoot: string) => {
    const result = await changeLibraryRoot(db, jobs, libraryRoot(), newRoot);
    // The old migration summary and error describe the previous root.
    lastMigration = null;
    lastStorageError = null;
    return result;
  });

  electron.ipcMain.handle('storage:importFolder', async () => {
    const result = await electron.dialog.showOpenDialog({
      properties: ['openDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    return library.importFolder(result.filePaths[0]);
  });

  electron.ipcMain.handle('storage:cancelImport', () => {
    library.cancelImport();
  });

  electron.ipcMain.handle('storage:openRoot', async () => {
    const message = await electron.shell.openPath(libraryRoot());
    if (message !== '') {
      throw new Error(`无法打开文件夹：${message}`);
    }
  });

  electron.ipcMain.handle('storage:revealPaper', async (_event, paperId: number) => {
    const paper = getPaper(db, paperId);
    if (paper === null) {
      throw new Error(`文献不存在: ${paperId}`);
    }
    let folder: string;
    if (paper.storageDir !== null) {
      if (!isCanonicalStorageDir(paper.storageDir, paper.id)) {
        throw new Error('文献文件夹路径异常，请重新定位或导入');
      }
      folder = join(libraryRoot(), paper.storageDir);
    } else {
      if (paper.filePathOriginal === '') {
        throw new Error('无法打开文件夹：原文路径为空');
      }
      folder = dirname(paper.filePathOriginal);
    }
    const message = await electron.shell.openPath(folder);
    if (message !== '') {
      throw new Error(`无法打开文件夹：${message}`);
    }
  });

  electron.ipcMain.handle('appSettings:get', () => readAppSettings());

  electron.ipcMain.handle('appSettings:update', (_event, patch: AppSettingsUpdate) => {
    setStoredAppSettings(db, patch);
    return readAppSettings();
  });

  return {
    jobs,
    async startStorageMigration(): Promise<void> {
      try {
        await runStorageMigration();
      } catch {
        // Recorded in lastStorageError and surfaced through storage:getInfo.
      }
    },
  };
}
