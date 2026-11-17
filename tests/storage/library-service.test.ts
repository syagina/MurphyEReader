import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb } from '@main/db';
import { createNote, getNote } from '@main/db/notes';
import { createPaper, getPaper, listPapers, updatePaper } from '@main/db/papers';
import type { NewPaperInput } from '@main/db/papers';
import { getPages } from '@main/db/pages';
import { JobRegistry } from '@main/jobs/job-registry';
import { sha256File } from '@main/storage/hash';
import { PaperLibrary } from '@main/storage/library-service';
import type { PaperLibraryDeps } from '@main/storage/library-service';
import {
  CUSTOM_TRANSLATED_NAME,
  ORIGINAL_PDF_NAME,
  canonicalStorageDir,
  storageFile,
} from '@main/storage/paths';
import { generateFixtures, SAMPLE_SCANNED_PDF, SAMPLE_TEXT_PDF } from '../fixtures/generate';

const BUSY = '请先等待当前任务完成';
const TRANSLATING = '该文献正在翻译，暂不能删除、重新定位或绑定译本';
const INVALID_MANAGED = '文献文件夹路径异常，请重新定位或导入';

type LibraryOverrides = Pick<PaperLibraryDeps, 'trashItem' | 'copyFile' | 'sha256'>;

let tempDir: string;
let root: string;
let db: Database.Database;
let jobs: JobRegistry;

function makeInput(overrides: Partial<NewPaperInput> = {}): NewPaperInput {
  return {
    title: '外部文献',
    authors: '',
    year: null,
    filePathOriginal: join(tempDir, 'external.pdf'),
    filePathTranslated: null,
    pageCountOriginal: 1,
    pageCountTranslated: null,
    hasTextLayer: true,
    outline: [],
    folderId: null,
    storageDir: null,
    fileHash: null,
    ...overrides,
  };
}

function makeLibrary(overrides: Partial<LibraryOverrides> = {}): PaperLibrary {
  return new PaperLibrary({ db, jobs, getRoot: () => root, ...overrides });
}

beforeAll(async () => {
  await generateFixtures();
});

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'paperlens-library-'));
  root = join(tempDir, 'library');
  db = openDb(':memory:');
  jobs = new JobRegistry();
});

afterEach(() => {
  db.close();
  rmSync(tempDir, { recursive: true, force: true });
});

describe('PaperLibrary.importPaper', () => {
  it('复制原文进入规范文件夹并按哈希去重', async () => {
    const library = makeLibrary();

    const first = await library.importPaper(SAMPLE_TEXT_PDF);

    expect(first.duplicate).toBe(false);
    expect(first.paper.storageDir).toBe(
      canonicalStorageDir(first.paper.id, first.paper.title),
    );
    expect(first.paper.filePathOriginal).toBe(
      storageFile(root, first.paper.storageDir!, ORIGINAL_PDF_NAME),
    );
    expect(first.paper.filePathOriginal).not.toBe(SAMPLE_TEXT_PDF);
    expect(first.paper.fileHash).toMatch(/^[0-9a-f]{64}$/);
    expect(existsSync(SAMPLE_TEXT_PDF)).toBe(true);
    expect(getPages(db, first.paper.id)).toHaveLength(2);
    expect(readFileSync(first.paper.filePathOriginal).equals(readFileSync(SAMPLE_TEXT_PDF))).toBe(
      true,
    );

    const second = await library.importPaper(SAMPLE_TEXT_PDF);
    expect(second).toMatchObject({ duplicate: true, paper: { id: first.paper.id } });
    expect(listPapers(db)).toHaveLength(1);
  });

  it('原文文件丢失后重新导入会恢复原记录并保留笔记', async () => {
    const library = makeLibrary();
    const imported = await library.importPaper(SAMPLE_TEXT_PDF);
    const note = createNote(db, {
      paperId: imported.paper.id,
      type: 'manual',
      title: '我的笔记',
      contentMd: '这篇文献的笔记必须保留。',
      tags: [],
    });
    updatePaper(db, imported.paper.id, { tags: ['重点'] });
    const folder = join(root, imported.paper.storageDir!);
    rmSync(folder, { recursive: true, force: true });

    const restored = await library.importPaper(SAMPLE_TEXT_PDF);

    expect(restored).toMatchObject({
      duplicate: true,
      restored: true,
      paper: {
        id: imported.paper.id,
        storageDir: imported.paper.storageDir,
        title: imported.paper.title,
      },
    });
    expect(restored.paper.tags).toEqual(['重点']);
    expect(existsSync(restored.paper.filePathOriginal)).toBe(true);
    expect(existsSync(join(folder, 'notes'))).toBe(true);
    expect(getPages(db, imported.paper.id)).toHaveLength(2);
    expect(listPapers(db)).toHaveLength(1);
    expect(getNote(db, note.id)?.title).toBe('我的笔记');
  });

  it('恢复时解除已缺失的译本绑定', async () => {
    const library = makeLibrary();
    const imported = await library.importPaper(SAMPLE_TEXT_PDF);
    await library.attachTranslated(imported.paper.id, SAMPLE_SCANNED_PDF);
    const bound = getPaper(db, imported.paper.id)!;
    expect(bound.filePathTranslated).not.toBeNull();
    rmSync(join(root, bound.storageDir!), { recursive: true, force: true });

    const restored = await library.importPaper(SAMPLE_TEXT_PDF);

    expect(restored.restored).toBe(true);
    expect(restored.paper.filePathTranslated).toBeNull();
    expect(restored.paper.pageCountTranslated).toBeNull();
    expect(restored.paper.lastPageTranslated).toBe(1);
    expect(getPages(db, imported.paper.id)).toHaveLength(2);
  });

  it('未托管旧记录的文件被删后按哈希恢复为托管文献', async () => {
    const hash = await sha256File(SAMPLE_TEXT_PDF);
    const paper = createPaper(
      db,
      makeInput({
        title: '旧记录',
        filePathOriginal: join(tempDir, 'deleted.pdf'),
        fileHash: hash,
      }),
    );
    const library = makeLibrary();

    const restored = await library.importPaper(SAMPLE_TEXT_PDF);

    expect(restored).toMatchObject({
      duplicate: true,
      restored: true,
      paper: {
        id: paper.id,
        storageDir: canonicalStorageDir(paper.id, '旧记录'),
      },
    });
    expect(restored.paper.filePathOriginal).toBe(
      storageFile(root, restored.paper.storageDir!, ORIGINAL_PDF_NAME),
    );
    expect(existsSync(restored.paper.filePathOriginal)).toBe(true);
    expect(getPages(db, paper.id)).toHaveLength(2);
    expect(listPapers(db)).toHaveLength(1);
  });

  it('原文仍在的重复导入不进入恢复流程', async () => {
    const first = await makeLibrary().importPaper(SAMPLE_TEXT_PDF);
    const copyFile = vi.fn(async (): Promise<void> => {
      throw new Error('不应复制');
    });

    const second = await makeLibrary({ copyFile }).importPaper(SAMPLE_TEXT_PDF);

    expect(second).toMatchObject({ duplicate: true, paper: { id: first.paper.id } });
    expect(second.restored).toBeUndefined();
    expect(copyFile).not.toHaveBeenCalled();
  });

  it('规范文件夹里只有 original.pdf 与空的 notes/', async () => {
    const library = makeLibrary();
    const imported = await library.importPaper(SAMPLE_TEXT_PDF);

    const folder = join(root, imported.paper.storageDir!);
    expect(readdirSync(folder).sort()).toEqual(['notes', 'original.pdf']);
    expect(readdirSync(join(folder, 'notes'))).toEqual([]);
  });

  it('扫描版 PDF 导入后 hasTextLayer 为 false', async () => {
    const library = makeLibrary();

    const imported = await library.importPaper(SAMPLE_SCANNED_PDF);

    expect(imported.paper.hasTextLayer).toBe(false);
    expect(imported.paper.pageCountOriginal).toBe(1);
    expect(getPages(db, imported.paper.id)).toHaveLength(1);
  });

  it('库根目录是文件时报文献库目录不可写且不写行', async () => {
    const badRoot = join(tempDir, 'library-file');
    writeFileSync(badRoot, 'not a directory');
    const library = new PaperLibrary({ db, jobs, getRoot: () => badRoot });

    await expect(library.importPaper(SAMPLE_TEXT_PDF)).rejects.toThrow('文献库目录不可写：');

    expect(listPapers(db)).toHaveLength(0);
  });

  it('复制失败时删除刚插入的行与新文件夹', async () => {
    const library = makeLibrary({
      copyFile: async () => {
        throw new Error('磁盘已满');
      },
    });

    await expect(library.importPaper(SAMPLE_TEXT_PDF)).rejects.toThrow(
      '复制文献文件失败：磁盘已满',
    );

    expect(listPapers(db)).toHaveLength(0);
    expect(existsSync(join(root, 'papers'))).toBe(true);
    expect(readdirSync(join(root, 'papers'))).toEqual([]);
  });

  it('哈希失败时仍导入，fileHash 为空并跳过去重', async () => {
    const library = makeLibrary({
      sha256: async () => {
        throw new Error('无法计算哈希');
      },
    });

    const first = await library.importPaper(SAMPLE_TEXT_PDF);
    expect(first.paper.fileHash).toBeNull();

    const second = await library.importPaper(SAMPLE_TEXT_PDF);
    expect(second.duplicate).toBe(false);
    expect(second.paper.id).not.toBe(first.paper.id);
    expect(listPapers(db)).toHaveLength(2);
  });

  it('存储任务被占用时导入报忙且不写行', async () => {
    jobs.tryAcquireStorage('remove');

    await expect(makeLibrary().importPaper(SAMPLE_TEXT_PDF)).rejects.toThrow(BUSY);
    jobs.releaseStorage();

    expect(listPapers(db)).toHaveLength(0);
  });

  it('编辑标题后不改文件夹，绑定与删除仍识别旧规范文件夹', async () => {
    const trashItem = vi.fn(async (_target: string): Promise<void> => undefined);
    const library = makeLibrary({ trashItem });
    const imported = await library.importPaper(SAMPLE_TEXT_PDF);
    const storageDir = imported.paper.storageDir!;
    const folder = join(root, storageDir);

    updatePaper(db, imported.paper.id, { title: '完全不同的新标题' });

    expect(getPaper(db, imported.paper.id)?.storageDir).toBe(storageDir);
    expect(existsSync(folder)).toBe(true);

    const attached = await library.attachTranslated(imported.paper.id, SAMPLE_SCANNED_PDF);
    expect(attached.filePathTranslated).toBe(join(folder, CUSTOM_TRANSLATED_NAME));
    expect(existsSync(join(folder, CUSTOM_TRANSLATED_NAME))).toBe(true);

    await library.removePaper(imported.paper.id);

    expect(trashItem).toHaveBeenCalledWith(folder);
    expect(getPaper(db, imported.paper.id)).toBeNull();
  });
});

describe('PaperLibrary.attachTranslated', () => {
  it('已托管文献把译本复制为 translated.custom.pdf', async () => {
    const library = makeLibrary();
    const imported = await library.importPaper(SAMPLE_TEXT_PDF);
    const pagesBefore = getPages(db, imported.paper.id);

    const attached = await library.attachTranslated(imported.paper.id, SAMPLE_SCANNED_PDF);

    expect(attached.filePathTranslated).toBe(
      storageFile(root, attached.storageDir!, CUSTOM_TRANSLATED_NAME),
    );
    expect(attached.pageCountTranslated).toBe(1);
    expect(attached.filePathOriginal).toBe(imported.paper.filePathOriginal);
    expect(existsSync(attached.filePathTranslated!)).toBe(true);
    expect(existsSync(SAMPLE_SCANNED_PDF)).toBe(true);
    expect(getPages(db, imported.paper.id)).toEqual(pagesBefore);
    expect(attached.hasTextLayer).toBe(imported.paper.hasTextLayer);
    expect(attached.pageCountOriginal).toBe(imported.paper.pageCountOriginal);
  });

  it('未托管且绑定译本缺失时，绑定新译本会收养文献并替换译本', async () => {
    const external = join(tempDir, 'legacy.pdf');
    copyFileSync(SAMPLE_TEXT_PDF, external);
    const paper = createPaper(
      db,
      makeInput({
        title: '缺译本',
        filePathOriginal: external,
        filePathTranslated: join(tempDir, 'gone-zh.pdf'),
      }),
    );
    const library = makeLibrary();

    const attached = await library.attachTranslated(paper.id, SAMPLE_SCANNED_PDF);

    expect(attached.storageDir).toBe(canonicalStorageDir(paper.id, '缺译本'));
    expect(attached.filePathOriginal).toBe(
      storageFile(root, attached.storageDir!, ORIGINAL_PDF_NAME),
    );
    const managedTranslation = storageFile(
      root,
      attached.storageDir!,
      CUSTOM_TRANSLATED_NAME,
    );
    expect(attached.filePathTranslated).toBe(managedTranslation);
    expect(existsSync(managedTranslation)).toBe(true);
    expect(readFileSync(managedTranslation).equals(readFileSync(SAMPLE_SCANNED_PDF))).toBe(true);
    expect(existsSync(external)).toBe(true);
  });

  it('源文件已是目标译本文件时不自我复制', async () => {
    const importer = makeLibrary();
    const imported = await importer.importPaper(SAMPLE_TEXT_PDF);
    const attached = await importer.attachTranslated(imported.paper.id, SAMPLE_SCANNED_PDF);

    const copyFile = vi.fn(async (): Promise<void> => {
      throw new Error('不应复制');
    });
    const library = makeLibrary({ copyFile });

    const again = await library.attachTranslated(imported.paper.id, attached.filePathTranslated!);

    expect(copyFile).not.toHaveBeenCalled();
    expect(again.filePathTranslated).toBe(attached.filePathTranslated);
  });

  it('未托管且原文存在时先收养再复制译本', async () => {
    const external = join(tempDir, 'legacy.pdf');
    copyFileSync(SAMPLE_TEXT_PDF, external);
    const paper = createPaper(db, makeInput({ title: '旧文献', filePathOriginal: external }));
    const library = makeLibrary();

    const attached = await library.attachTranslated(paper.id, SAMPLE_SCANNED_PDF);

    expect(attached.storageDir).toBe(canonicalStorageDir(paper.id, '旧文献'));
    expect(attached.filePathOriginal).toBe(
      storageFile(root, attached.storageDir!, ORIGINAL_PDF_NAME),
    );
    expect(attached.filePathTranslated).toBe(
      storageFile(root, attached.storageDir!, CUSTOM_TRANSLATED_NAME),
    );
    expect(existsSync(external)).toBe(true);
    expect(existsSync(attached.filePathTranslated!)).toBe(true);
  });

  it('未托管且原文缺失时保持外部译本路径与 storageDir 为空', async () => {
    const externalTranslation = join(tempDir, 'translated.pdf');
    copyFileSync(SAMPLE_SCANNED_PDF, externalTranslation);
    const paper = createPaper(
      db,
      makeInput({ filePathOriginal: join(tempDir, 'missing.pdf') }),
    );
    const library = makeLibrary();

    const attached = await library.attachTranslated(paper.id, externalTranslation);

    expect(attached.storageDir).toBeNull();
    expect(attached.filePathTranslated).toBe(externalTranslation);
    expect(attached.pageCountTranslated).toBe(1);
    expect(getPaper(db, paper.id)?.storageDir).toBeNull();
  });

  it('无效的托管 storage_dir 拒绝绑定', async () => {
    const paper = createPaper(
      db,
      makeInput({ filePathOriginal: SAMPLE_TEXT_PDF, storageDir: 'papers/Shared (999)' }),
    );
    const library = makeLibrary();

    await expect(
      library.attachTranslated(paper.id, SAMPLE_SCANNED_PDF),
    ).rejects.toThrow(INVALID_MANAGED);

    expect(jobs.getState().storageTask).toBeNull();
  });

  it('翻译中的文献绑定报翻译消息，其他翻译占用时报忙', async () => {
    const library = makeLibrary();
    const target = await library.importPaper(SAMPLE_TEXT_PDF);
    const other = await library.importPaper(SAMPLE_SCANNED_PDF);

    jobs.tryAcquireTranslation(target.paper.id, 'job-1');
    await expect(
      library.attachTranslated(target.paper.id, SAMPLE_SCANNED_PDF),
    ).rejects.toThrow(TRANSLATING);
    jobs.releaseTranslation('job-1');

    jobs.tryAcquireTranslation(other.paper.id, 'job-2');
    await expect(
      library.attachTranslated(target.paper.id, SAMPLE_SCANNED_PDF),
    ).rejects.toThrow(BUSY);
    jobs.releaseTranslation('job-2');

    expect(jobs.getState().storageTask).toBeNull();
  });
});

describe('PaperLibrary.relocate', () => {
  it('重新定位原文会复制进托管文件夹并更新哈希与页记录', async () => {
    const library = makeLibrary();
    const imported = await library.importPaper(SAMPLE_SCANNED_PDF);
    const target = storageFile(root, imported.paper.storageDir!, ORIGINAL_PDF_NAME);

    const relocated = await library.relocate(imported.paper.id, 'original', SAMPLE_TEXT_PDF);

    expect(relocated.filePathOriginal).toBe(target);
    expect(relocated.pageCountOriginal).toBe(2);
    expect(relocated.fileHash).toMatch(/^[0-9a-f]{64}$/);
    expect(readFileSync(target).equals(readFileSync(SAMPLE_TEXT_PDF))).toBe(true);
    expect(getPages(db, imported.paper.id)).toHaveLength(2);
    expect(existsSync(SAMPLE_TEXT_PDF)).toBe(true);
  });

  it('重新定位译本会复制为 translated.custom.pdf', async () => {
    const library = makeLibrary();
    const imported = await library.importPaper(SAMPLE_TEXT_PDF);

    const relocated = await library.relocate(imported.paper.id, 'translated', SAMPLE_SCANNED_PDF);

    expect(relocated.filePathTranslated).toBe(
      storageFile(root, relocated.storageDir!, CUSTOM_TRANSLATED_NAME),
    );
    expect(relocated.pageCountTranslated).toBe(1);
    expect(existsSync(relocated.filePathTranslated!)).toBe(true);
  });

  it('重新定位到当前托管原文路径时不自我复制', async () => {
    const importer = makeLibrary();
    const imported = await importer.importPaper(SAMPLE_TEXT_PDF);

    const copyFile = vi.fn(async (): Promise<void> => {
      throw new Error('不应复制');
    });
    const library = makeLibrary({ copyFile });

    const relocated = await library.relocate(
      imported.paper.id,
      'original',
      imported.paper.filePathOriginal,
    );

    expect(copyFile).not.toHaveBeenCalled();
    expect(relocated.filePathOriginal).toBe(imported.paper.filePathOriginal);
  });

  it('重新定位到当前托管译本路径时不自我复制', async () => {
    const importer = makeLibrary();
    const imported = await importer.importPaper(SAMPLE_TEXT_PDF);
    const attached = await importer.attachTranslated(imported.paper.id, SAMPLE_SCANNED_PDF);

    const copyFile = vi.fn(async (): Promise<void> => {
      throw new Error('不应复制');
    });
    const library = makeLibrary({ copyFile });

    const relocated = await library.relocate(
      imported.paper.id,
      'translated',
      attached.filePathTranslated!,
    );

    expect(copyFile).not.toHaveBeenCalled();
    expect(relocated.filePathTranslated).toBe(attached.filePathTranslated);
  });

  it('重新定位到与其他文献相同哈希的文件时报重复', async () => {
    const library = makeLibrary();
    const first = await library.importPaper(SAMPLE_TEXT_PDF);
    const second = await library.importPaper(SAMPLE_SCANNED_PDF);

    await expect(
      library.relocate(second.paper.id, 'original', SAMPLE_TEXT_PDF),
    ).rejects.toThrow('与已有文献重复');

    const stillThere = getPaper(db, second.paper.id);
    expect(stillThere?.filePathOriginal).toBe(second.paper.filePathOriginal);
    expect(existsSync(second.paper.filePathOriginal)).toBe(true);
    expect(first.paper.id).not.toBe(second.paper.id);
  });

  it('未托管文献的原位重定位保持外部路径', async () => {
    const external = join(tempDir, 'legacy.pdf');
    copyFileSync(SAMPLE_SCANNED_PDF, external);
    const paper = createPaper(db, makeInput({ filePathOriginal: external }));
    const library = makeLibrary();

    const relocated = await library.relocate(paper.id, 'original', SAMPLE_TEXT_PDF);

    expect(relocated.storageDir).toBeNull();
    expect(relocated.filePathOriginal).toBe(SAMPLE_TEXT_PDF);
    expect(existsSync(join(root, 'papers'))).toBe(false);
  });

  it('无效的托管 storage_dir 拒绝重新定位', async () => {
    const paper = createPaper(
      db,
      makeInput({ filePathOriginal: SAMPLE_TEXT_PDF, storageDir: 'papers/Shared (999)' }),
    );
    const library = makeLibrary();

    await expect(
      library.relocate(paper.id, 'original', SAMPLE_SCANNED_PDF),
    ).rejects.toThrow(INVALID_MANAGED);
    expect(jobs.getState().storageTask).toBeNull();
  });

  it('翻译中的文献拒绝重新定位', async () => {
    const library = makeLibrary();
    const imported = await library.importPaper(SAMPLE_TEXT_PDF);

    jobs.tryAcquireTranslation(imported.paper.id, 'job-1');
    await expect(
      library.relocate(imported.paper.id, 'original', SAMPLE_SCANNED_PDF),
    ).rejects.toThrow(TRANSLATING);
    jobs.releaseTranslation('job-1');

    expect(jobs.getState().storageTask).toBeNull();
  });
});

describe('PaperLibrary.removePaper', () => {
  it('把规范文献文件夹移入回收站后再删行', async () => {
    const trashItem = vi.fn(async (_target: string): Promise<void> => undefined);
    const library = makeLibrary({ trashItem });
    const imported = await library.importPaper(SAMPLE_TEXT_PDF);

    await library.removePaper(imported.paper.id);

    expect(trashItem).toHaveBeenCalledWith(join(root, imported.paper.storageDir!));
    expect(getPaper(db, imported.paper.id)).toBeNull();
    expect(existsSync(join(root, imported.paper.storageDir!))).toBe(true);
  });

  it('回收站报 ENOENT 时视为已删除并继续删行', async () => {
    const trashItem = vi.fn(async (): Promise<void> => {
      throw Object.assign(new Error('文件已不存在'), { code: 'ENOENT' });
    });
    const library = makeLibrary({ trashItem });
    const imported = await library.importPaper(SAMPLE_TEXT_PDF);

    await library.removePaper(imported.paper.id);

    expect(trashItem).toHaveBeenCalled();
    expect(getPaper(db, imported.paper.id)).toBeNull();
  });

  it('其他回收站错误中止删除并保留行', async () => {
    const trashItem = vi.fn(async (): Promise<void> => {
      throw new Error('拒绝访问');
    });
    const library = makeLibrary({ trashItem });
    const imported = await library.importPaper(SAMPLE_TEXT_PDF);

    await expect(library.removePaper(imported.paper.id)).rejects.toThrow(
      '无法移入回收站：拒绝访问',
    );

    expect(getPaper(db, imported.paper.id)).not.toBeNull();
    expect(jobs.getState().storageTask).toBeNull();
  });

  it('未托管文献只删行，绝不调用回收站', async () => {
    const external = join(tempDir, 'external.pdf');
    copyFileSync(SAMPLE_TEXT_PDF, external);
    const paper = createPaper(db, makeInput({ filePathOriginal: external }));
    const trashItem = vi.fn(async (_target: string): Promise<void> => undefined);
    const library = makeLibrary({ trashItem });

    await library.removePaper(paper.id);

    expect(trashItem).not.toHaveBeenCalled();
    expect(getPaper(db, paper.id)).toBeNull();
    expect(existsSync(external)).toBe(true);
  });

  it('非规范 storage_dir 中止删除并保留行', async () => {
    const paper = createPaper(
      db,
      makeInput({ filePathOriginal: SAMPLE_TEXT_PDF, storageDir: 'papers/Shared (999)' }),
    );
    const trashItem = vi.fn(async (_target: string): Promise<void> => undefined);
    const library = makeLibrary({ trashItem });

    await expect(library.removePaper(paper.id)).rejects.toThrow(
      '文献文件夹路径异常，已中止删除',
    );

    expect(trashItem).not.toHaveBeenCalled();
    expect(getPaper(db, paper.id)).not.toBeNull();
    expect(jobs.getState().storageTask).toBeNull();
  });

  it('翻译中的文献拒绝删除', async () => {
    const library = makeLibrary();
    const imported = await library.importPaper(SAMPLE_TEXT_PDF);

    jobs.tryAcquireTranslation(imported.paper.id, 'job-1');
    await expect(library.removePaper(imported.paper.id)).rejects.toThrow(TRANSLATING);
    jobs.releaseTranslation('job-1');

    expect(jobs.getState().storageTask).toBeNull();
  });
});

describe('PaperLibrary.ensureManaged', () => {
  it('已托管且规范时直接返回且不占租约', async () => {
    const library = makeLibrary();
    const imported = await library.importPaper(SAMPLE_TEXT_PDF);

    const managed = await library.ensureManaged(imported.paper.id);

    expect(managed.storageDir).toBe(imported.paper.storageDir);
    expect(jobs.getState().storageTask).toBeNull();
  });

  it('托管的 storage_dir 不规范时报错且不占租约', async () => {
    const paper = createPaper(
      db,
      makeInput({ filePathOriginal: SAMPLE_TEXT_PDF, storageDir: 'papers/Shared (999)' }),
    );
    const library = makeLibrary();

    await expect(library.ensureManaged(paper.id)).rejects.toThrow(INVALID_MANAGED);
    expect(jobs.getState().storageTask).toBeNull();
  });

  it('未托管时收养并释放租约', async () => {
    const external = join(tempDir, 'legacy.pdf');
    copyFileSync(SAMPLE_TEXT_PDF, external);
    const paper = createPaper(db, makeInput({ title: '旧文献', filePathOriginal: external }));
    const library = makeLibrary();

    const adopted = await library.ensureManaged(paper.id);

    expect(adopted.storageDir).toBe(canonicalStorageDir(paper.id, '旧文献'));
    expect(existsSync(storageFile(root, adopted.storageDir!, ORIGINAL_PDF_NAME))).toBe(true);
    expect(jobs.getState().storageTask).toBeNull();
  });

  it('其他存储任务持锁时收养报忙，保持未托管且不建文件夹', async () => {
    const external = join(tempDir, 'legacy.pdf');
    copyFileSync(SAMPLE_TEXT_PDF, external);
    const paper = createPaper(db, makeInput({ filePathOriginal: external }));
    const library = makeLibrary();
    jobs.tryAcquireStorage('import');

    try {
      await expect(library.ensureManaged(paper.id)).rejects.toThrow(BUSY);
      expect(jobs.getState().storageTask).toBe('import');
      expect(getPaper(db, paper.id)?.storageDir).toBeNull();
      expect(existsSync(join(root, canonicalStorageDir(paper.id, paper.title)))).toBe(false);
    } finally {
      jobs.releaseStorage();
    }
  });

  it('已持有的 ensureManaged 租约不再放行重入，收养报忙', async () => {
    const external = join(tempDir, 'legacy.pdf');
    copyFileSync(SAMPLE_TEXT_PDF, external);
    const paper = createPaper(db, makeInput({ filePathOriginal: external }));
    const library = makeLibrary();
    jobs.tryAcquireStorage('ensureManaged');

    try {
      await expect(library.ensureManaged(paper.id)).rejects.toThrow(BUSY);
      expect(getPaper(db, paper.id)?.storageDir).toBeNull();
      expect(existsSync(join(root, canonicalStorageDir(paper.id, paper.title)))).toBe(false);
      expect(jobs.getState().storageTask).toBe('ensureManaged');
    } finally {
      jobs.releaseStorage();
    }
  });

  it('两个未托管文献并发收养时只有一个成功', async () => {
    const externalA = join(tempDir, 'legacy-a.pdf');
    const externalB = join(tempDir, 'legacy-b.pdf');
    copyFileSync(SAMPLE_TEXT_PDF, externalA);
    copyFileSync(SAMPLE_SCANNED_PDF, externalB);
    const paperA = createPaper(
      db,
      makeInput({ title: '外部文献甲', filePathOriginal: externalA }),
    );
    const paperB = createPaper(
      db,
      makeInput({ title: '外部文献乙', filePathOriginal: externalB }),
    );
    const library = makeLibrary();

    // The first call acquires the storage lease synchronously before its first
    // await, so the second call deterministically loses the race.
    const first = library.ensureManaged(paperA.id);
    const second = library.ensureManaged(paperB.id);
    const settled = await Promise.allSettled([first, second]);

    expect(settled.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = settled.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(Error);
    expect((rejected[0].reason as Error).message).toBe(BUSY);

    const papers = [paperA, paperB];
    const loser = papers.find((paper) => getPaper(db, paper.id)?.storageDir === null);
    expect(loser).toBeDefined();
    expect(existsSync(join(root, canonicalStorageDir(loser!.id, loser!.title)))).toBe(false);
    expect(jobs.getState().storageTask).toBeNull();
  });

  it('收养失败时释放 ensureManaged 租约', async () => {
    const paper = createPaper(db, makeInput({ filePathOriginal: join(tempDir, 'gone.pdf') }));
    const library = makeLibrary();

    await expect(library.ensureManaged(paper.id)).rejects.toThrow('原文文件不存在');

    expect(jobs.getState().storageTask).toBeNull();
    expect(getPaper(db, paper.id)?.storageDir).toBeNull();
  });
});
