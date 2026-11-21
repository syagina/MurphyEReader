import type {
  AiSettings,
  AiSettingsInput,
  AppSettings,
  AppSettingsUpdate,
  ChatMessage,
  ChatSendRequest,
  Conversation,
  EngineActionResult,
  ExportContext,
  Folder,
  FolderImportSummary,
  ImportPaperResult,
  ImportProgressEvent,
  JobState,
  LegacyMigrationSummary,
  Note,
  NoteType,
  Paper,
  PaperFileStatus,
  PaperUpdatePatch,
  PdfExportJob,
  PdfVersion,
  RootChangeResult,
  SearchResult,
  SelectionTranslationResult,
  StickyNote,
  StickyNoteCreateInput,
  StickyNoteExportResult,
  StickyNoteUpdatePatch,
  StorageInfo,
  ToolDoneEvent,
  ToolProgressEvent,
  TranslationCanceledEvent,
  TranslationDoneEvent,
  TranslationEngineStatus,
  TranslationFailedEvent,
  TranslationJobInfo,
  TranslationProgressEvent,
  TranslationStartResult,
} from './types';

export interface PaperLensApi {
  papers: {
    list(): Promise<Paper[]>;
    get(id: number): Promise<Paper | null>;
    importOriginal(): Promise<ImportPaperResult | null>;
    attachTranslated(id: number): Promise<Paper | null>;
    update(id: number, patch: PaperUpdatePatch): Promise<Paper>;
    remove(id: number): Promise<void>;
    markRead(
      id: number,
      version: PdfVersion,
      pageNo: number,
      offset: number,
    ): Promise<void>;
    checkFiles(): Promise<PaperFileStatus[]>;
    relocate(id: number, version: 'original' | 'translated'): Promise<Paper | null>;
  };
  folders: {
    list(): Promise<Folder[]>;
    create(name: string): Promise<Folder>;
    rename(id: number, name: string): Promise<Folder>;
    remove(id: number): Promise<void>;
  };
  pdf: {
    /**
     * Loads one paper version. When an existing managed mono translation lost
     * page content, the main process rebinds the complete dual output and
     * reports `repaired` together with the new translated page count.
     */
    load(
      paperId: number,
      version: PdfVersion,
    ): Promise<{
      data: ArrayBuffer;
      fileName: string;
      repaired?: boolean;
      pageCountTranslated?: number;
    }>;
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
  translate: {
    /** Translates a free selection; nothing is persisted. */
    text(input: { text: string }): Promise<SelectionTranslationResult>;
  };
  translation: {
    engineStatus(): Promise<TranslationEngineStatus>;
    /** Asks for a BabelDOC executable; validation happens when saving. */
    chooseEnginePath(): Promise<string | null>;
    install(): Promise<EngineActionResult>;
    warmup(): Promise<EngineActionResult>;
    cancel(jobId: string): Promise<void>;
    /** Starts a preserved-layout translation of one whole paper. */
    start(paperId: number): Promise<TranslationStartResult>;
    /** The running whole-paper job, or null when none is running. */
    getState(): Promise<TranslationJobInfo | null>;
    onProgress(cb: (event: TranslationProgressEvent) => void): () => void;
    onDone(cb: (event: TranslationDoneEvent) => void): () => void;
    onFailed(cb: (event: TranslationFailedEvent) => void): () => void;
    onCanceled(cb: (event: TranslationCanceledEvent) => void): () => void;
    onToolProgress(cb: (event: ToolProgressEvent) => void): () => void;
    onToolDone(cb: (event: ToolDoneEvent) => void): () => void;
    onState(cb: (state: JobState) => void): () => void;
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
  stickyNotes: {
    list(paperId: number, version: PdfVersion): Promise<StickyNote[]>;
    create(input: StickyNoteCreateInput): Promise<StickyNote>;
    update(id: number, patch: StickyNoteUpdatePatch): Promise<StickyNote>;
    remove(id: number): Promise<void>;
    clearPageDrawings(
      paperId: number,
      version: PdfVersion,
      pageNo: number,
    ): Promise<number>;
    exportPdf(
      paperId: number,
      version: PdfVersion,
    ): Promise<StickyNoteExportResult | null>;
  };
  search: {
    global(query: string): Promise<SearchResult[]>;
  };
  exportFile: {
    save(
      suggestedName: string,
      content: string,
      context?: ExportContext,
    ): Promise<string | null>;
    /** Writes a generated .docx after asking the user where to save it. */
    saveDocx(
      suggestedName: string,
      data: Uint8Array,
      context?: ExportContext,
    ): Promise<string | null>;
    /** Renders Markdown to PDF in a hidden window, then asks where to save it. */
    printPdf(
      suggestedName: string,
      title: string,
      markdown: string,
      context?: ExportContext,
    ): Promise<string | null>;
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
    /** 用系统浏览器打开 DeepSeek 的 API Key 页面。 */
    openDeepSeekConsole(): Promise<void>;
  };
  appSettings: {
    get(): Promise<AppSettings>;
    update(patch: AppSettingsUpdate): Promise<AppSettings>;
    /** 轻量查询，不触发 BabelDOC 探测。 */
    getOnboarding(): Promise<{ onboarded: boolean }>;
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
