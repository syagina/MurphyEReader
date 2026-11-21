import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { PDFDocument } from 'pdf-lib';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb } from '@main/db';
import { replacePages } from '@main/db/pages';
import { createPaper, getPaper, updatePaper } from '@main/db/papers';
import { JobRegistry } from '@main/jobs/job-registry';
import { getPdfPageCount } from '@main/pdf/extract';
import { PaperLibrary } from '@main/storage/library-service';
import {
  BABELDOC_DUAL_NAME,
  BABELDOC_MONO_NAME,
  ORIGINAL_PDF_NAME,
  storageFile,
} from '@main/storage/paths';
import { PaperTranslationService } from '@main/translation/paper-translation';
import type { PaperTranslationDeps } from '@main/translation/paper-translation';
import { TRANSLATION_OUTPUT_INCOMPLETE } from '@shared/translation';
import type {
  Paper,
  ToolRunOptions,
  ToolRunResult,
  TranslationCanceledEvent,
  TranslationFailedEvent,
  TranslationProgressEvent,
} from '@shared/types';
import { generateFixtures, SAMPLE_SCANNED_PDF, SAMPLE_TEXT_PDF } from '../fixtures/generate';

// The cancellation test needs deterministic control over the asynchronous
// page-count validation. The mock forwards to the real implementation by
// default so every other test still parses fixture PDFs normally.
const pdfExtractActual = vi.hoisted(() => ({
  getPdfPageCount: null as null | ((filePath: string) => Promise<number>),
}));

vi.mock('@main/pdf/extract', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@main/pdf/extract')>();
  pdfExtractActual.getPdfPageCount = actual.getPdfPageCount;
  return {
    ...actual,
    getPdfPageCount: vi.fn(actual.getPdfPageCount),
    // BabelDOC outputs in these tests are copies of English fixture PDFs.
    // Extraction keeps page geometry and emptiness (so the lost-page test still
    // works) but gives every non-empty page a Chinese text layer, which is what
    // the real preserved-layout output contains.
    extractPdf: vi.fn(async (filePath: string) => {
      const result = await actual.extractPdf(filePath);
      const normalized = filePath.replace(/\\/g, '/');
      if (
        !normalized.endsWith('.mono.pdf') &&
        !normalized.endsWith('.dual.pdf')
      ) {
        return result;
      }
      return {
        ...result,
        pages: result.pages.map((page) =>
          page.text.trim() === ''
            ? page
            : {
                ...page,
                text: '这是一段完整的中文译文，用于验证翻译覆盖检查。'.repeat(40),
              },
        ),
      };
    }),
  };
});

const mockedGetPdfPageCount = vi.mocked(getPdfPageCount);

const MISSING_ENGINE = '未检测到 BabelDOC，请在设置中安装或指定路径';
const NOT_CONFIGURED = '请先在设置中配置 AI 接口';
const TRANSLATING = '该文献正在翻译，暂不能删除、重新定位或绑定译本';
const BUSY = '请先等待当前任务完成';
const ALREADY_CHINESE = '这篇看起来已是中文文献';
const NO_TEXT_LAYER =
  '该文献是扫描件，没有文字层，无法翻译；请先自行 OCR 生成可搜索 PDF 后重试';
const OUTPUT_MISSING = '未找到翻译输出';
const OUTPUT_AMBIGUOUS = '翻译输出不唯一';
const OUTPUT_INVALID = '翻译输出文件无效';

const AI_CONFIG = {
  baseUrl: 'https://relay/v1',
  apiKey: 'sk-secret',
  chatModel: 'gpt-4o',
  visionModel: '',
  temperature: 0.7,
};

const SHORT_ENGLISH_TEXT =
  'This short English text is enough for the whole-paper Chinese check. '.repeat(6);
const CHINESE_TEXT = '这是一篇中文文献的正文，用来验证整篇翻译之前的中文检测。'.repeat(200);

interface FakeRunner {
  run: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
  cancelAll: ReturnType<typeof vi.fn>;
  activeJobIds: ReturnType<typeof vi.fn>;
}

interface EventRecord {
  channel: string;
  payload: unknown;
}

let tempDir: string;
let root: string;
let tempRoot: string;
let db: Database.Database;
let jobs: JobRegistry;
let library: PaperLibrary;
let events: EventRecord[];

function emit(channel: string, payload: unknown): void {
  events.push({ channel, payload });
}

function ok(overrides: Partial<ToolRunResult> = {}): ToolRunResult {
  return { code: 0, signal: null, lines: [], canceled: false, timedOut: false, ...overrides };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function makeFakeRunner(
  run: (options: ToolRunOptions) => Promise<ToolRunResult> | ToolRunResult,
): FakeRunner {
  return {
    run: vi.fn(async (options: ToolRunOptions) => run(options)),
    cancel: vi.fn(() => true),
    cancelAll: vi.fn(),
    activeJobIds: vi.fn(() => []),
  };
}

/** Mimics BabelDOC: read the config argument, then write outputs into --output. */
async function writeOutputs(
  options: ToolRunOptions,
  names: { mono?: string; dual?: string } = {},
): Promise<{ config: string; args: string; outDir: string }> {
  const args = options.command.args;
  const configPath = args[args.indexOf('--config') + 1];
  const config = await readFile(configPath, 'utf8');
  const outDir = args[args.indexOf('--output') + 1];
  await mkdir(outDir, { recursive: true });
  if (names.mono !== undefined) {
    await copyFile(SAMPLE_TEXT_PDF, join(outDir, names.mono));
  }
  if (names.dual !== undefined) {
    await copyFile(SAMPLE_SCANNED_PDF, join(outDir, names.dual));
  }
  return { config, args: args.join(' '), outDir };
}

/** Writes a PDF with blank pages, simulating a mono output that lost content. */
async function writeBlankPdf(target: string, pageCount: number): Promise<void> {
  const doc = await PDFDocument.create();
  for (let index = 0; index < pageCount; index += 1) {
    doc.addPage([612, 792]);
  }
  writeFileSync(target, await doc.save());
}

function defaultRunner(): FakeRunner {
  return makeFakeRunner(async (options) => {
    await writeOutputs(options, {
      mono: 'original.zh-CN.mono.pdf',
      dual: 'original.zh-CN.dual.pdf',
    });
    return ok();
  });
}

function makeService(
  overrides: Partial<PaperTranslationDeps> = {},
  runner: FakeRunner = defaultRunner(),
): PaperTranslationService {
  return new PaperTranslationService({
    db,
    jobs,
    runner,
    library,
    getRoot: () => root,
    tempRoot,
    getEnginePath: async () => 'C:\\Tools\\babeldoc.exe',
    getAiConfig: () => ({ ...AI_CONFIG }),
    getTranslationOptions: () => ({
      qps: 8,
      workers: 16,
      autoExtractGlossary: true,
    }),
    emit,
    ...overrides,
  });
}

function createExternalPaper(text: string, fileName = 'external.pdf'): Paper {
  const filePath = join(tempDir, fileName);
  copyFileSync(SAMPLE_TEXT_PDF, filePath);
  const paper = createPaper(db, {
    title: '外部文献',
    authors: '',
    year: null,
    filePathOriginal: filePath,
    filePathTranslated: null,
    pageCountOriginal: 2,
    pageCountTranslated: null,
    hasTextLayer: true,
    outline: [],
    folderId: null,
    storageDir: null,
    fileHash: null,
  });
  replacePages(db, paper.id, [{ pageNo: 1, text }]);
  return paper;
}

function eventsOf<T>(channel: string): T[] {
  return events.filter((event) => event.channel === channel).map((event) => event.payload as T);
}

function isChinese(message: string): boolean {
  return /[\u4e00-\u9fff]/.test(message);
}

beforeAll(async () => {
  await generateFixtures();
});

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'paperlens-translation-'));
  root = join(tempDir, 'library');
  tempRoot = join(tempDir, 'tmp');
  db = openDb(':memory:');
  jobs = new JobRegistry();
  library = new PaperLibrary({ db, jobs, getRoot: () => root });
  events = [];
  mockedGetPdfPageCount.mockReset();
  mockedGetPdfPageCount.mockImplementation(pdfExtractActual.getPdfPageCount!);
});

afterEach(() => {
  db.close();
  rmSync(tempDir, { recursive: true, force: true });
});

describe('PaperTranslationService.start', () => {
  it('翻译整篇文献并把 mono/dual 输出绑定到规范文件夹', async () => {
    const { paper } = await library.importPaper(SAMPLE_TEXT_PDF);
    let captured: { config: string; args: string; redact: string[] | undefined } | null = null;
    const runner = makeFakeRunner(async (options) => {
      const written = await writeOutputs(options, {
        mono: 'original.zh-CN.mono.pdf',
        dual: 'original.zh-CN.dual.pdf',
      });
      captured = {
        config: written.config,
        args: written.args,
        redact: options.redact,
      };
      options.onLine?.('42% 完成', 42);
      return ok({ lines: ['42% 完成'] });
    });

    const service = makeService({}, runner);
    const started = await service.start(paper.id);

    expect(started).toEqual({
      jobId: expect.any(String),
      paperId: paper.id,
      title: paper.title,
    });

    await service.waitForIdle();

    const bound = getPaper(db, paper.id)!;
    expect(bound.filePathTranslated).toBe(
      storageFile(root, bound.storageDir!, BABELDOC_MONO_NAME),
    );
    expect(existsSync(bound.filePathTranslated!)).toBe(true);
    expect(existsSync(storageFile(root, bound.storageDir!, BABELDOC_DUAL_NAME))).toBe(true);
    expect(bound.pageCountTranslated).toBe(2);
    expect(bound.pageCountBilingual).toBe(1);
    expect(bound.lastPageTranslated).toBe(1);
    expect(captured!.config).not.toContain('sk-secret');
    expect(captured!.config).not.toContain('https://relay/v1');
    expect(captured!.config).toMatch(
      /openai-base-url = "http:\/\/127\.0\.0\.1:\d+\/v1"/,
    );
    const proxyKey = /openai-api-key = "([0-9a-f]{48})"/.exec(captured!.config);
    expect(proxyKey).not.toBeNull();
    expect(captured!.config).toContain('lang-out = "zh-CN"');
    expect(captured!.config).toContain('openai-model = "gpt-4o"');
    expect(captured!.config).toContain('qps = 8');
    expect(captured!.config).toContain('pool-max-workers = 16');
    expect(captured!.config).toContain('term-pool-max-workers = 16');
    expect(captured!.config).not.toContain('no-auto-extract-glossary');
    expect(captured!.args).not.toContain('sk-secret');
    expect(captured!.args).not.toContain(proxyKey![1]);
    expect(captured!.redact).toEqual(
      expect.arrayContaining(['sk-secret', proxyKey![1]]),
    );

    expect(readdirSync(tempRoot)).toEqual([]);
    expect(service.getState()).toBeNull();
    expect(jobs.getState().toolTask).toBeNull();

    const done = eventsOf<{ jobId: string; paper: Paper }>('translation:done');
    expect(done).toHaveLength(1);
    expect(done[0].jobId).toBe(started.jobId);
    expect(done[0].paper.id).toBe(paper.id);
    const progress = eventsOf<TranslationProgressEvent>('translation:progress');
    expect(progress.some((event) => event.percent === 42 && event.line.includes('42%'))).toBe(
      true,
    );
    // Neither the real key nor the local relay credential reaches an event.
    expect(JSON.stringify(events)).not.toContain('sk-secret');
    expect(JSON.stringify(events)).not.toContain(proxyKey![1]);
  });

  it('把设置中的 QPS、线程数和术语提取开关写入本次翻译配置', async () => {
    const { paper } = await library.importPaper(SAMPLE_TEXT_PDF);
    let config = '';
    const runner = makeFakeRunner(async (options) => {
      const written = await writeOutputs(options, {
        mono: 'original.zh-CN.mono.pdf',
        dual: 'original.zh-CN.dual.pdf',
      });
      config = written.config;
      return ok({ lines: [] });
    });

    const service = makeService(
      {
        getTranslationOptions: () => ({
          qps: 12,
          workers: 24,
          autoExtractGlossary: false,
        }),
      },
      runner,
    );
    await service.start(paper.id);
    await service.waitForIdle();

    expect(config).toContain('qps = 12');
    expect(config).toContain('pool-max-workers = 24');
    expect(config).toContain('term-pool-max-workers = 24');
    expect(config).toContain('no-auto-extract-glossary = true');
  });

  it('翻译失败时保留旧译本的路径和内容', async () => {
    const { paper } = await library.importPaper(SAMPLE_TEXT_PDF);
    const attached = await library.attachTranslated(paper.id, SAMPLE_SCANNED_PDF);
    const oldPath = attached.filePathTranslated!;
    const oldBytes = readFileSync(oldPath);
    const runner = makeFakeRunner(async () => ok({ code: 1, lines: ['ERROR 401 Unauthorized'] }));

    const service = makeService({}, runner);
    await service.start(paper.id);
    await service.waitForIdle();

    const after = getPaper(db, paper.id)!;
    expect(after.filePathTranslated).toBe(oldPath);
    expect(readFileSync(oldPath).equals(oldBytes)).toBe(true);
    expect(existsSync(storageFile(root, after.storageDir!, BABELDOC_MONO_NAME))).toBe(false);

    const failed = eventsOf<TranslationFailedEvent>('translation:failed');
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ paperId: paper.id });
    expect(failed[0].message).toBe('AI 接口认证失败，请检查 API Key');
    expect(isChinese(failed[0].message)).toBe(true);
    expect(jobs.getState().toolTask).toBeNull();
    expect(readdirSync(tempRoot)).toEqual([]);
  });

  it('翻译取消时不写绑定并保留旧译本', async () => {
    const { paper } = await library.importPaper(SAMPLE_TEXT_PDF);
    const attached = await library.attachTranslated(paper.id, SAMPLE_SCANNED_PDF);
    const oldPath = attached.filePathTranslated!;
    const runner = makeFakeRunner(async () =>
      ok({ code: null, signal: 'SIGTERM', canceled: true }),
    );

    const service = makeService({}, runner);
    await service.start(paper.id);
    await service.waitForIdle();

    expect(getPaper(db, paper.id)!.filePathTranslated).toBe(oldPath);
    const canceled = eventsOf<TranslationCanceledEvent>('translation:canceled');
    expect(canceled).toHaveLength(1);
    expect(canceled[0]).toMatchObject({ paperId: paper.id });
    expect(eventsOf('translation:done')).toHaveLength(0);
    expect(readdirSync(tempRoot)).toEqual([]);
    expect(jobs.getState().toolTask).toBeNull();
  });

  it('运行中取消会转交 runner，且空闲后不留下 DB 绑定', async () => {
    const { paper } = await library.importPaper(SAMPLE_TEXT_PDF);
    const gate = deferred<ToolRunResult>();
    const runner = makeFakeRunner(() => gate.promise);
    const service = makeService({}, runner);

    const started = await service.start(paper.id);
    expect(service.cancel(started.jobId)).toBe(true);
    expect(runner.cancel).toHaveBeenCalledWith(started.jobId);
    gate.resolve(ok({ canceled: true }));
    await service.waitForIdle();

    expect(getPaper(db, paper.id)!.filePathTranslated).toBeNull();
    expect(eventsOf('translation:canceled')).toHaveLength(1);
    expect(readdirSync(tempRoot)).toEqual([]);
    expect(jobs.getState().toolTask).toBeNull();
  });

  it('取消请求早于进程启动成功返回时仍按取消处理且不写绑定', async () => {
    const { paper } = await library.importPaper(SAMPLE_TEXT_PDF);
    const gate = deferred<ToolRunResult>();
    const runner = makeFakeRunner(() => gate.promise);
    const service = makeService({}, runner);

    const started = await service.start(paper.id);
    expect(service.cancel(started.jobId)).toBe(true);
    // The engine finishes "successfully" after the cancel request; its output
    // must still be discarded.
    gate.resolve(ok());
    await service.waitForIdle();

    expect(getPaper(db, paper.id)!.filePathTranslated).toBeNull();
    expect(eventsOf('translation:canceled')).toHaveLength(1);
    expect(eventsOf('translation:done')).toHaveLength(0);
    expect(jobs.getState().toolTask).toBeNull();
  });

  it('首 5000 个字符的中文占比达到 0.5 时拒绝翻译', async () => {
    const paper = createExternalPaper(CHINESE_TEXT);
    const service = makeService();

    await expect(service.start(paper.id)).rejects.toThrow(ALREADY_CHINESE);

    expect(getPaper(db, paper.id)!.storageDir).toBeNull();
    expect(jobs.getState().toolTask).toBeNull();
    expect(events).toEqual([]);
  });

  it('未检测到引擎时以固定中文消息拒绝', async () => {
    const { paper } = await library.importPaper(SAMPLE_TEXT_PDF);
    const service = makeService({ getEnginePath: async () => null });

    await expect(service.start(paper.id)).rejects.toThrow(MISSING_ENGINE);
    expect(jobs.getState().toolTask).toBeNull();
  });

  it('未配置 AI 接口时以固定中文消息拒绝', async () => {
    const { paper } = await library.importPaper(SAMPLE_TEXT_PDF);
    const service = makeService({ getAiConfig: () => null });

    await expect(service.start(paper.id)).rejects.toThrow(NOT_CONFIGURED);
    expect(jobs.getState().toolTask).toBeNull();
  });

  it('原文文件不存在时拒绝翻译', async () => {
    const { paper } = await library.importPaper(SAMPLE_TEXT_PDF);
    rmSync(paper.filePathOriginal);
    const service = makeService();

    await expect(service.start(paper.id)).rejects.toThrow('原文文件不存在');
    expect(jobs.getState().toolTask).toBeNull();
  });

  it('没有文字层的扫描件以固定中文消息拒绝并要求先 OCR', async () => {
    const { paper } = await library.importPaper(SAMPLE_SCANNED_PDF);
    expect(paper.hasTextLayer).toBe(false);
    const service = makeService();

    await expect(service.start(paper.id)).rejects.toThrow(NO_TEXT_LAYER);

    expect(service.getState()).toBeNull();
    expect(jobs.getState().toolTask).toBeNull();
    expect(events).toEqual([]);
  });

  it('已有工具任务时原样传播忙碌错误且不创建任务', async () => {
    const { paper } = await library.importPaper(SAMPLE_TEXT_PDF);
    jobs.tryAcquireTool('install', 'held-job');
    const service = makeService();

    await expect(service.start(paper.id)).rejects.toThrow(BUSY);

    expect(service.getState()).toBeNull();
    expect(events).toEqual([]);
    expect(jobs.getState()).toMatchObject({ toolTask: 'install', toolJobId: 'held-job' });
  });

  it('未托管文献先整理再翻译，且任务使用整理后的原文路径', async () => {
    const paper = createExternalPaper(SHORT_ENGLISH_TEXT);
    let filesArg = '';
    const runner = makeFakeRunner(async (options) => {
      const args = options.command.args;
      filesArg = args[args.indexOf('--files') + 1];
      await writeOutputs(options, { mono: 'original.zh-CN.mono.pdf' });
      return ok();
    });
    const service = makeService({}, runner);

    await service.start(paper.id);
    await service.waitForIdle();

    const bound = getPaper(db, paper.id)!;
    expect(bound.storageDir).not.toBeNull();
    expect(filesArg).toBe(storageFile(root, bound.storageDir!, ORIGINAL_PDF_NAME));
    expect(bound.filePathTranslated).toBe(
      storageFile(root, bound.storageDir!, BABELDOC_MONO_NAME),
    );
  });
});

describe('PaperTranslationService outputs', () => {
  it('没有 mono 输出时以中文消息失败', async () => {
    const { paper } = await library.importPaper(SAMPLE_TEXT_PDF);
    const runner = makeFakeRunner(async (options) => {
      await writeOutputs(options, { dual: 'original.zh-CN.dual.pdf' });
      return ok();
    });
    const service = makeService({}, runner);

    await service.start(paper.id);
    await service.waitForIdle();

    const failed = eventsOf<TranslationFailedEvent>('translation:failed');
    expect(failed).toHaveLength(1);
    expect(failed[0].message).toBe(OUTPUT_MISSING);
    expect(getPaper(db, paper.id)!.filePathTranslated).toBeNull();
  });

  it('多个 mono 输出时以中文消息失败', async () => {
    const { paper } = await library.importPaper(SAMPLE_TEXT_PDF);
    const runner = makeFakeRunner(async (options) => {
      await writeOutputs(options, { mono: 'original.zh-CN.mono.pdf' });
      const args = options.command.args;
      const outDir = args[args.indexOf('--output') + 1];
      await copyFile(SAMPLE_TEXT_PDF, join(outDir, 'original.en.mono.pdf'));
      return ok();
    });
    const service = makeService({}, runner);

    await service.start(paper.id);
    await service.waitForIdle();

    expect(eventsOf<TranslationFailedEvent>('translation:failed')[0].message).toBe(
      OUTPUT_AMBIGUOUS,
    );
  });

  it('非 PDF 输出以中文消息失败', async () => {
    const { paper } = await library.importPaper(SAMPLE_TEXT_PDF);
    const runner = makeFakeRunner(async (options) => {
      const args = options.command.args;
      const outDir = args[args.indexOf('--output') + 1];
      await mkdir(outDir, { recursive: true });
      writeFileSync(join(outDir, 'original.zh-CN.mono.pdf'), 'not a pdf');
      return ok();
    });
    const service = makeService({}, runner);

    await service.start(paper.id);
    await service.waitForIdle();

    expect(eventsOf<TranslationFailedEvent>('translation:failed')[0].message).toBe(
      OUTPUT_INVALID,
    );
    expect(getPaper(db, paper.id)!.filePathTranslated).toBeNull();
  });

  it('没有 dual 输出时保留旧对照文件并只重新绑定 mono', async () => {
    const { paper } = await library.importPaper(SAMPLE_TEXT_PDF);
    const storageDir = paper.storageDir!;
    const monoPath = storageFile(root, storageDir, BABELDOC_MONO_NAME);
    const dualPath = storageFile(root, storageDir, BABELDOC_DUAL_NAME);
    writeFileSync(monoPath, Buffer.from('%PDF-1.4\nOLD MONO TRANSLATION'));
    writeFileSync(dualPath, readFileSync(SAMPLE_SCANNED_PDF));
    updatePaper(db, paper.id, {
      filePathTranslated: monoPath,
      pageCountTranslated: 2,
      pageCountBilingual: 9,
      lastPageTranslated: 999,
      lastOffsetTranslated: 0.5,
      lastVersion: 'bilingual',
    });
    const oldMono = readFileSync(monoPath);
    const oldDual = readFileSync(dualPath);
    const runner = makeFakeRunner(async (options) => {
      await writeOutputs(options, { mono: 'original.zh-CN.mono.pdf' });
      return ok();
    });
    const service = makeService({}, runner);

    await service.start(paper.id);
    await service.waitForIdle();

    const after = getPaper(db, paper.id)!;
    expect(after.filePathTranslated).toBe(monoPath);
    expect(readFileSync(monoPath).equals(oldMono)).toBe(false);
    expect(readFileSync(dualPath).equals(oldDual)).toBe(true);
    expect(after.pageCountTranslated).toBe(2);
    expect(after.pageCountBilingual).toBeNull();
    expect(after.lastPageTranslated).toBe(2);
    expect(after.lastOffsetTranslated).toBe(0);
    expect(after.lastVersion).toBe('bilingual');
    const leftovers = readdirSync(join(root, storageDir)).filter(
      (name) => name.includes('.bak-') || name.includes('.new-'),
    );
    expect(leftovers).toEqual([]);
  });

  it('参考文献页也交给 BabelDOC 翻译并绑定 mono', async () => {
    const { paper } = await library.importPaper(SAMPLE_TEXT_PDF);
    replacePages(db, paper.id, [
      { pageNo: 1, text: 'Body prose. '.repeat(150) },
      {
        pageNo: 2,
        text: `References\n${'Entry text. '.repeat(150)}\nEntry two.`,
      },
    ]);
    let args: string[] = [];
    const runner = makeFakeRunner(async (options) => {
      args = options.command.args;
      await writeOutputs(options, {
        mono: 'original.zh-CN.mono.pdf',
        dual: 'original.zh-CN.dual.pdf',
      });
      return ok();
    });
    const service = makeService({}, runner);

    await service.start(paper.id);
    await service.waitForIdle();

    const bound = getPaper(db, paper.id)!;
    expect(args).not.toContain('--pages');
    expect(bound.filePathTranslated).toBe(
      storageFile(root, bound.storageDir!, BABELDOC_MONO_NAME),
    );
    const done = eventsOf<{ message?: string }>('translation:done');
    expect(done[0].message).toBe('翻译完成');
  });

  it('mono 丢失页面时改用 dual 绑定并提示', async () => {
    const { paper } = await library.importPaper(SAMPLE_TEXT_PDF);
    replacePages(db, paper.id, [
      { pageNo: 1, text: 'Body prose. '.repeat(150) },
      { pageNo: 2, text: 'More body prose. '.repeat(100) },
    ]);
    const runner = makeFakeRunner(async (options) => {
      const args = options.command.args;
      const outDir = args[args.indexOf('--output') + 1];
      await mkdir(outDir, { recursive: true });
      await writeBlankPdf(join(outDir, 'original.zh-CN.mono.pdf'), 2);
      await copyFile(SAMPLE_TEXT_PDF, join(outDir, 'original.zh-CN.dual.pdf'));
      return ok();
    });
    const service = makeService({}, runner);

    await service.start(paper.id);
    await service.waitForIdle();

    const bound = getPaper(db, paper.id)!;
    expect(bound.filePathTranslated).toBe(
      storageFile(root, bound.storageDir!, BABELDOC_DUAL_NAME),
    );
    expect(bound.pageCountTranslated).toBe(2);
    expect(bound.pageCountBilingual).toBe(2);
    expect(existsSync(bound.filePathTranslated!)).toBe(true);
    const done = eventsOf<{
      message?: string;
      paper: Paper;
    }>('translation:done');
    expect(done).toHaveLength(1);
    expect(done[0].message).toBe('翻译完成（已改用双语对照版，避免内容遗漏）');
  });

  it('mono 丢失页面且没有 dual 时以中文消息失败', async () => {
    const { paper } = await library.importPaper(SAMPLE_TEXT_PDF);
    replacePages(db, paper.id, [
      { pageNo: 1, text: 'Body prose. '.repeat(150) },
      { pageNo: 2, text: 'More body prose. '.repeat(100) },
    ]);
    const runner = makeFakeRunner(async (options) => {
      const args = options.command.args;
      const outDir = args[args.indexOf('--output') + 1];
      await mkdir(outDir, { recursive: true });
      await writeBlankPdf(join(outDir, 'original.zh-CN.mono.pdf'), 2);
      return ok();
    });
    const service = makeService({}, runner);

    await service.start(paper.id);
    await service.waitForIdle();

    expect(getPaper(db, paper.id)!.filePathTranslated).toBeNull();
    const failed = eventsOf<TranslationFailedEvent>('translation:failed');
    expect(failed).toHaveLength(1);
    expect(failed[0].message).toContain(TRANSLATION_OUTPUT_INCOMPLETE);
    expect(failed[0].message).toContain('第 1、2 页');
    const progress = eventsOf<TranslationProgressEvent>('translation:progress');
    expect(progress.some((event) => event.line.includes('完整性检查'))).toBe(true);
    const preserved = readdirSync(tempRoot).filter((name) =>
      name.startsWith('paperlens-babeldoc-'),
    );
    expect(preserved).toHaveLength(1);
    expect(readdirSync(join(tempRoot, preserved[0]))).toContain(
      'completeness.json',
    );
  });

  it('TOML 值会转义反斜杠、引号并压平控制字符', async () => {
    const { paper } = await library.importPaper(SAMPLE_TEXT_PDF);
    let config = '';
    const runner = makeFakeRunner(async (options) => {
      const written = await writeOutputs(options, { mono: 'original.zh-CN.mono.pdf' });
      config = written.config;
      return ok();
    });
    const service = makeService(
      {
        getAiConfig: () => ({
          ...AI_CONFIG,
          baseUrl: 'https://relay/v1\nopenai-api-key = "stolen"',
          chatModel: 'gpt-4o\\beta"x',
        }),
      },
      runner,
    );

    await service.start(paper.id);
    await service.waitForIdle();

    const keyLines = config.split('\n').filter((line) => line.startsWith('openai-api-key'));
    expect(keyLines).toHaveLength(1);
    expect(keyLines[0]).toMatch(/^openai-api-key = "[0-9a-f]{48}"$/);
    expect(config).not.toContain('sk-secret');
    expect(config).not.toContain('stolen');
    expect(config).toContain('openai-model = "gpt-4o\\\\beta\\"x"');
    expect(config).toMatch(/openai-base-url = "http:\/\/127\.0\.0\.1:\d+\/v1"/);
  });
});

describe('PaperTranslationService concurrency', () => {
  it('翻译中的文献拒绝删除、重新定位和绑定译本', async () => {
    const { paper } = await library.importPaper(SAMPLE_TEXT_PDF);
    const gate = deferred<ToolRunResult>();
    const runner = makeFakeRunner(() => gate.promise);
    const service = makeService({}, runner);

    const started = await service.start(paper.id);

    await expect(library.removePaper(paper.id)).rejects.toThrow(TRANSLATING);
    await expect(
      library.relocate(paper.id, 'translated', SAMPLE_SCANNED_PDF),
    ).rejects.toThrow(TRANSLATING);
    await expect(library.attachTranslated(paper.id, SAMPLE_SCANNED_PDF)).rejects.toThrow(
      TRANSLATING,
    );

    expect(service.cancel(started.jobId)).toBe(true);
    gate.resolve(ok({ canceled: true }));
    await service.waitForIdle();
    expect(jobs.getState().toolTask).toBeNull();
  });
});

describe('PaperTranslationService shutdown', () => {
  it('关闭时取消活动任务、清理临时目录并释放租约', async () => {
    const { paper } = await library.importPaper(SAMPLE_TEXT_PDF);
    const gate = deferred<ToolRunResult>();
    const runner = makeFakeRunner(() => gate.promise);
    const service = makeService({}, runner);

    const started = await service.start(paper.id);
    const shutdown = service.shutdown();
    expect(runner.cancel).toHaveBeenCalledWith(started.jobId);
    gate.resolve(ok({ canceled: true }));
    await shutdown;

    expect(runner.cancelAll).toHaveBeenCalled();
    expect(jobs.getState().toolTask).toBeNull();
    expect(eventsOf('translation:canceled')).toHaveLength(1);
    expect(readdirSync(tempRoot)).toEqual([]);
  });

  it('没有活动任务时关闭也是幂等的', async () => {
    const service = makeService();
    await expect(service.shutdown()).resolves.toBeUndefined();
    expect(jobs.getState().toolTask).toBeNull();
  });
});

describe('PaperTranslationService cancellation checkpoints', () => {
  /**
   * Binds an old mono translation manually so cancellation must leave both the
   * DB path and the file bytes exactly as they were.
   */
  function bindOldMono(paper: Paper, marker: string): { monoPath: string; oldBytes: Buffer } {
    const monoPath = storageFile(root, paper.storageDir!, BABELDOC_MONO_NAME);
    writeFileSync(monoPath, Buffer.from(`%PDF-1.4\n${marker}`));
    updatePaper(db, paper.id, { filePathTranslated: monoPath, pageCountTranslated: 2 });
    return { monoPath, oldBytes: readFileSync(monoPath) };
  }

  function expectNoBindingLeftovers(storageDir: string): void {
    const leftovers = readdirSync(join(root, storageDir)).filter(
      (name) => name.includes('.new-') || name.includes('.bak-'),
    );
    expect(leftovers).toEqual([]);
  }

  it('输出校验期间取消会保留旧译本并走取消路径', async () => {
    const { paper } = await library.importPaper(SAMPLE_TEXT_PDF);
    const storageDir = paper.storageDir!;
    const { monoPath, oldBytes } = bindOldMono(paper, 'OLD MONO DURING VALIDATION');

    const armed = deferred<void>();
    const validation = deferred<number>();
    const runner = makeFakeRunner(async (options) => {
      await armed.promise;
      await writeOutputs(options, { mono: 'original.zh-CN.mono.pdf' });
      return ok();
    });
    const service = makeService({}, runner);

    const started = await service.start(paper.id);
    mockedGetPdfPageCount.mockImplementationOnce(() => validation.promise);
    armed.resolve();
    await vi.waitFor(() => {
      expect(mockedGetPdfPageCount).toHaveBeenCalledTimes(1);
    });

    expect(service.cancel(started.jobId)).toBe(true);
    validation.resolve(2);
    await service.waitForIdle();

    expect(getPaper(db, paper.id)!.filePathTranslated).toBe(monoPath);
    expect(readFileSync(monoPath).equals(oldBytes)).toBe(true);
    expect(eventsOf('translation:canceled')).toHaveLength(1);
    expect(eventsOf('translation:done')).toHaveLength(0);
    expectNoBindingLeftovers(storageDir);
    expect(readdirSync(tempRoot)).toEqual([]);
    expect(jobs.getState().toolTask).toBeNull();
  });

  it('输出校验期间 shutdown 不会提交绑定', async () => {
    const { paper } = await library.importPaper(SAMPLE_TEXT_PDF);
    const storageDir = paper.storageDir!;
    const { monoPath, oldBytes } = bindOldMono(paper, 'OLD MONO DURING SHUTDOWN');

    const armed = deferred<void>();
    const validation = deferred<number>();
    const runner = makeFakeRunner(async (options) => {
      await armed.promise;
      await writeOutputs(options, { mono: 'original.zh-CN.mono.pdf' });
      return ok();
    });
    const service = makeService({}, runner);

    await service.start(paper.id);
    mockedGetPdfPageCount.mockImplementationOnce(() => validation.promise);
    armed.resolve();
    await vi.waitFor(() => {
      expect(mockedGetPdfPageCount).toHaveBeenCalledTimes(1);
    });

    const shutdown = service.shutdown();
    validation.resolve(2);
    await shutdown;

    expect(getPaper(db, paper.id)!.filePathTranslated).toBe(monoPath);
    expect(readFileSync(monoPath).equals(oldBytes)).toBe(true);
    expect(eventsOf('translation:canceled')).toHaveLength(1);
    expect(eventsOf('translation:done')).toHaveLength(0);
    expectNoBindingLeftovers(storageDir);
    expect(jobs.getState().toolTask).toBeNull();
  });

  it('引擎长时间无输出时发送中文心跳，并在 10 秒后写入日志', async () => {
    const { paper } = await library.importPaper(SAMPLE_TEXT_PDF);
    const gate = deferred<ToolRunResult>();
    const armed = deferred<void>();
    const runner = makeFakeRunner(async () => {
      armed.resolve();
      return gate.promise;
    });
    const service = makeService({}, runner);

    vi.useFakeTimers();
    try {
      await service.start(paper.id);
      // The heartbeat interval is created immediately before runner.run.
      await armed.promise;
      const before = eventsOf<TranslationProgressEvent>('translation:progress').length;

      await vi.advanceTimersByTimeAsync(3_000);

      const first = eventsOf<TranslationProgressEvent>('translation:progress');
      expect(first).toHaveLength(before + 1);
      expect(first.at(-1)).toMatchObject({
        jobId: expect.any(String),
        paperId: paper.id,
        percent: null,
        appendLog: false,
      });
      expect(first.at(-1)!.line).toContain('正在解析 PDF 并准备翻译…');
      expect(first.at(-1)!.line).toContain('已用时');
      expect(service.getState()?.logs).toEqual([]);

      // The engine stays silent; the next heartbeat after the 10-second
      // threshold must reach the log panel instead of only the headline.
      await vi.advanceTimersByTimeAsync(9_000);

      const later = eventsOf<TranslationProgressEvent>('translation:progress');
      expect(later.at(-1)).toMatchObject({ appendLog: true });
      expect(later.at(-1)!.line).toContain('正在解析 PDF 并准备翻译…');
      expect(service.getState()?.logs).toEqual([later.at(-1)!.line]);
    } finally {
      gate.resolve(ok({ canceled: true }));
      await service.waitForIdle();
      vi.useRealTimers();
    }
  });

  it('心跳报告 BabelDOC 当前阶段和阶段进度', async () => {
    const { paper } = await library.importPaper(SAMPLE_TEXT_PDF);
    const gate = deferred<ToolRunResult>();
    const armed = deferred<ToolRunOptions>();
    const runner = makeFakeRunner(async (options) => {
      armed.resolve(options);
      return gate.promise;
    });
    const service = makeService({}, runner);

    vi.useFakeTimers();
    try {
      await service.start(paper.id);
      const options = await armed.promise;
      options.onLine?.('Typesetting output', 80);

      await vi.advanceTimersByTimeAsync(3_000);

      const progress = eventsOf<TranslationProgressEvent>('translation:progress');
      expect(progress.at(-1)!.line).toContain('正在按原文版式排版：80%');
      expect(progress.at(-1)!.line).toContain('已用时');
    } finally {
      gate.resolve(ok({ canceled: true }));
      await service.waitForIdle();
      vi.useRealTimers();
    }
  });

  it('空闲前 getState 返回运行中的任务快照，空闲后返回 null', async () => {
    const { paper } = await library.importPaper(SAMPLE_TEXT_PDF);
    const gate = deferred<ToolRunResult>();
    const service = makeService({}, makeFakeRunner(() => gate.promise));

    const started = await service.start(paper.id);
    try {
      expect(service.getState()).toMatchObject({
        jobId: started.jobId,
        paperId: paper.id,
        title: paper.title,
        status: 'running',
        percent: null,
        line: '',
        logs: [],
        error: null,
      });
    } finally {
      gate.resolve(ok({ canceled: true }));
      await service.waitForIdle();
    }
    expect(service.getState()).toBeNull();
  });

  it('进度行中的 API Key 会从事件和任务日志中脱敏', async () => {
    const { paper } = await library.importPaper(SAMPLE_TEXT_PDF);
    const gate = deferred<ToolRunResult>();
    const runner = makeFakeRunner((options) => {
      // The real runner already redacts; also feed the raw secret so the
      // service's own redaction is exercised.
      options.onLine?.('request with sk-secret failed', null);
      return gate.promise;
    });
    const service = makeService({}, runner);

    await service.start(paper.id);
    await vi.waitFor(() => {
      expect(service.getState()?.logs.join('\n')).toContain('[REDACTED]');
    });
    const runningSnapshot = service.getState()!;
    expect(runningSnapshot.line).toContain('[REDACTED]');
    expect(runningSnapshot.line).not.toContain('sk-secret');

    gate.resolve(ok({ canceled: true }));
    await service.waitForIdle();

    const progress = eventsOf<TranslationProgressEvent>('translation:progress');
    expect(progress).toHaveLength(1);
    expect(progress[0].line).toContain('[REDACTED]');
    expect(JSON.stringify(events)).not.toContain('sk-secret');
  });
});
