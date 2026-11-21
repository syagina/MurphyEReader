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

/**
 * Which document the reader shows: the original PDF, the translated-only
 * layout, or the bilingual (original + translation) layout produced by
 * BabelDOC.
 */
export type PdfVersion = 'original' | 'translated' | 'bilingual';

/** File availability for one paper, used by library and reader actions. */
export interface PaperFileStatus {
  id: number;
  originalExists: boolean;
  translatedExists: boolean;
  /** A bilingual (`translated.zh-CN.dual.pdf`) variant exists. */
  bilingualExists: boolean;
  /** The bound primary translation is itself the bilingual output. */
  translatedIsBilingual: boolean;
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
  /** The bilingual layout's own page count, when known. */
  pageCountBilingual: number | null;
  hasTextLayer: boolean;
  outline: OutlineNode[];
  tags: string[];
  folderId: number | null;
  storageDir: string | null;
  fileHash: string | null;
  lastPageOriginal: number;
  lastPageTranslated: number;
  lastVersion: PdfVersion;
  lastOffsetOriginal: number;
  lastOffsetTranslated: number;
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
  folderId?: number | null;
}

/**
 * Result of a single-file import. `duplicate` means no new row was added;
 * `restored` additionally means the existing row's original file was missing
 * and has been copied back into the library (notes and metadata preserved).
 */
export interface ImportPaperResult {
  paper: Paper;
  duplicate: boolean;
  restored?: boolean;
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

/** What created a page-anchored sticky note. */
export type StickyNoteSource = 'manual' | 'translation' | 'ai';

/** Rectangle normalized to the displayed page box; origin is the top-left. */
export interface StickyNoteRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A text selection's rectangles, or a page-level marker in the top-right. */
export type StickyNoteAnchor =
  | { kind: 'text'; rects: StickyNoteRect[] }
  | { kind: 'page' };

/** What an annotation represents: note content, a text mark, a stroke or a shape. */
export type AnnotationKind = 'note' | 'mark' | 'ink' | 'shape';

/** How a note or pure mark is drawn over the page text. */
export type AnnotationMarkStyle =
  | 'highlight'
  | 'underline'
  | 'double-underline'
  | 'dotted-underline'
  | 'wavy-underline'
  | 'strikeout'
  | 'none';

/** Geometric shape created by the drawing tools. */
export type AnnotationShape = 'line' | 'rect' | 'ellipse' | 'arrow';

/** Draggable page-margin pin position, normalized to the displayed page. */
export interface AnnotationPin {
  /** 相对显示页面左上角的归一化坐标。 */
  x: number;
  y: number;
  visible: boolean;
}

/** Where the annotation popup opens. */
export type AnnotationPopupPlacement =
  | { mode: 'anchor' }
  | { mode: 'right' }
  | { mode: 'free'; x: number; y: number };

/** One freehand or highlighter stroke. */
export interface AnnotationStroke {
  tool: 'pen' | 'highlighter';
  color: string;
  width: number;
  opacity: number;
  /** 相对 PDF 可视框左下角的归一化坐标。 */
  points: Array<[number, number]>;
}

/** One line, rectangle, ellipse or arrow. */
export interface AnnotationShapeData {
  shape: AnnotationShape;
  color: string;
  width: number;
  opacity: number;
  /** 相对 PDF 可视框左下角的归一化坐标。 */
  start: [number, number];
  end: [number, number];
}

/** All drawing records: a freehand stroke or a geometric shape. */
export type AnnotationDrawing = AnnotationStroke | AnnotationShapeData;

export interface StickyNote {
  id: number;
  paperId: number;
  pdfVersion: PdfVersion;
  pageNo: number;
  quote: string;
  contentMd: string;
  anchor: StickyNoteAnchor;
  source: StickyNoteSource;
  kind: AnnotationKind;
  markStyle: AnnotationMarkStyle;
  color: string | null;
  pin: AnnotationPin | null;
  popup: AnnotationPopupPlacement | null;
  drawing: AnnotationDrawing | null;
  createdAt: number;
  updatedAt: number;
}

/** Renderer payload; annotation fields are optional for older callers. */
export interface StickyNoteCreateInput {
  paperId: number;
  pdfVersion: PdfVersion;
  pageNo: number;
  quote: string;
  contentMd: string;
  anchor: StickyNoteAnchor;
  source: StickyNoteSource;
  kind?: AnnotationKind;
  markStyle?: AnnotationMarkStyle;
  color?: string | null;
  pin?: AnnotationPin | null;
  popup?: AnnotationPopupPlacement | null;
  drawing?: AnnotationDrawing | null;
}

/** Validated create payload with every annotation field resolved. */
export interface StickyNoteCreateData {
  paperId: number;
  pdfVersion: PdfVersion;
  pageNo: number;
  quote: string;
  contentMd: string;
  anchor: StickyNoteAnchor;
  source: StickyNoteSource;
  kind: AnnotationKind;
  markStyle: AnnotationMarkStyle;
  color: string | null;
  pin: AnnotationPin | null;
  popup: AnnotationPopupPlacement | null;
  drawing: AnnotationDrawing | null;
}

/** Partial update accepted by `stickyNotes:update`. */
export interface StickyNoteUpdatePatch {
  contentMd?: string;
  markStyle?: AnnotationMarkStyle;
  color?: string | null;
  pin?: AnnotationPin | null;
  popup?: AnnotationPopupPlacement | null;
}

export interface StickyNoteExportResult {
  filePath: string;
  exported: number;
  skipped: number;
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

export type ThemeMode = 'light' | 'dark' | 'eye-care' | 'paper';

export interface AppSettings {
  libraryRoot: string;
  defaultLibraryRoot: string;
  babeldocPath: string;
  babeldocDetectedPath: string | null;
  aiPanelWidth: number;
  theme: ThemeMode;
  /** 纸感界面纹路强度（0–100），其他外观下不生效。 */
  paperTexture: number;
  /** BabelDOC request rate ceiling (requests per second). */
  translationQps: number;
  /** Parallel BabelDOC translation workers, independent of the request rate. */
  translationWorkers: number;
  /** Whether BabelDOC runs its automatic terminology-extraction stage. */
  translationAutoGlossary: boolean;
  /** 首次使用引导是否已完成或跳过。 */
  onboarded: boolean;
}

export interface AppSettingsUpdate {
  babeldocPath?: string | null;
  aiPanelWidth?: number;
  theme?: ThemeMode;
  paperTexture?: number;
  translationQps?: number;
  translationWorkers?: number;
  translationAutoGlossary?: boolean;
  onboarded?: boolean;
}

/** How much paper context a chat turn carries. */
export type ChatContextMode = 'page' | 'full' | 'conversation';

export interface ChatSendRequest {
  paperId: number;
  conversationId: number;
  question: string;
  selectionText?: string;
  currentPageNo?: number;
  contextMode: ChatContextMode;
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

/** Translation engine state shown by the settings tab and engine status calls. */
export interface TranslationEngineStatus {
  detectedPath: string | null;
  configuredPath: string;
  uvPath: string | null;
  busy: boolean;
}

/** Outcome of asking the main process to install or warm up the engine. */
export interface EngineActionResult {
  started: boolean;
  jobId: string | null;
  instructions: string | null;
  /** False for the elevated Windows installer, which cannot be canceled safely. */
  cancelable?: boolean;
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

/** Returned immediately after a whole-paper translation is accepted. */
export interface TranslationStartResult {
  jobId: string;
  paperId: number;
  title: string;
}

/** Snapshot of the whole-paper translation job; only returned while running. */
export interface TranslationJobInfo {
  jobId: string;
  paperId: number;
  title: string;
  status: 'running' | 'done' | 'failed' | 'canceled';
  /** Wall-clock start used by the status card to show elapsed time. */
  startedAt: number;
  percent: number | null;
  line: string;
  logs: string[];
  error: string | null;
}

export interface TranslationProgressEvent {
  jobId: string;
  paperId: number;
  percent: number | null;
  line: string;
  /**
   * false for periodic heartbeat text that updates the headline only and
   * must not fill the scrollable log history.
   */
  appendLog?: boolean;
}

export interface TranslationDoneEvent {
  jobId: string;
  paper: Paper;
  /** Human-readable completion line, including any fallback notice. */
  message?: string;
}

export interface TranslationFailedEvent {
  jobId: string;
  paperId: number;
  message: string;
}

export interface TranslationCanceledEvent {
  jobId: string;
  paperId: number;
}
