export interface OutlineNode {
  title: string;
  pageNo: number | null;
  children: OutlineNode[];
}

export interface PageText {
  pageNo: number;
  text: string;
}

export interface PaperPage extends PageText {
  paperId: number;
}

export interface Paper {
  id: number;
  title: string;
  authors: string;
  year: number | null;
  filePathOriginal: string;
  filePathTranslated: string | null;
  pageCountOriginal: number;
  pageCountTranslated: number | null;
  hasTextLayer: boolean;
  outline: OutlineNode[];
  tags: string[];
  folderId: number | null;
  storageDir: string | null;
  fileHash: string | null;
  lastPageOriginal: number;
  lastPageTranslated: number;
  addedAt: number;
  lastReadAt: number | null;
}

/** A single-level library folder; `null` folderId means 未分类. */
export interface Folder {
  id: number;
  name: string;
  createdAt: string;
}

/** Fields the renderer may change through `papers:update`. */
export interface PaperUpdatePatch {
  title?: string;
  authors?: string;
  year?: number | null;
  tags?: string[];
  lastPageOriginal?: number;
  lastPageTranslated?: number;
  folderId?: number | null;
}

/** Result of a single-file import; `duplicate` means no new row was added. */
export interface ImportPaperResult {
  paper: Paper;
  duplicate: boolean;
}

/** One file that could not be imported during a folder batch. */
export interface FolderImportFailure {
  file: string;
  message: string;
}

/** Outcome of one recursive folder import. */
export interface FolderImportSummary {
  imported: number;
  skipped: number;
  failed: FolderImportFailure[];
  canceled: boolean;
}

/** Progress notifications for a recursive folder import. */
export interface ImportProgressEvent {
  jobId: string;
  phase: 'scan' | 'copy' | 'done';
  current: number;
  total: number;
  file: string;
}

export interface Conversation {
  id: number;
  paperId: number;
  title: string;
  createdAt: number;
}

export type ChatRole = 'user' | 'assistant' | 'system';

export interface ChatMessage {
  id: number;
  conversationId: number;
  role: ChatRole;
  content: string;
  selectionText: string | null;
  pageNo: number | null;
  createdAt: number;
}

export type NoteType = 'concept' | 'summary' | 'manual' | 'idea';

/** Formats a paper's notes can be exported to. */
export type ExportFormat = 'md' | 'pdf' | 'docx';

/** Which notes an export covers; drives the default save directory. */
export type ExportScope = 'note' | 'all';

/** Where an export should start: one paper's notes or the whole library. */
export interface ExportContext {
  paperId?: number;
  scope: ExportScope;
}

/** Content handed to the hidden renderer window that produces a PDF. */
export interface PdfExportJob {
  title: string;
  markdown: string;
}

export interface Note {
  id: number;
  paperId: number;
  type: NoteType;
  title: string;
  contentMd: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

/** Language a free selection is translated into. */
export type TranslationTarget = 'zh-CN' | 'en';

/** Result of translating a free text selection. */
export interface SelectionTranslationResult {
  translation: string;
  targetLang: TranslationTarget;
}

export interface AiSettings {
  baseUrl: string;
  chatModel: string;
  visionModel: string;
  temperature: number;
  tokenBudget: number;
  apiKeySet: boolean;
}

export interface AiSettingsInput {
  baseUrl: string;
  chatModel: string;
  visionModel: string;
  temperature: number;
  tokenBudget: number;
  apiKey?: string;
}

export interface AppSettings {
  libraryRoot: string;
  defaultLibraryRoot: string;
  babeldocPath: string;
  babeldocDetectedPath: string | null;
  aiPanelWidth: number;
}

export interface AppSettingsUpdate {
  babeldocPath?: string | null;
  aiPanelWidth?: number;
}

export interface ChatSendRequest {
  paperId: number;
  conversationId: number;
  question: string;
  selectionText?: string;
  currentPageNo?: number;
  fullTextMode: boolean;
  images?: string[];
}

export interface SearchResult {
  kind: 'page' | 'message' | 'note';
  paperId: number;
  paperTitle: string;
  snippet: string;
  pageNo?: number;
  conversationId?: number;
  noteId?: number;
}

/** Storage-changing tasks; only one may run at a time. */
export type StorageTask =
  | 'import'
  | 'importFolder'
  | 'migrateLegacy'
  | 'changeRoot'
  | 'attachTranslated'
  | 'relocate'
  | 'remove'
  | 'ensureManaged'
  | 'translate';

/** External tool jobs; only one may run at a time. */
export type ToolTask = 'install' | 'warmup' | 'translate';

/** Snapshot of everything the main process is currently busy with. */
export interface JobState {
  storageTask: StorageTask | null;
  storagePaperId: number | null;
  toolTask: ToolTask | null;
  toolJobId: string | null;
  translatingPaperId: number | null;
}

/** A legacy paper left unmanaged because migration could not adopt it. */
export interface LegacyMigrationSkippedPaper {
  paperId: number;
  title: string;
  reason: string;
}

/** Outcome of one legacy-to-managed migration pass. */
export interface LegacyMigrationSummary {
  adopted: number;
  skipped: LegacyMigrationSkippedPaper[];
}

/** A paper that stayed unmanaged because it could not be adopted before a root change. */
export interface RootChangeUnmanagedPaper {
  paperId: number;
  title: string;
}

/** Outcome of moving the managed library to a new root directory. */
export interface RootChangeResult {
  root: string;
  migrated: number;
  unmanaged: RootChangeUnmanagedPaper[];
  /** Old copies are always kept; the renderer tells the user they may clean up. */
  keptOldCopies: true;
}

/** Library root state shown in the library and settings pages. */
export interface StorageInfo {
  root: string;
  defaultRoot: string;
  writable: boolean;
  migration: LegacyMigrationSummary | null;
  error: string | null;
}

export interface ToolProgressEvent {
  jobId: string;
  kind: ToolTask;
  line: string;
  percent: number | null;
}

export interface ToolDoneEvent {
  jobId: string;
  kind: ToolTask;
  ok: boolean;
  canceled: boolean;
  message: string | null;
}

export interface CommandInvocation {
  file: string;
  args: string[];
}

export interface ToolRunOptions {
  jobId: string;
  kind: ToolTask;
  command: CommandInvocation;
  timeoutMs?: number;
  redact?: string[];
  parsePercent?: (line: string) => number | null;
  onLine?: (line: string, percent: number | null) => void;
}

export interface ToolRunResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  lines: string[];
  canceled: boolean;
  timedOut: boolean;
}

export interface ToolJobRunnerOptions {
  spawn?: typeof import('node:child_process').spawn;
  killTree?: (pid: number) => Promise<void> | void;
  throttleMs?: number;
}
