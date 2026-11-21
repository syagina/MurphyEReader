// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import type {
  AnnotationDrawing,
  Paper,
  PdfVersion,
  StickyNote,
  StickyNoteExportResult,
} from '@shared/types';
import { StickyNotesPanel } from '@renderer/components/StickyNotesPanel';
import { useReaderStore } from '@renderer/stores/reader';
import { useStickyNotesStore } from '@renderer/stores/sticky-notes';

const { confirmMock } = vi.hoisted(() => ({ confirmMock: vi.fn() }));
vi.mock('@renderer/stores/confirm', () => ({ confirm: confirmMock }));

function paper(): Paper {
  return {
    id: 1,
    title: '标注测试论文',
    authors: '',
    year: null,
    filePathOriginal: 'C:/papers/paper.pdf',
    filePathTranslated: null,
    pageCountOriginal: 3,
    pageCountTranslated: null,
    pageCountBilingual: null,
    hasTextLayer: true,
    outline: [],
    tags: [],
    folderId: null,
    storageDir: null,
    fileHash: null,
    lastPageOriginal: 1,
    lastPageTranslated: 1,
    lastVersion: 'original',
    lastOffsetOriginal: 0,
    lastOffsetTranslated: 0,
    addedAt: 0,
    lastReadAt: null,
  };
}

const inkDrawing: AnnotationDrawing = {
  tool: 'pen',
  color: '#111827',
  width: 2,
  opacity: 1,
  points: [
    [0.1, 0.1],
    [0.2, 0.2],
  ],
};

const shapeDrawing: AnnotationDrawing = {
  shape: 'rect',
  color: '#ef4444',
  width: 2,
  opacity: 1,
  start: [0.1, 0.1],
  end: [0.2, 0.2],
};

function makeNote(
  id: number,
  overrides: Partial<StickyNote> = {},
): StickyNote {
  return {
    id,
    paperId: 1,
    pdfVersion: 'original',
    pageNo: 1,
    quote: `引用 ${id}`,
    contentMd: `内容 ${id}`,
    anchor: {
      kind: 'text',
      rects: [{ x: 0.1, y: 0.2, width: 0.3, height: 0.1 }],
    },
    source: 'manual',
    kind: 'note',
    markStyle: 'highlight',
    color: null,
    pin: null,
    popup: null,
    drawing: null,
    createdAt: 1_000 + id,
    updatedAt: 1_000 + id,
    ...overrides,
  };
}

function annotationNotes(): StickyNote[] {
  return [
    makeNote(1, { pageNo: 1 }),
    makeNote(2, { pageNo: 1, kind: 'mark', contentMd: '', markStyle: 'underline' }),
    makeNote(3, {
      pageNo: 2,
      kind: 'ink',
      quote: '',
      contentMd: '',
      markStyle: 'none',
      anchor: { kind: 'page' },
      drawing: inkDrawing,
    }),
    makeNote(4, {
      pageNo: 2,
      kind: 'shape',
      quote: '',
      contentMd: '',
      markStyle: 'none',
      anchor: { kind: 'page' },
      drawing: shapeDrawing,
    }),
  ];
}

interface StickyNotesApiMock {
  remove: ReturnType<typeof vi.fn>;
  exportPdf: ReturnType<typeof vi.fn>;
}

function installApi(): StickyNotesApiMock {
  const stickyNotes = {
    remove: vi.fn(async (_id: number): Promise<void> => undefined),
    exportPdf: vi.fn(
      async (
        _paperId: number,
        _version: PdfVersion,
      ): Promise<StickyNoteExportResult> => ({
        filePath: 'C:/out/annotations.pdf',
        exported: 4,
        skipped: 0,
      }),
    ),
  };
  (window as unknown as { api: unknown }).api = { stickyNotes };
  return stickyNotes;
}

let api: StickyNotesApiMock;

function renderPanel(notes: StickyNote[], pageCount = 3): void {
  useStickyNotesStore.setState({
    paperId: 1,
    version: 'original',
    notes,
    activeNoteId: null,
    loading: false,
    exporting: false,
    error: null,
    notice: null,
  });
  useReaderStore.setState({
    paperId: 1,
    version: 'original',
    pageCount,
    currentPage: 1,
  });
  render(<StickyNotesPanel paper={paper()} />);
}

beforeEach(() => {
  useStickyNotesStore.getState().reset();
  api = installApi();
  confirmMock.mockReset();
  confirmMock.mockResolvedValue(true);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  useStickyNotesStore.getState().reset();
});

describe('StickyNotesPanel 标注筛选与列表', () => {
  it('提供四个筛选按钮，选择绘制后按筛选结果计数', () => {
    renderPanel(annotationNotes());
    const group = screen.getByRole('group', { name: '标注筛选' });
    const buttons = within(group).getAllByRole('button');
    expect(buttons.map((button) => button.textContent)).toEqual([
      '全部',
      '便签',
      '标记',
      '绘制',
    ]);
    expect(screen.getByText('4 条标注')).toBeTruthy();
    expect(
      within(group)
        .getByRole('button', { name: '全部' })
        .getAttribute('aria-pressed'),
    ).toBe('true');

    fireEvent.click(within(group).getByRole('button', { name: '绘制' }));

    expect(screen.getByText('2 条标注')).toBeTruthy();
    expect(
      within(group)
        .getByRole('button', { name: '绘制' })
        .getAttribute('aria-pressed'),
    ).toBe('true');
    expect(
      within(group)
        .getByRole('button', { name: '全部' })
        .getAttribute('aria-pressed'),
    ).toBe('false');
  });

  it('筛选隐藏部分标注时导出仍提交全量标注', async () => {
    renderPanel(annotationNotes());
    fireEvent.click(screen.getByRole('button', { name: '便签' }));
    expect(screen.getByText('1 条标注')).toBeTruthy();

    const exportButton = screen.getByRole('button', { name: '导出带标注 PDF' });
    expect((exportButton as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(exportButton);

    expect(api.exportPdf).toHaveBeenCalledWith(1, 'original');
    await waitFor(() => {
      expect(screen.getByText(/已导出 4 条标注/)).toBeTruthy();
    });
  });

  it('导出提示把无法导出的条目标为已跳过，不再只归因于页码', async () => {
    api.exportPdf.mockResolvedValueOnce({
      filePath: 'C:/out/annotations.pdf',
      exported: 4,
      skipped: 2,
    });
    renderPanel(annotationNotes());
    fireEvent.click(screen.getByRole('button', { name: '导出带标注 PDF' }));

    await waitFor(() => {
      expect(
        screen.getByText('已导出 4 条标注，2 条无法导出，已跳过'),
      ).toBeTruthy();
    });
    expect(screen.queryByText(/页码超出当前文档已跳过/)).toBeNull();
  });

  it('点击绘制条目只跳页，不打开弹窗', () => {
    renderPanel(annotationNotes());
    const rowButton = screen.getByText('自由笔').closest('button');
    expect(rowButton).not.toBeNull();
    fireEvent.click(rowButton as HTMLButtonElement);

    expect(useReaderStore.getState().currentPage).toBe(2);
    expect(useStickyNotesStore.getState().activeNoteId).toBeNull();
  });

  it('绘制删除按钮独立于行按钮，确认后才删除', async () => {
    renderPanel(annotationNotes());
    const rowButton = screen.getByText('自由笔').closest('button');
    expect(rowButton).not.toBeNull();
    const listItem = (rowButton as HTMLButtonElement).parentElement;
    expect(listItem?.tagName).toBe('LI');

    const deleteButton = within(listItem as HTMLElement).getByRole('button', {
      name: '删除',
    });
    expect((rowButton as HTMLButtonElement).contains(deleteButton)).toBe(false);
    expect(deleteButton.parentElement).toBe(listItem);
    expect((rowButton as HTMLButtonElement).parentElement).toBe(listItem);

    fireEvent.click(deleteButton);
    expect(confirmMock).toHaveBeenCalledWith(
      expect.objectContaining({ message: '删除这条绘制标注？' }),
    );
    await waitFor(() => {
      expect(api.remove).toHaveBeenCalledWith(3);
    });

    api.remove.mockClear();
    confirmMock.mockResolvedValue(false);
    const shapeRow = screen.getByText('矩形').closest('button');
    const shapeDelete = within(shapeRow?.parentElement as HTMLElement).getByRole(
      'button',
      { name: '删除' },
    );
    fireEvent.click(shapeDelete);
    expect(api.remove).not.toHaveBeenCalled();
  });

  it('页码越界的条目不跳转也不打开弹窗', async () => {
    renderPanel(
      [
        makeNote(9, { pageNo: 5, quote: '越界引用' }),
        makeNote(10, {
          pageNo: 5,
          kind: 'ink',
          quote: '',
          contentMd: '',
          markStyle: 'none',
          anchor: { kind: 'page' },
          drawing: inkDrawing,
        }),
      ],
      3,
    );

    const rowButton = screen.getByText('越界引用').closest('button');
    expect(rowButton?.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getAllByText('页码超出当前文档')).toHaveLength(2);

    fireEvent.click(rowButton as HTMLButtonElement);
    expect(useReaderStore.getState().currentPage).toBe(1);
    expect(useStickyNotesStore.getState().activeNoteId).toBeNull();

    // 越界绘制仍允许删除。
    const drawingRow = screen.getByText('自由笔').closest('button');
    const deleteButton = within(
      drawingRow?.parentElement as HTMLElement,
    ).getByRole('button', { name: '删除' });
    fireEvent.click(deleteButton);
    await waitFor(() => {
      expect(api.remove).toHaveBeenCalledWith(10);
    });
  });
});
