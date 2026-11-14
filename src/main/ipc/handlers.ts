import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import type Database from 'better-sqlite3';
import * as electron from 'electron';
import type { BrowserWindow } from 'electron';
import type { AiSettingsInput, ChatSendRequest, NoteType, Paper } from '@shared/types';
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
import { createNote, deleteNote, listNotes, updateNote } from '../db/notes';
import { replacePages } from '../db/pages';
import { deletePaper, getPaper, listPapers, markRead, updatePaper } from '../db/papers';
import { searchGlobal } from '../db/search';
import { attachTranslatedPdf, importPaper } from '../papers/import-service';
import { extractPdf, getPdfPageCount } from '../pdf/extract';
import { getApiKey, getSettings, setSettings } from '../settings';
import type { SecretStore } from '../settings/secret-store';

export interface HandlerDeps {
  db: Database.Database;
  secret: SecretStore;
  emit: (channel: string, payload: unknown) => void;
  mainWindow: () => BrowserWindow | null;
}

type PaperUpdatePatch = Partial<
  Pick<Paper, 'title' | 'authors' | 'year' | 'tags' | 'lastPageOriginal' | 'lastPageTranslated'>
>;

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

export function registerIpcHandlers(deps: HandlerDeps): void {
  const { db, secret, emit } = deps;

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
    return importPaper(db, filePath);
  });

  electron.ipcMain.handle('papers:attachTranslated', async (_event, id: number) => {
    const filePath = await pickPdf();
    if (filePath === null) {
      return null;
    }
    return attachTranslatedPdf(db, id, filePath);
  });

  electron.ipcMain.handle(
    'papers:update',
    (_event, id: number, patch: PaperUpdatePatch) => updatePaper(db, id, patch),
  );

  electron.ipcMain.handle('papers:remove', (_event, id: number) => {
    deletePaper(db, id);
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
      const paper = getPaper(db, id);
      if (paper === null) {
        throw new Error(`文献不存在: ${id}`);
      }
      if (version === 'translated') {
        const pageCountTranslated = await getPdfPageCount(filePath);
        return updatePaper(db, id, { filePathTranslated: filePath, pageCountTranslated });
      }
      const extracted = await extractPdf(filePath);
      const updated = updatePaper(db, id, {
        filePathOriginal: filePath,
        pageCountOriginal: extracted.pageCount,
        hasTextLayer: extracted.hasTextLayer,
        outline: extracted.outline,
        lastPageOriginal: Math.min(paper.lastPageOriginal, extracted.pageCount),
      });
      replacePages(db, id, extracted.pages);
      return updated;
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
    async (_event, suggestedName: string, content: string) => {
      const result = await electron.dialog.showSaveDialog({
        defaultPath: suggestedName,
        filters: [{ name: 'Markdown', extensions: ['md'] }],
      });
      if (result.canceled || !result.filePath) {
        return null;
      }
      await writeFile(result.filePath, content, 'utf8');
      return result.filePath;
    },
  );

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
}
