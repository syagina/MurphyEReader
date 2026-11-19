import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import {
  copyFile,
  mkdir,
  mkdtemp,
  open,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import type Database from 'better-sqlite3';
import type {
  Paper,
  PageText,
  ToolRunOptions,
  ToolRunResult,
  TranslationCanceledEvent,
  TranslationDoneEvent,
  TranslationFailedEvent,
  TranslationJobInfo,
  TranslationProgressEvent,
  TranslationStartResult,
} from '@shared/types';
import {
  TRANSLATION_ALREADY_CHINESE,
  TRANSLATION_ENGINE_MISSING,
  TRANSLATION_NO_TEXT_LAYER,
  TRANSLATION_NOT_CONFIGURED,
  TRANSLATION_ORIGINAL_MISSING,
  TRANSLATION_OUTPUT_AMBIGUOUS,
  TRANSLATION_OUTPUT_INCOMPLETE,
  TRANSLATION_OUTPUT_INVALID,
  TRANSLATION_OUTPUT_MISSING,
  TRANSLATION_PAPER_EMPTY_RESULT,
  formatTranslationElapsed,
  normalizeTranslationQps,
  normalizeTranslationWorkers,
  translationCjkRatio,
  translationStage,
  translationStageText,
  type TranslationStage,
} from '@shared/translation';
import type { AiConfig } from '../ai/client';
import { getPages } from '../db/pages';
import { getPaper, updatePaper } from '../db/papers';
import type { JobRegistry } from '../jobs/job-registry';
import { extractPdf, getPdfPageCount } from '../pdf/extract';
import type { PaperLibrary } from '../storage/library-service';
import { BABELDOC_DUAL_NAME, BABELDOC_MONO_NAME, storageFile } from '../storage/paths';
import { buildCommandInvocation } from '../tools/babeldoc';
import { findIncompletePages } from './completeness';
import {
  startOpenAiProxy,
  type OpenAiProxyHandle,
  type ProxyActivity,
} from './openai-proxy';
import { buildTranslationArgs } from './translation-args';

const MONO_SUFFIX = '.mono.pdf';
const DUAL_SUFFIX = '.dual.pdf';
const CHINESE_DETECTION_CHARS = 5000;
const MAX_LOG_LINES = 20;
const SHUTDOWN_TIMEOUT_MS = 5000;
/**
 * BabelDOC's rich progress stays silent in a pipe for long stretches while it
 * waits on the AI provider. A heartbeat keeps the card moving even then.
 */
const HEARTBEAT_INTERVAL_MS = 3000;
/**
 * BabelDOC's Rich progress is invisible in a pipe, so the card's log panel
 * would otherwise stay empty until the process exits. While the engine is
 * silent, append the heartbeat line to the log at this slower cadence.
 */
const HEARTBEAT_LOG_INTERVAL_MS = 10_000;
const INVALID_MANAGED_PATH_MESSAGE = '文献文件夹路径异常，请重新定位或导入';
const BINDING_FAILED_MESSAGE = '绑定译本失败，请查看日志';
const BINDING_FAILED_DETAIL_PREFIX = '绑定译本失败：';
const TIMED_OUT_MESSAGE = '翻译超时，请稍后重试';
const GENERIC_FAILURE_MESSAGE = '翻译失败，请查看日志';
const AUTH_FAILURE_MESSAGE = 'AI 接口认证失败，请检查 API Key';
const RATE_LIMIT_MESSAGE = 'AI 接口请求过于频繁或额度不足，请稍后重试';
const NETWORK_FAILURE_MESSAGE = '网络连接失败，请检查网络后重试';
const MODEL_FAILURE_MESSAGE = 'AI 模型不可用，请检查模型配置';
const ENCRYPTED_PDF_MESSAGE = '该 PDF 已加密，无法翻译';
const TRANSLATION_DONE = '翻译完成';
const TRANSLATION_DONE_DUAL = '翻译完成（已改用双语对照版，避免内容遗漏）';

/** The subset of the single tool runner whole-paper translation needs. */
export interface PaperTranslationRunner {
  run(options: ToolRunOptions): Promise<ToolRunResult>;
  cancel(jobId: string): boolean;
  cancelAll(): void;
}

/** Engine behavior tuned from Settings and snapshotted when a job starts. */
export interface WholePaperTranslationOptions {
  qps: number;
  workers: number;
  autoExtractGlossary: boolean;
}

export interface PaperTranslationDeps {
  db: Database.Database;
  jobs: JobRegistry;
  runner: PaperTranslationRunner;
  library: Pick<PaperLibrary, 'ensureManaged'>;
  getRoot(): string;
  tempRoot?: string;
  getEnginePath(): Promise<string | null>;
  getAiConfig(): AiConfig | null;
  getTranslationOptions(): WholePaperTranslationOptions;
  emit(channel: string, payload: unknown): void;
}

interface ActiveTranslation {
  info: TranslationJobInfo;
  job: Promise<void>;
  /** Created lazily by the job; shutdown removes it best-effort. */
  tempDir: string | null;
  /** Set by cancel/shutdown before the runner may have registered the job. */
  cancelRequested: boolean;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function hasChinese(message: string): boolean {
  return /[一-鿿]/.test(message);
}

/** Removes every secret occurrence from text that may reach the user. */
function redactSecrets(text: string, secrets: string[]): string {
  let result = text;
  for (const secret of secrets) {
    if (secret === '') {
      continue;
    }
    result = result.split(secret).join('[REDACTED]');
  }
  return result;
}

/**
 * Escapes one TOML basic-string value. Backslashes and quotes are escaped and
 * every control character (including newlines) collapses to a space, so a
 * value can never break out of its quoted string or start a new table.
 */
function tomlString(value: string): string {
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, ' ');
  return `"${cleaned.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * The only keys whole-paper translation writes. BabelDOC talks to the local
 * relay instead of the provider, so the real API key never reaches the config
 * file (or BabelDOC's logs).
 */
function buildTranslationConfig(
  ai: AiConfig,
  proxy: Pick<OpenAiProxyHandle, 'baseUrl' | 'apiKey'>,
  options: WholePaperTranslationOptions,
): string {
  const lines = [
    '[babeldoc]',
    'openai = true',
    `openai-model = ${tomlString(ai.chatModel)}`,
    `openai-base-url = ${tomlString(proxy.baseUrl)}`,
    `openai-api-key = ${tomlString(proxy.apiKey)}`,
    'lang-out = "zh-CN"',
    // qps is only the rate ceiling. The worker pools are written explicitly so
    // slow provider responses can still saturate that rate without the two
    // settings being forced to the same number.
    `qps = ${normalizeTranslationQps(options.qps)}`,
    `pool-max-workers = ${normalizeTranslationWorkers(options.workers)}`,
    `term-pool-max-workers = ${normalizeTranslationWorkers(options.workers)}`,
  ];
  if (!options.autoExtractGlossary) {
    // configargparse keys must match the CLI option string exactly: the
    // positive name is not a registered option, only the `no-` form is.
    lines.push('no-auto-extract-glossary = true');
  }
  lines.push('');
  return lines.join('\n');
}

function parsePercentLine(line: string): number | null {
  // BabelDOC prints either `45%` (plain logs) or a rich-progress refresh like
  // `45/100` followed by a bare carriage return inside a pipe.
  const match = /(\d{1,3})\s*%/.exec(line) ?? /(?:^|\s)(\d{1,3})\s*\/\s*100(?!\d)/.exec(line);
  if (match === null) {
    return null;
  }
  const value = Number(match[1]);
  return Number.isFinite(value) ? Math.min(100, value) : null;
}

/**
 * Heartbeat text shown while the engine has not printed anything itself. It
 * reports what the local relay observed, which is the only visible sign of
 * progress while BabelDOC waits on the provider.
 */
function retryReasonLabel(reason: ProxyActivity['lastRetryReason']): string | null {
  switch (reason) {
    case 'empty':
      return 'AI 返回空内容';
    case 'truncated':
      return '输出被截断';
    case 'rate-limit':
      return '接口限流 429';
    case 'timeout':
      return '请求超时';
    case 'upstream':
      return '服务端错误';
    case 'budget':
      return '模型拒绝较大输出上限';
    default:
      return null;
  }
}

function activityLine(activity: ProxyActivity, elapsed: string): string {
  const parts = [`AI 已返回 ${activity.completed} 段`];
  if (activity.inflight > 0) {
    parts.push(`等待返回 ${activity.inflight} 段`);
  }
  if (activity.retries > 0) {
    const reason = retryReasonLabel(activity.lastRetryReason);
    parts.push(
      reason === null
        ? `已自动重试 ${activity.retries} 次`
        : `已自动重试 ${activity.retries} 次（最近原因：${reason}）`,
    );
  }
  if (activity.failed > 0) {
    parts.push(`失败 ${activity.failed} 段`);
  }
  return `${parts.join('，')}…（已用时 ${elapsed}）`;
}

function glossaryLine(activity: ProxyActivity, elapsed: string): string {
  const parts = ['正在提取专业术语'];
  if (activity.glossaryCompleted > 0) {
    parts.push(`已返回 ${activity.glossaryCompleted} 条`);
  }
  if (activity.glossaryInflight > 0) {
    parts.push(`等待 ${activity.glossaryInflight} 条`);
  }
  return `${parts.join('，')}…（已用时 ${elapsed}）`;
}

function heartbeatLine(
  activity: ProxyActivity | null,
  elapsedMs: number,
  percent: number | null,
  stage: TranslationStage | null,
): string {
  const elapsed = formatTranslationElapsed(elapsedMs);
  const started = activity !== null && activity.started > 0;
  // Translation requests in flight are the most concrete sign of progress.
  if (activity !== null && activity.inflight > 0) {
    return activityLine(activity, elapsed);
  }
  // Glossary extraction happens before paragraph translation and is otherwise
  // invisible, which made the old heartbeat look stuck on "parsing PDF".
  if (
    activity !== null &&
    (activity.glossaryInflight > 0 ||
      (activity.glossaryStarted > 0 && !started))
  ) {
    return glossaryLine(activity, elapsed);
  }
  // After the AI phase BabelDOC typesets for a long time; report that stage
  // instead of repeating the last request counters.
  if (
    stage !== null &&
    !(started && (stage === 'translate' || stage === 'term'))
  ) {
    return `${translationStageText(stage, percent)}（已用时 ${elapsed}）`;
  }
  if (started && activity !== null) {
    return activityLine(activity, elapsed);
  }
  if (stage !== null) {
    return `${translationStageText(stage, percent)}（已用时 ${elapsed}）`;
  }
  return percent === null
    ? `正在解析 PDF 并准备翻译…（已用时 ${elapsed}）`
    : `BabelDOC 正在处理：${percent}%…（已用时 ${elapsed}）`;
}

/** Maps common BabelDOC/provider failures to fixed Chinese messages. */
function classifyFailure(lines: string[]): string {
  const text = lines.slice(-MAX_LOG_LINES).join('\n');
  if (/paperlens_empty_translation/i.test(text)) {
    return TRANSLATION_PAPER_EMPTY_RESULT;
  }
  if (/paperlens_upstream_unreachable/i.test(text)) {
    return NETWORK_FAILURE_MESSAGE;
  }
  if (/401|403|unauthorized|invalid[ _-]?api[ _-]?key|authentication|api key/i.test(text)) {
    return AUTH_FAILURE_MESSAGE;
  }
  if (/429|rate limit|quota|额度|余额/i.test(text)) {
    return RATE_LIMIT_MESSAGE;
  }
  if (/econnrefused|enotfound|etimedout|network|fetch failed|socket hang up/i.test(text)) {
    return NETWORK_FAILURE_MESSAGE;
  }
  if (/model.*(not found|does not exist|invalid)|unknown model|模型/i.test(text)) {
    return MODEL_FAILURE_MESSAGE;
  }
  if (/encrypt|password protected|加密/i.test(text)) {
    return ENCRYPTED_PDF_MESSAGE;
  }
  return GENERIC_FAILURE_MESSAGE;
}

/** Recursively lists BabelDOC mono/dual outputs below `dir`. */
async function collectOutputFiles(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectOutputFiles(fullPath)));
    } else if (
      entry.isFile() &&
      (entry.name.endsWith(MONO_SUFFIX) || entry.name.endsWith(DUAL_SUFFIX))
    ) {
      files.push(fullPath);
    }
  }
  return files;
}

/** The original file's name without its `.pdf` extension. */
function pdfStem(filePath: string): string {
  const name = basename(filePath);
  return name.toLowerCase().endsWith('.pdf') ? name.slice(0, -'.pdf'.length) : name;
}

/**
 * Picks the single mono output, preferring names that start with the original
 * stem and falling back to every mono found when nothing matches.
 */
function chooseMono(files: string[], stem: string): string {
  const monos = files.filter((file) => basename(file).endsWith(MONO_SUFFIX));
  const preferred = monos.filter((file) => basename(file).startsWith(`${stem}.`));
  const considered = preferred.length > 0 ? preferred : monos;
  if (considered.length === 0) {
    throw new Error(TRANSLATION_OUTPUT_MISSING);
  }
  if (considered.length > 1) {
    throw new Error(TRANSLATION_OUTPUT_AMBIGUOUS);
  }
  return considered[0];
}

/** The dual with the same base name as the chosen mono, when produced. */
function chooseDual(files: string[], monoPath: string): string | null {
  const base = basename(monoPath).slice(0, -MONO_SUFFIX.length);
  const expected = `${base}${DUAL_SUFFIX}`;
  return files.find((file) => basename(file) === expected) ?? null;
}

/** Extracted page texts, or null when pdf.js cannot read the output. */
async function extractOutputPages(filePath: string): Promise<PageText[] | null> {
  try {
    return (await extractPdf(filePath)).pages;
  } catch {
    // Completeness checking is a safety net, not a second validation gate:
    // an unreadable text layer keeps the previous mono-binding behavior.
    return null;
  }
}

/** Validates the `%PDF` magic and a positive page count. */
async function validatePdfOutput(filePath: string): Promise<number> {
  let header: Buffer;
  try {
    const handle = await open(filePath, 'r');
    try {
      header = Buffer.alloc(4);
      const { bytesRead } = await handle.read(header, 0, 4, 0);
      if (bytesRead !== 4) {
        throw new Error(TRANSLATION_OUTPUT_INVALID);
      }
    } finally {
      await handle.close();
    }
  } catch {
    throw new Error(TRANSLATION_OUTPUT_INVALID);
  }
  if (header.toString('latin1') !== '%PDF') {
    throw new Error(TRANSLATION_OUTPUT_INVALID);
  }
  try {
    const pageCount = await getPdfPageCount(filePath);
    if (pageCount <= 0) {
      throw new Error(TRANSLATION_OUTPUT_INVALID);
    }
    return pageCount;
  } catch {
    throw new Error(TRANSLATION_OUTPUT_INVALID);
  }
}

/**
 * Runs one whole-paper BabelDOC translation at a time. `start` performs every
 * synchronous precondition before taking the translation lease and returns
 * immediately; the background job binds the preserved-layout PDF atomically and
 * always removes its temp directory and releases the lease.
 */
export class PaperTranslationService {
  private readonly deps: PaperTranslationDeps;
  private active: ActiveTranslation | null = null;

  constructor(deps: PaperTranslationDeps) {
    this.deps = deps;
  }

  async start(paperId: number): Promise<TranslationStartResult> {
    const paper = getPaper(this.deps.db, paperId);
    if (paper === null) {
      throw new Error(`文献不存在: ${paperId}`);
    }

    const enginePath = await this.deps.getEnginePath();
    if (enginePath === null) {
      throw new Error(TRANSLATION_ENGINE_MISSING);
    }

    const ai = this.deps.getAiConfig();
    if (
      ai === null ||
      ai.baseUrl.trim() === '' ||
      ai.chatModel.trim() === '' ||
      ai.apiKey.trim() === ''
    ) {
      throw new Error(TRANSLATION_NOT_CONFIGURED);
    }
    // Snapshot the performance settings so changing them mid-job cannot affect
    // a translation that is already running.
    const options = this.deps.getTranslationOptions();

    if (!existsSync(paper.filePathOriginal)) {
      throw new Error(TRANSLATION_ORIGINAL_MISSING);
    }

    // BabelDOC translates an existing text layer; an image-only scan has
    // nothing to extract, so fail before spawning the engine and point the
    // user at OCR instead of the generic output-missing message.
    if (!paper.hasTextLayer) {
      throw new Error(TRANSLATION_NO_TEXT_LAYER);
    }

    const storedText = getPages(this.deps.db, paper.id)
      .map((page) => page.text)
      .join('');
    const firstCharacters = Array.from(storedText)
      .slice(0, CHINESE_DETECTION_CHARS)
      .join('');
    if (translationCjkRatio(firstCharacters) >= 0.5) {
      throw new Error(TRANSLATION_ALREADY_CHINESE);
    }

    // Adoption rewrites the original path and storage directory, so the job
    // must use the row returned here rather than the pre-adoption snapshot.
    const managed = await this.deps.library.ensureManaged(paper.id);

    const jobId = randomUUID();
    this.deps.jobs.tryAcquireTranslation(managed.id, jobId);
    const info: TranslationJobInfo = {
      jobId,
      paperId: managed.id,
      title: managed.title,
      status: 'running',
      startedAt: Date.now(),
      percent: null,
      line: '',
      logs: [],
      error: null,
    };
    const active: ActiveTranslation = {
      info,
      job: Promise.resolve(),
      tempDir: null,
      cancelRequested: false,
    };
    this.active = active;
    active.job = this.runJob(active, managed, enginePath, ai, options);
    return { jobId, paperId: managed.id, title: managed.title };
  }

  /** The running whole-paper job, or null once it reached a terminal state. */
  getState(): TranslationJobInfo | null {
    const active = this.active;
    if (active === null || active.info.status !== 'running') {
      return null;
    }
    return { ...active.info, logs: [...active.info.logs] };
  }

  /** Routes a cancel to the active paper translation; true when it matched. */
  cancel(jobId: string): boolean {
    const active = this.active;
    if (active === null || active.info.jobId !== jobId) {
      return false;
    }
    active.cancelRequested = true;
    if (active.info.status === 'running') {
      try {
        this.deps.runner.cancel(jobId);
      } catch {
        // Best effort: the process may already be gone.
      }
    }
    return true;
  }

  /** Awaits the current background job; runJob resolves on every path. */
  async waitForIdle(): Promise<void> {
    const active = this.active;
    if (active !== null) {
      await active.job.catch(() => undefined);
    }
  }

  /**
   * App-level shutdown: cancel, wait up to five seconds, remove the temp
   * directory, kill any remaining tool process, and release the lease.
   */
  async shutdown(): Promise<void> {
    const active = this.active;
    if (active !== null) {
      active.cancelRequested = true;
      if (active.info.status === 'running') {
        try {
          this.deps.runner.cancel(active.info.jobId);
        } catch {
          // Best effort; cancelAll below is the backstop.
        }
      }
      await this.awaitWithTimeout(active.job, SHUTDOWN_TIMEOUT_MS);
      if (active.tempDir !== null) {
        // The job's own finally may already have removed it; rm is a no-op.
        await rm(active.tempDir, { recursive: true, force: true }).catch(() => undefined);
      }
    }
    try {
      this.deps.runner.cancelAll();
    } catch {
      // Best effort.
    }
    try {
      this.deps.jobs.releaseTranslation(active?.info.jobId ?? '');
    } catch {
      // The renderer/window may already be gone during application shutdown.
    }
  }

  private async awaitWithTimeout(promise: Promise<void>, timeoutMs: number): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      await Promise.race([
        promise.catch(() => undefined),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, timeoutMs);
        }),
      ]);
    } finally {
      if (timer !== null) {
        clearTimeout(timer);
      }
    }
  }

  private async runJob(
    active: ActiveTranslation,
    paper: Paper,
    enginePath: string,
    ai: AiConfig,
    options: WholePaperTranslationOptions,
  ): Promise<void> {
    const { info } = active;
    let tempDir: string | null = null;
    let proxy: OpenAiProxyHandle | null = null;
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    let latestActivity: ProxyActivity | null = null;
    let latestStage: TranslationStage | null = null;
    let lastLogAt = Date.now();
    const secrets = [ai.apiKey];
    try {
      tempDir = await this.createTempDirectory();
      active.tempDir = tempDir;

      proxy = await startOpenAiProxy({
        baseUrl: ai.baseUrl,
        apiKey: ai.apiKey,
        onActivity: (activity) => {
          latestActivity = activity;
        },
      });
      secrets.push(proxy.apiKey);

      const configPath = join(tempDir, 'config.toml');
      await writeFile(configPath, buildTranslationConfig(ai, proxy, options), {
        encoding: 'utf8',
        mode: 0o600,
      });

      const outDir = join(tempDir, 'output');
      await mkdir(outDir, { recursive: true });
      // Every page, bibliography included, is sent to BabelDOC. The coverage
      // check below catches any page that still loses content.
      const storedPages = getPages(this.deps.db, paper.id);
      const invocation = buildCommandInvocation(
        enginePath,
        buildTranslationArgs({
          configPath,
          filePathOriginal: paper.filePathOriginal,
          outDir,
        }),
      );

      // A cancel that arrived while the temp files were being written must
      // win over starting the engine.
      if (active.cancelRequested) {
        this.finishCanceled(info);
        return;
      }

      const stopHeartbeat = (): void => {
        if (heartbeat !== null) {
          clearInterval(heartbeat);
          heartbeat = null;
        }
      };
      // Start the heartbeat before the engine runs so the layout-parsing phase
      // also shows movement; nothing else prints during it.
      heartbeat = setInterval(() => {
        if (info.status !== 'running') {
          return;
        }
        const now = Date.now();
        const line = heartbeatLine(
          latestActivity,
          now - info.startedAt,
          info.percent,
          latestStage,
        );
        info.line = line;
        // Only add a line while the engine itself is silent; real engine
        // output is already streaming into the log.
        const appendLog = now - lastLogAt >= HEARTBEAT_LOG_INTERVAL_MS;
        if (appendLog) {
          lastLogAt = now;
          info.logs = [...info.logs, line].slice(-MAX_LOG_LINES);
        }
        this.emitSafely('translation:progress', {
          jobId: info.jobId,
          paperId: info.paperId,
          percent: info.percent,
          line,
          appendLog,
        } satisfies TranslationProgressEvent);
      }, HEARTBEAT_INTERVAL_MS);

      const result = await this.deps.runner.run({
        jobId: info.jobId,
        kind: 'translate',
        command: invocation,
        redact: secrets,
        parsePercent: parsePercentLine,
        onLine: (rawLine, percent) => {
          const line = redactSecrets(rawLine, secrets);
          info.line = line;
          lastLogAt = Date.now();
          const stage = translationStage(line);
          if (stage !== null) {
            latestStage = stage;
          }
          const nextPercent = percent ?? parsePercentLine(line);
          if (nextPercent !== null) {
            info.percent = nextPercent;
          }
          info.logs = [...info.logs, line].slice(-MAX_LOG_LINES);
          this.emitSafely('translation:progress', {
            jobId: info.jobId,
            paperId: info.paperId,
            percent: info.percent,
            line,
          } satisfies TranslationProgressEvent);
        },
      });
      stopHeartbeat();

      if (result.canceled || active.cancelRequested) {
        this.finishCanceled(info);
        return;
      }
      if (result.timedOut) {
        throw new Error(TIMED_OUT_MESSAGE);
      }
      // The runner also exposes the complete redacted output; prefer it over
      // the per-line snapshots because a runner may buffer its lines.
      const outputLines = (result.lines.length > 0 ? result.lines : info.logs)
        .map((line) => redactSecrets(line, secrets))
        .slice(-MAX_LOG_LINES);
      info.logs = outputLines;
      if (result.code !== 0) {
        throw new Error(classifyFailure(outputLines));
      }

      // A translation request that exhausted its retries means at least one
      // paragraph has no translation, even if the page-level audit happens to
      // stay above its threshold. Never bind that output.
      const proxyFailure = proxy.getFailure();
      if (proxyFailure !== null) {
        throw new Error(
          proxyFailure === 'empty'
            ? TRANSLATION_PAPER_EMPTY_RESULT
            : proxyFailure === 'unreachable'
              ? NETWORK_FAILURE_MESSAGE
              : GENERIC_FAILURE_MESSAGE,
        );
      }

      const files = await collectOutputFiles(outDir);
      const monoPath = chooseMono(files, pdfStem(paper.filePathOriginal));
      const dualPath = chooseDual(files, monoPath);
      const monoPageCount = await validatePdfOutput(monoPath);
      const dualPageCount =
        dualPath === null ? null : await validatePdfOutput(dualPath);

      // A mono page whose Chinese translation collapsed is unusable. The dual
      // output keeps the original text alongside the translation, so it can
      // stand in when only the mono layout lost content; if it is missing or
      // its translation is also incomplete, fail instead of binding a lossy
      // translation.
      let primary: 'mono' | 'dual' = 'mono';
      let pageCountTranslated = monoPageCount;
      const monoPages = await extractOutputPages(monoPath);
      if (
        monoPages !== null &&
        findIncompletePages(storedPages, monoPages).length > 0
      ) {
        if (dualPath === null || dualPageCount === null) {
          throw new Error(TRANSLATION_OUTPUT_INCOMPLETE);
        }
        const dualPages = await extractOutputPages(dualPath);
        if (
          dualPages !== null &&
          findIncompletePages(storedPages, dualPages).length > 0
        ) {
          throw new Error(TRANSLATION_OUTPUT_INCOMPLETE);
        }
        primary = 'dual';
        pageCountTranslated = dualPageCount;
      }
      // Validation is asynchronous: a cancel that arrived while page counts
      // were read must win before any file is copied or backed up.
      if (active.cancelRequested) {
        this.finishCanceled(info);
        return;
      }

      const updated = await this.bindOutput(
        paper,
        info,
        secrets,
        monoPath,
        dualPath,
        primary,
        pageCountTranslated,
        () => active.cancelRequested,
      );
      if (updated === null) {
        // bindOutput rolled back every created file and restored backups.
        this.finishCanceled(info);
        return;
      }
      const message = primary === 'dual' ? TRANSLATION_DONE_DUAL : TRANSLATION_DONE;
      info.status = 'done';
      info.percent = 100;
      info.line = message;
      info.error = null;
      this.emitSafely('translation:done', {
        jobId: info.jobId,
        paper: updated,
        message,
      } satisfies TranslationDoneEvent);
    } catch (error) {
      if (info.status === 'running') {
        const message = this.failureMessage(error, secrets, info.logs);
        info.status = 'failed';
        info.error = message;
        info.line = message;
        this.emitSafely('translation:failed', {
          jobId: info.jobId,
          paperId: info.paperId,
          message,
        } satisfies TranslationFailedEvent);
      }
    } finally {
      if (heartbeat !== null) {
        clearInterval(heartbeat);
        heartbeat = null;
      }
      // Cleanup order matters: the local relay is closed, then the temp
      // directory is removed, even when the lease release (which notifies the
      // renderer) fails. No cleanup step may turn this job into an unhandled
      // rejection.
      if (proxy !== null) {
        await proxy.close().catch(() => undefined);
      }
      if (tempDir !== null) {
        await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
      }
      try {
        // Idempotent and job-scoped: a late release can never clear a newer job.
        this.deps.jobs.releaseTranslation(info.jobId);
      } catch {
        // The renderer/window may already be gone; the job itself is finished.
      }
      if (this.active === active) {
        active.tempDir = null;
      }
    }
  }

  private finishCanceled(info: TranslationJobInfo): void {
    info.status = 'canceled';
    info.error = null;
    info.line = '已取消';
    this.emitSafely('translation:canceled', {
      jobId: info.jobId,
      paperId: info.paperId,
    } satisfies TranslationCanceledEvent);
  }

  /**
   * A failed job's message must stay Chinese and must never contain the key.
   * Unexpected English transport errors fall back to a classified message.
   */
  private failureMessage(error: unknown, secrets: string[], lines: string[]): string {
    const raw = redactSecrets(errorMessage(error), secrets);
    if (hasChinese(raw)) {
      return raw;
    }
    return classifyFailure(lines);
  }

  private emitSafely(channel: string, payload: unknown): void {
    try {
      this.deps.emit(channel, payload);
    } catch {
      // A destroyed window must not turn a successful job into a failure.
    }
  }

  private async createTempDirectory(): Promise<string> {
    const base = this.deps.tempRoot ?? tmpdir();
    if (this.deps.tempRoot !== undefined) {
      await mkdir(base, { recursive: true });
    }
    return mkdtemp(join(base, 'paperlens-babeldoc-'));
  }

  /**
   * Copies the outputs into job-specific files next to the finals, backs up
   * any previous bound files, renames the new files into place, and updates the
   * DB row directly. Cancellation is re-checked before every destructive step;
   * a canceled bind removes new files, restores backups, and returns null
   * without touching the existing binding. Any other failure restores the
   * previous state exactly and reports a fixed Chinese message.
   */
  private async bindOutput(
    paper: Paper,
    info: TranslationJobInfo,
    secrets: string[],
    monoPath: string,
    dualPath: string | null,
    primary: 'mono' | 'dual',
    pageCountTranslated: number,
    shouldCancel: () => boolean,
  ): Promise<Paper | null> {
    if (paper.storageDir === null) {
      throw new Error(INVALID_MANAGED_PATH_MESSAGE);
    }
    if (primary === 'dual' && dualPath === null) {
      throw new Error(TRANSLATION_OUTPUT_INCOMPLETE);
    }
    const root = this.deps.getRoot();
    const finalMono = storageFile(root, paper.storageDir, BABELDOC_MONO_NAME);
    const finalDual = storageFile(root, paper.storageDir, BABELDOC_DUAL_NAME);
    const finalPrimary = primary === 'dual' ? finalDual : finalMono;
    const jobId = info.jobId;
    const newMono = `${finalMono}.new-${jobId}`;
    const newDual = dualPath === null ? null : `${finalDual}.new-${jobId}`;
    const backupMono = `${finalMono}.bak-${jobId}`;
    const backupDual = `${finalDual}.bak-${jobId}`;

    let monoBackedUp = false;
    let dualBackedUp = false;
    let monoMoved = false;
    let dualMoved = false;

    const rollback = async (): Promise<void> => {
      if (monoMoved) {
        await rm(finalMono, { force: true }).catch(() => undefined);
      }
      if (dualMoved) {
        await rm(finalDual, { force: true }).catch(() => undefined);
      }
      if (monoBackedUp) {
        await rename(backupMono, finalMono).catch(() => undefined);
      }
      if (dualBackedUp) {
        await rename(backupDual, finalDual).catch(() => undefined);
      }
      await rm(newMono, { force: true }).catch(() => undefined);
      if (newDual !== null) {
        await rm(newDual, { force: true }).catch(() => undefined);
      }
    };

    try {
      await copyFile(monoPath, newMono);
      if (dualPath !== null && newDual !== null) {
        await copyFile(dualPath, newDual);
      }
      if (shouldCancel()) {
        await rollback();
        return null;
      }

      if (existsSync(finalMono)) {
        await rename(finalMono, backupMono);
        monoBackedUp = true;
      }
      // Without a new dual the existing dual file must stay untouched.
      if (newDual !== null && existsSync(finalDual)) {
        await rename(finalDual, backupDual);
        dualBackedUp = true;
      }
      if (shouldCancel()) {
        await rollback();
        return null;
      }

      await rename(newMono, finalMono);
      monoMoved = true;
      if (newDual !== null) {
        await rename(newDual, finalDual);
        dualMoved = true;
      }
      // The DB update is synchronous; checking immediately before it (with no
      // await in between) closes the last window for a cancel to slip in.
      if (shouldCancel()) {
        await rollback();
        return null;
      }

      const current = getPaper(this.deps.db, paper.id) ?? paper;
      const updated = updatePaper(this.deps.db, paper.id, {
        filePathTranslated: finalPrimary,
        pageCountTranslated,
        lastPageTranslated: Math.min(
          Math.max(1, current.lastPageTranslated),
          pageCountTranslated,
        ),
      });

      if (monoBackedUp) {
        await rm(backupMono, { force: true }).catch(() => undefined);
      }
      if (dualBackedUp) {
        await rm(backupDual, { force: true }).catch(() => undefined);
      }
      return updated;
    } catch (error) {
      await rollback();
      // The raw filesystem detail stays in the (redacted) log where it can be
      // inspected; the user-facing card only sees a fixed Chinese message.
      info.logs = [
        ...info.logs,
        redactSecrets(`${BINDING_FAILED_DETAIL_PREFIX}${errorMessage(error)}`, secrets),
      ].slice(-MAX_LOG_LINES);
      throw new Error(BINDING_FAILED_MESSAGE);
    }
  }
}
