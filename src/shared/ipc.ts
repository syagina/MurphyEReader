import type {
  AiSettings,
  AiSettingsInput,
  AppSettings,
  AppSettingsUpdate,
  ChatMessage,
  ChatSendRequest,
  Conversation,
  Folder,
  FolderImportSummary,
  ImportPaperResult,
  ImportProgressEvent,
  JobState,
  LegacyMigrationSummary,
  Note,
  NoteType,
  Paper,
  PaperUpdatePatch,
  PdfExportJob,
  RootChangeResult,
  SearchResult,
  StorageInfo,
} from './types';

export interface PaperLensApi {
  papers: {
    list(): Promise<Paper[]>;
    get(id: number): Promise<Paper | null>;
    importOriginal(): Promise<ImportPaperResult | null>;
    attachTranslated(id: number): Promise<Paper | null>;
    update(id: number, patch: PaperUpdatePatch): Promise<Paper>;
    remove(id: number): Promise<void>;
    markRead(id: number, version: 'original' | 'translated', pageNo: number): Promise<void>;
    checkFiles(): Promise<{ id: number; originalExists: boolean; translatedExists: boolean }[]>;
    relocate(id: number, version: 'original' | 'translated'): Promise<Paper | null>;
  };
  folders: {
    list(): Promise<Folder[]>;
    create(name: string): Promise<Folder>;
    rename(id: number, name: string): Promise<Folder>;
    remove(id: number): Promise<void>;
  };
  pdf: {
    load(
      paperId: number,
      version: 'original' | 'translated',
    ): Promise<{ data: ArrayBuffer; fileName: string }>;
  };
  conversations: {
    list(paperId: number): Promise<Conversation[]>;
    create(paperId: number, title: string): Promise<Conversation>;
    rename(id: number, title: string): Promise<void>;
    remove(id: number): Promise<void>;
  };
  messages: {
    list(conversationId: number): Promise<ChatMessage[]>;
  };
  chat: {
    send(req: ChatSendRequest): Promise<{ requestId: string }>;
    abort(requestId: string): Promise<void>;
    onDelta(cb: (e: { requestId: string; delta: string }) => void): () => void;
    onDone(cb: (e: { requestId: string; message: ChatMessage }) => void): () => void;
    onError(cb: (e: { requestId: string; error: string }) => void): () => void;
  };
  notes: {
    list(paperId?: number): Promise<Note[]>;
    create(input: {
      paperId: number;
      type: NoteType;
      title: string;
      contentMd: string;
      tags: string[];
    }): Promise<Note>;
    update(id: number, patch: { title?: string; contentMd?: string; tags?: string[] }): Promise<Note>;
    remove(id: number): Promise<void>;
    generate(
      kind: 'summary' | 'concept' | 'innovation',
      params: {
        paperId: number;
        selectionText?: string;
        conceptTitle?: string;
        currentPageNo?: number;
      },
    ): Promise<Note | null>;
  };
  search: {
    global(query: string): Promise<SearchResult[]>;
  };
  exportFile: {
    save(suggestedName: string, content: string): Promise<string | null>;
    /** Writes a generated .docx after asking the user where to save it. */
    saveDocx(suggestedName: string, data: Uint8Array): Promise<string | null>;
    /** Renders Markdown to PDF in a hidden window, then asks where to save it. */
    printPdf(suggestedName: string, title: string, markdown: string): Promise<string | null>;
    /** Hidden export window only: fetches the job its query token refers to. */
    getJob(token: string): Promise<PdfExportJob | null>;
    /** Hidden export window only: reports that fonts/layout are ready to print. */
    ready(token: string): Promise<void>;
    /** Hidden export window only: reports a rendering failure to the main process. */
    fail(token: string, message: string): Promise<void>;
  };
  window: {
    setFullscreen(fullscreen: boolean): Promise<boolean>;
    onFullscreenChange(cb: (fullscreen: boolean) => void): () => void;
  };
  settings: {
    get(): Promise<AiSettings>;
    set(input: AiSettingsInput): Promise<AiSettings>;
    test(input: AiSettingsInput): Promise<{ ok: boolean; error?: string }>;
  };
  appSettings: {
    get(): Promise<AppSettings>;
    update(patch: AppSettingsUpdate): Promise<AppSettings>;
  };
  storage: {
    getInfo(): Promise<StorageInfo>;
    migrateLegacy(): Promise<LegacyMigrationSummary>;
    chooseRoot(): Promise<string | null>;
    changeRoot(newRoot: string): Promise<RootChangeResult>;
    /** Asks for a folder and imports every PDF below it; null when canceled. */
    importFolder(): Promise<FolderImportSummary | null>;
    cancelImport(): Promise<void>;
    openRoot(): Promise<void>;
    revealPaper(paperId: number): Promise<void>;
    onBusy(cb: (state: JobState) => void): () => void;
    onMigrated(cb: (summary: LegacyMigrationSummary) => void): () => void;
    onImportProgress(cb: (event: ImportProgressEvent) => void): () => void;
  };
}
