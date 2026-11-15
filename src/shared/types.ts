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
