import { createHash } from 'node:crypto';
import { degrees } from 'pdf-lib';
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFString,
} from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import type {
  AnnotationDrawing,
  AnnotationShapeData,
  StickyNote,
  StickyNoteAnchor,
} from '@shared/types';
import {
  assertNotManagedPdfTarget,
  buildAnnotatedPdf,
  markdownToPlainText,
  samePath,
} from '@main/export/sticky-notes-pdf';

interface ReadBorderStyle {
  w: number | null;
  s: string;
  d: number[];
}

interface ReadAnnotation {
  subtype: string;
  contents: string;
  rect: number[];
  quadPoints: number[];
  inkList: number[][];
  line: number[];
  lineEndings: string[];
  name: string;
  open: boolean;
  color: number[];
  ca: number | null;
  nm: string;
  bs: ReadBorderStyle | null;
}

function readNumberArray(value: unknown): number[] {
  return value instanceof PDFArray
    ? value
        .asArray()
        .map((entry) => (entry instanceof PDFNumber ? entry.asNumber() : NaN))
    : [];
}

function annotationAt(
  pdf: PDFDocument,
  pageIndex: number,
  annotationIndex = 0,
): ReadAnnotation {
  const annots = pdf.getPage(pageIndex).node.Annots();
  if (annots === undefined) {
    throw new Error(`page ${pageIndex} has no annotations`);
  }
  const dict = pdf.context.lookup(annots.get(annotationIndex));
  if (!(dict instanceof PDFDict)) {
    throw new Error(`annotation ${annotationIndex} is not a dictionary`);
  }
  const subtype = dict.get(PDFName.of('Subtype'));
  const contents = dict.get(PDFName.of('Contents'));
  const rect = dict.get(PDFName.of('Rect'));
  const quadPoints = dict.get(PDFName.of('QuadPoints'));
  const name = dict.get(PDFName.of('Name'));
  const open = dict.get(PDFName.of('Open'));
  const color = dict.get(PDFName.of('C'));
  const ca = dict.get(PDFName.of('CA'));
  const nm = dict.get(PDFName.of('NM'));
  const inkListRaw = dict.get(PDFName.of('InkList'));
  const lineRaw = dict.get(PDFName.of('L'));
  const lineEndingsRaw = dict.get(PDFName.of('LE'));
  const inkList =
    inkListRaw instanceof PDFArray
      ? inkListRaw.asArray().map((entry) => {
          const stroke = entry instanceof PDFArray ? entry : pdf.context.lookup(entry);
          return readNumberArray(stroke);
        })
      : [];
  const lineEndings =
    lineEndingsRaw instanceof PDFArray
      ? lineEndingsRaw.asArray().map((entry) => {
          const nameEntry =
            entry instanceof PDFName ? entry : pdf.context.lookup(entry);
          return nameEntry instanceof PDFName ? nameEntry.asString().slice(1) : '';
        })
      : [];
  const bsRaw = dict.get(PDFName.of('BS'));
  const bs = bsRaw === undefined ? undefined : pdf.context.lookup(bsRaw);
  const bsDict = bs instanceof PDFDict ? bs : null;
  const bsWidth = bsDict?.get(PDFName.of('W'));
  const bsStyle = bsDict?.get(PDFName.of('S'));
  const bsDash = bsDict?.get(PDFName.of('D'));
  return {
    subtype: subtype instanceof PDFName ? subtype.asString().slice(1) : '',
    contents: contents instanceof PDFHexString ? contents.decodeText() : '',
    rect:
      rect instanceof PDFArray
        ? rect.asArray().map((value) => (value instanceof PDFNumber ? value.asNumber() : NaN))
        : [],
    quadPoints:
      quadPoints instanceof PDFArray
        ? quadPoints
            .asArray()
            .map((value) => (value instanceof PDFNumber ? value.asNumber() : NaN))
        : [],
    name: name instanceof PDFName ? name.asString().slice(1) : '',
    open: open instanceof PDFNumber ? open.asNumber() !== 0 : false,
    color:
      color instanceof PDFArray
        ? color
            .asArray()
            .map((value) => (value instanceof PDFNumber ? value.asNumber() : NaN))
        : [],
    ca: ca instanceof PDFNumber ? ca.asNumber() : null,
    nm: nm instanceof PDFString ? nm.decodeText() : '',
    bs:
      bsDict === null
        ? null
        : {
            w: bsWidth instanceof PDFNumber ? bsWidth.asNumber() : null,
            s: bsStyle instanceof PDFName ? bsStyle.asString() : '',
            d:
              bsDash instanceof PDFArray
                ? bsDash
                    .asArray()
                    .map((value) =>
                      value instanceof PDFNumber ? value.asNumber() : NaN,
                    )
                : [],
          },
    inkList,
    line: readNumberArray(lineRaw),
    lineEndings,
  };
}

async function makePdf(
  pageSizes: Array<[number, number]> = [
    [600, 800],
    [300, 400],
  ],
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  for (const [width, height] of pageSizes) {
    pdf.addPage([width, height]);
  }
  return pdf.save();
}

async function makePdfWithRotation(angle: number): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.addPage([600, 800]).setRotation(degrees(angle));
  return pdf.save();
}

function expectNumbersClose(
  actual: number[],
  expected: number[],
  precision = 10,
): void {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((value, index) => {
    expect(value).toBeCloseTo(expected[index] ?? Number.NaN, precision);
  });
}

function note(overrides: Partial<StickyNote> = {}): StickyNote {
  return {
    id: 1,
    paperId: 1,
    pdfVersion: 'original',
    pageNo: 1,
    quote: '选中的句子',
    contentMd: '**重点** 内容',
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
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function pageAnchor(): StickyNoteAnchor {
  return { kind: 'page' };
}

function emptyTextAnchor(): StickyNoteAnchor {
  return { kind: 'text', rects: [] };
}

function inkDrawing(): AnnotationDrawing {
  return {
    tool: 'pen',
    color: '#111111',
    width: 2,
    opacity: 1,
    points: [
      [0.1, 0.1],
      [0.2, 0.2],
    ],
  };
}

function shapeDrawing(): AnnotationDrawing {
  return {
    shape: 'line',
    color: '#111111',
    width: 2,
    opacity: 1,
    start: [0.1, 0.1],
    end: [0.2, 0.2],
  };
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

describe('buildAnnotatedPdf', () => {
  it('writes a Highlight annotation for a text note', async () => {
    const source = await makePdf();
    const result = await buildAnnotatedPdf(source, [note()]);

    expect(result.exported).toBe(1);
    expect(result.skipped).toBe(0);

    const output = await PDFDocument.load(result.bytes);
    const annotation = annotationAt(output, 0);
    expect(annotation.subtype).toBe('Highlight');
    expect(annotation.rect).toEqual([60, 560, 240, 640]);
    expect(annotation.quadPoints).toEqual([60, 640, 240, 640, 60, 560, 240, 560]);
    expect(annotation.quadPoints).toHaveLength(8);
    expect(annotation.nm).toBe('paperlens-annotation-1');
    expect(annotation.ca).toBeCloseTo(0.35);
    expect(annotation.color).toHaveLength(3);
    expect(annotation.color[0]).toBeCloseTo(250 / 255, 5);
    expect(annotation.color[1]).toBeCloseTo(204 / 255, 5);
    expect(annotation.color[2]).toBeCloseTo(21 / 255, 5);
    for (let index = 0; index < annotation.quadPoints.length; index += 2) {
      const x = annotation.quadPoints[index];
      const y = annotation.quadPoints[index + 1];
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(600);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(800);
    }
  });

  it('高亮写颜色、透明度和标准 NM', async () => {
    const result = await buildAnnotatedPdf(await makePdf(), [
      note({ kind: 'mark', contentMd: '', color: '#4ade80' }),
    ]);
    const a = annotationAt(await PDFDocument.load(result.bytes), 0);
    expect(a.subtype).toBe('Highlight');
    expect(a.ca).toBeCloseTo(0.35);
    expect(a.nm).toBe('paperlens-annotation-1');
    expect(a.contents).toBe('');
    expect(a.color[1]).toBeCloseTo(0.87, 1);
  });

  it('writes one quad per selected rectangle', async () => {
    const source = await makePdf();
    const result = await buildAnnotatedPdf(source, [
      note({
        anchor: {
          kind: 'text',
          rects: [
            { x: 0.1, y: 0.1, width: 0.2, height: 0.05 },
            { x: 0.1, y: 0.2, width: 0.25, height: 0.05 },
          ],
        },
      }),
    ]);

    const output = await PDFDocument.load(result.bytes);
    expect(annotationAt(output, 0).quadPoints).toHaveLength(16);
  });

  it.each([
    ['underline', 'Underline', false],
    ['dotted-underline', 'Underline', true],
    ['wavy-underline', 'Squiggly', false],
    ['strikeout', 'StrikeOut', false],
  ] as const)(
    '%s 导出为 %s（/BS 存在：%s）',
    async (markStyle, subtype, hasBs) => {
      const result = await buildAnnotatedPdf(await makePdf(), [
        note({ kind: 'mark', contentMd: '', markStyle }),
      ]);
      const output = await PDFDocument.load(result.bytes);
      const a = annotationAt(output, 0);
      expect(a.subtype).toBe(subtype);
      expect(a.contents).toBe('');
      expect(a.bs !== null).toBe(hasBs);
    },
  );

  it('虚线下划线 /BS 使用标准虚线边框', async () => {
    const result = await buildAnnotatedPdf(await makePdf(), [
      note({ kind: 'mark', contentMd: '', markStyle: 'dotted-underline' }),
    ]);
    const a = annotationAt(await PDFDocument.load(result.bytes), 0);
    expect(a.subtype).toBe('Underline');
    expect(a.bs).not.toBeNull();
    expect(a.bs?.w).toBe(1);
    expect(a.bs?.s).toBe('/D');
    expect(a.bs?.d).toEqual([2, 2]);
  });

  it('underline 与 strikeout 使用默认标记色', async () => {
    const result = await buildAnnotatedPdf(await makePdf(), [
      note({ kind: 'mark', contentMd: '', markStyle: 'underline' }),
    ]);
    const a = annotationAt(await PDFDocument.load(result.bytes), 0);
    expect(a.color[0]).toBeCloseTo(239 / 255, 5);
    expect(a.color[1]).toBeCloseTo(68 / 255, 5);
    expect(a.color[2]).toBeCloseTo(68 / 255, 5);
  });

  it('双下划线便签写两条 Underline，内容只在 -a', async () => {
    const result = await buildAnnotatedPdf(await makePdf(), [
      note({ kind: 'note', contentMd: '便签内容', markStyle: 'double-underline' }),
    ]);
    expect(result.exported).toBe(1);
    const pdf = await PDFDocument.load(result.bytes);
    const a = annotationAt(pdf, 0, 0);
    const b = annotationAt(pdf, 0, 1);
    expect(a.subtype).toBe('Underline');
    expect(b.subtype).toBe('Underline');
    expect(a.nm).toBe('paperlens-annotation-1-a');
    expect(b.nm).toBe('paperlens-annotation-1-b');
    expect(a.contents).not.toBe('');
    expect(b.contents).toBe('');
    expect(a.rect).not.toEqual(b.rect);
  });

  it('双下划线 -b 只把显示底边上移 2 个 PDF 点', async () => {
    const result = await buildAnnotatedPdf(await makePdf(), [
      note({ kind: 'note', contentMd: '便签内容', markStyle: 'double-underline' }),
    ]);
    const pdf = await PDFDocument.load(result.bytes);
    const a = annotationAt(pdf, 0, 0);
    const b = annotationAt(pdf, 0, 1);
    expect(b.rect[0]).toBeCloseTo(a.rect[0] ?? Number.NaN, 10);
    expect(b.rect[1]).toBeCloseTo((a.rect[1] ?? Number.NaN) + 2, 10);
    expect(b.rect[2]).toBeCloseTo(a.rect[2] ?? Number.NaN, 10);
    expect(b.rect[3]).toBeCloseTo(a.rect[3] ?? Number.NaN, 10);
  });

  it('双下划线纯标记两条都不写内容', async () => {
    const result = await buildAnnotatedPdf(await makePdf(), [
      note({ kind: 'mark', contentMd: '', markStyle: 'double-underline' }),
    ]);
    expect(result.exported).toBe(1);
    const pdf = await PDFDocument.load(result.bytes);
    expect(annotationAt(pdf, 0, 0).contents).toBe('');
    expect(annotationAt(pdf, 0, 1).contents).toBe('');
    expect(annotationAt(pdf, 0, 1).subtype).toBe('Underline');
  });

  it('有标记的便签把内容写在标记批注上且不额外写 Text', async () => {
    const result = await buildAnnotatedPdf(await makePdf(), [note()]);
    const pdf = await PDFDocument.load(result.bytes);
    expect(pdf.getPage(0).node.Annots()?.size()).toBe(1);
    const a = annotationAt(pdf, 0);
    expect(a.subtype).toBe('Highlight');
    expect(a.contents).toContain('【原文】');
    expect(a.contents).toContain('选中的句子');
    expect(a.contents).toContain('【标注】');
    expect(a.contents).toContain('重点 内容');
  });

  it('writes a Text (page pin) annotation for a page note', async () => {
    const source = await makePdf();
    const result = await buildAnnotatedPdf(source, [
      note({ anchor: pageAnchor(), markStyle: 'none' }),
    ]);

    const output = await PDFDocument.load(result.bytes);
    const annotation = annotationAt(output, 0);
    expect(annotation.subtype).toBe('Text');
    expect(annotation.name).toBe('Comment');
    expect(annotation.open).toBe(false);
    expect(annotation.rect).toEqual([566, 766, 586, 786]);
  });

  it('页锚便签即使 markStyle 为 highlight 也只写 Text 批注', async () => {
    // Defensive: export must not rely only on the DB read-boundary
    // normalization of legacy v3 page notes.
    const result = await buildAnnotatedPdf(await makePdf(), [
      note({
        anchor: pageAnchor(),
        kind: 'note',
        markStyle: 'highlight',
        contentMd: '遗留整页内容',
      }),
    ]);

    expect(result.exported).toBe(1);
    expect(result.skipped).toBe(0);
    const output = await PDFDocument.load(result.bytes);
    expect(output.getPage(0).node.Annots()?.size()).toBe(1);
    const annotation = annotationAt(output, 0);
    expect(annotation.subtype).toBe('Text');
    expect(annotation.contents).toContain('遗留整页内容');
  });

  it('stacks multiple page pins downward on the same page', async () => {
    const source = await makePdf();
    const result = await buildAnnotatedPdf(source, [
      note({ id: 1, anchor: pageAnchor(), markStyle: 'none' }),
      note({ id: 2, anchor: pageAnchor(), markStyle: 'none' }),
    ]);

    const output = await PDFDocument.load(result.bytes);
    expect(annotationAt(output, 0, 0).rect).toEqual([566, 766, 586, 786]);
    expect(annotationAt(output, 0, 1).rect).toEqual([566, 742, 586, 762]);
  });

  it('页边堆叠序号按全部整页便签排序，可见图标也占位', async () => {
    const result = await buildAnnotatedPdf(await makePdf(), [
      note({
        id: 1,
        anchor: pageAnchor(),
        markStyle: 'none',
        pin: { x: 0.5, y: 0.5, visible: true },
        createdAt: 1,
      }),
      note({
        id: 2,
        anchor: pageAnchor(),
        markStyle: 'none',
        pin: null,
        createdAt: 1,
      }),
    ]);
    const output = await PDFDocument.load(result.bytes);
    // id 1 用可见图标并占第 0 格；id 2 无图标，默认堆叠落到第 1 格。
    expect(annotationAt(output, 0, 0).subtype).toBe('Text');
    expect(annotationAt(output, 0, 1).subtype).toBe('Text');
    expectNumbersClose(annotationAt(output, 0, 1).rect, [566, 742, 586, 762]);
  });

  it('无标记便签写 Text 并保留内容', async () => {
    const result = await buildAnnotatedPdf(await makePdf(), [
      note({ markStyle: 'none' }),
    ]);
    const a = annotationAt(await PDFDocument.load(result.bytes), 0);
    expect(a.subtype).toBe('Text');
    expect(a.name).toBe('Comment');
    expect(a.contents).toContain('【原文】');
    expect(a.contents).toContain('【标注】');
    // 文字矩形中心 (0.25, 0.25) → PDF (150, 600)
    expect(a.rect).toEqual([140, 590, 160, 610]);
  });

  it('无标记隐藏图标的便签仍在锚点写 Text', async () => {
    const result = await buildAnnotatedPdf(await makePdf(), [
      note({
        markStyle: 'none',
        pin: { x: 0.8, y: 0.8, visible: false },
      }),
    ]);
    const a = annotationAt(await PDFDocument.load(result.bytes), 0);
    expect(a.subtype).toBe('Text');
    expect(a.rect).toEqual([140, 590, 160, 610]);
  });

  it('可见图标优先：文字便签写图标中心', async () => {
    const result = await buildAnnotatedPdf(await makePdf(), [
      note({
        markStyle: 'none',
        pin: { x: 0.2, y: 0.3, visible: true },
      }),
    ]);
    const a = annotationAt(await PDFDocument.load(result.bytes), 0);
    expect(a.subtype).toBe('Text');
    expectNumbersClose(a.rect, [120, 540, 140, 560]);
  });

  it('可见图标优先：整页便签也写图标中心', async () => {
    const result = await buildAnnotatedPdf(await makePdf(), [
      note({
        anchor: pageAnchor(),
        markStyle: 'none',
        pin: { x: 0.25, y: 0.25, visible: true },
      }),
    ]);
    const a = annotationAt(await PDFDocument.load(result.bytes), 0);
    expect(a.subtype).toBe('Text');
    // 图标中心 (0.25+10/600, 0.25+10/800) → PDF (160, 590)
    expectNumbersClose(a.rect, [150, 580, 170, 600]);
  });

  it('可见图标在页边时夹在页面内', async () => {
    const result = await buildAnnotatedPdf(await makePdf(), [
      note({
        anchor: pageAnchor(),
        markStyle: 'none',
        pin: { x: 1, y: 0, visible: true },
      }),
    ]);
    const a = annotationAt(await PDFDocument.load(result.bytes), 0);
    expect(a.subtype).toBe('Text');
    // 图标左上角夹到 (580,0)，中心 (590,10) → PDF (590,790)
    expectNumbersClose(a.rect, [580, 780, 600, 800]);
  });

  it('旋转 90° 的可见图标按显示宽高定位', async () => {
    const source = await makePdfWithRotation(90);
    const result = await buildAnnotatedPdf(source, [
      note({
        markStyle: 'none',
        pin: { x: 0.2, y: 0.3, visible: true },
      }),
    ]);
    const a = annotationAt(await PDFDocument.load(result.bytes), 0);
    // 显示宽高 800×600：nx=0.2+10/800=0.2125，ny=0.3+10/600
    // 90° → x = ny·600 ≈ 190，y = nx·800 = 170
    expectNumbersClose(a.rect, [180, 160, 200, 180]);
  });

  it('maps coordinates through a non-zero CropBox', async () => {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([600, 800]);
    page.setCropBox(50, 60, 400, 500);
    const source = await pdf.save();

    const result = await buildAnnotatedPdf(source, [note()]);
    const output = await PDFDocument.load(result.bytes);
    const annotation = annotationAt(output, 0);
    expect(annotation.rect).toEqual([90, 410, 210, 460]);
    expect(annotation.quadPoints).toEqual([90, 460, 210, 460, 90, 410, 210, 410]);
  });

  it('decodes Chinese annotation contents', async () => {
    const source = await makePdf();
    const result = await buildAnnotatedPdf(source, [
      note({ quote: '中文原文', contentMd: '**便签**内容' }),
    ]);

    const output = await PDFDocument.load(result.bytes);
    const { contents } = annotationAt(output, 0);
    expect(contents).toContain('【原文】');
    expect(contents).toContain('中文原文');
    expect(contents).toContain('【标注】');
    expect(contents).toContain('便签内容');
    expect(contents).not.toContain('**');
  });

  it('counts out-of-range notes as skipped and keeps valid ones', async () => {
    const source = await makePdf();
    const result = await buildAnnotatedPdf(source, [
      note({ id: 1, pageNo: 1 }),
      note({ id: 2, pageNo: 99 }),
    ]);

    expect(result.exported).toBe(1);
    expect(result.skipped).toBe(1);
    const output = await PDFDocument.load(result.bytes);
    expect(annotationAt(output, 0).subtype).toBe('Highlight');
  });

  it('drawing 为 null 的 ink/shape 计入 skipped 且不影响其他标注', async () => {
    const source = await makePdf();
    const result = await buildAnnotatedPdf(source, [
      note({ id: 1 }),
      note({
        id: 2,
        kind: 'ink',
        contentMd: '',
        markStyle: 'none',
        anchor: pageAnchor(),
        drawing: null,
      }),
      note({
        id: 3,
        kind: 'shape',
        contentMd: '',
        markStyle: 'none',
        anchor: pageAnchor(),
        drawing: null,
      }),
    ]);

    expect(result.exported).toBe(1);
    expect(result.skipped).toBe(2);
  });

  it('自由笔导出 InkList 和 PDF 坐标', async () => {
    const result = await buildAnnotatedPdf(await makePdf(), [
      note({
        kind: 'ink', quote: '', contentMd: '', markStyle: 'none', color: null,
        anchor: { kind: 'page' },
        drawing: { tool: 'pen', color: '#111827', width: 2, opacity: 1,
          points: [[0.1, 0.1], [0.5, 0.5]] },
      }),
    ]);
    const a = annotationAt(await PDFDocument.load(result.bytes), 0);
    expect(a.subtype).toBe('Ink');
    expect(a.inkList).toEqual([[60, 80, 300, 400]]);
  });

  it('荧光笔带 CA 0.35，普通笔不带', async () => {
    const highlighter = annotationAt(
      await PDFDocument.load((await buildAnnotatedPdf(await makePdf(), [
        note({ kind: 'ink', quote: '', contentMd: '', markStyle: 'none', color: null,
          anchor: { kind: 'page' },
          drawing: { tool: 'highlighter', color: '#facc15', width: 12, opacity: 0.35,
            points: [[0.1, 0.1], [0.2, 0.2]] } }),
      ])).bytes), 0);
    expect(highlighter.ca).toBeCloseTo(0.35);
  });

  it('箭头导出 Line + OpenArrow 结尾', async () => {
    const a = annotationAt(await PDFDocument.load((await buildAnnotatedPdf(await makePdf(), [
      note({ kind: 'shape', quote: '', contentMd: '', markStyle: 'none', color: null,
        anchor: { kind: 'page' },
        drawing: { shape: 'arrow', color: '#ef4444', width: 2, opacity: 1,
          start: [0.1, 0.2], end: [0.5, 0.6] } }),
    ])).bytes), 0);
    expect(a.subtype).toBe('Line');
    expect(a.lineEndings).toEqual(['None', 'OpenArrow']);
  });

  it('普通笔不写 CA', async () => {
    const a = annotationAt(
      await PDFDocument.load(
        (await buildAnnotatedPdf(await makePdf(), [
          note({
            kind: 'ink',
            quote: '',
            contentMd: '',
            markStyle: 'none',
            color: null,
            anchor: { kind: 'page' },
            drawing: {
              tool: 'pen',
              color: '#111827',
              width: 2,
              opacity: 1,
              points: [[0.1, 0.1], [0.5, 0.5]],
            },
          }),
        ])).bytes,
      ),
      0,
    );
    expect(a.subtype).toBe('Ink');
    expect(a.ca).toBeNull();
  });

  it('笔迹导出绘制颜色、线宽和标准 NM', async () => {
    const a = annotationAt(
      await PDFDocument.load(
        (await buildAnnotatedPdf(await makePdf(), [
          note({
            id: 7,
            kind: 'ink',
            quote: '',
            contentMd: '',
            markStyle: 'none',
            color: null,
            anchor: { kind: 'page' },
            drawing: {
              tool: 'pen',
              color: '#3366cc',
              width: 4,
              opacity: 1,
              points: [[0.1, 0.1], [0.2, 0.2]],
            },
          }),
        ])).bytes,
      ),
      0,
    );
    expect(a.color).toHaveLength(3);
    expect(a.color[0]).toBeCloseTo(0x33 / 255, 5);
    expect(a.color[1]).toBeCloseTo(0x66 / 255, 5);
    expect(a.color[2]).toBeCloseTo(0xcc / 255, 5);
    expect(a.bs?.w).toBe(4);
    expect(a.nm).toBe('paperlens-annotation-7');
  });

  it('荧光笔线宽来自 drawing，颜色和 CA 正确', async () => {
    const a = annotationAt(
      await PDFDocument.load(
        (await buildAnnotatedPdf(await makePdf(), [
          note({
            kind: 'ink',
            quote: '',
            contentMd: '',
            markStyle: 'none',
            color: null,
            anchor: { kind: 'page' },
            drawing: {
              tool: 'highlighter',
              color: '#facc15',
              width: 12,
              opacity: 0.2,
              points: [[0.1, 0.1], [0.2, 0.2]],
            },
          }),
        ])).bytes,
      ),
      0,
    );
    expect(a.bs?.w).toBe(12);
    expect(a.ca).toBeCloseTo(0.35);
    expect(a.color[0]).toBeCloseTo(0xfa / 255, 5);
    expect(a.color[1]).toBeCloseTo(0xcc / 255, 5);
    expect(a.color[2]).toBeCloseTo(0x15 / 255, 5);
  });

  it('直线导出 /Line 与 /L 且无箭头结尾', async () => {
    const a = annotationAt(
      await PDFDocument.load(
        (await buildAnnotatedPdf(await makePdf(), [
          note({
            kind: 'shape',
            quote: '',
            contentMd: '',
            markStyle: 'none',
            color: null,
            anchor: { kind: 'page' },
            drawing: {
              shape: 'line',
              color: '#111827',
              width: 2,
              opacity: 1,
              start: [0.1, 0.2],
              end: [0.5, 0.6],
            },
          }),
        ])).bytes,
      ),
      0,
    );
    expect(a.subtype).toBe('Line');
    expect(a.line).toEqual([60, 160, 300, 480]);
    expect(a.lineEndings).toEqual([]);
    expect(a.rect).toEqual([60, 160, 300, 480]);
    expect(a.bs?.w).toBe(2);
  });

  it('箭头导出 /L、箭头线宽与 Rect', async () => {
    const a = annotationAt(
      await PDFDocument.load(
        (await buildAnnotatedPdf(await makePdf(), [
          note({
            kind: 'shape',
            quote: '',
            contentMd: '',
            markStyle: 'none',
            color: null,
            anchor: { kind: 'page' },
            drawing: {
              shape: 'arrow',
              color: '#ef4444',
              width: 5,
              opacity: 1,
              start: [0.1, 0.2],
              end: [0.5, 0.6],
            },
          }),
        ])).bytes,
      ),
      0,
    );
    expect(a.subtype).toBe('Line');
    expect(a.line).toEqual([60, 160, 300, 480]);
    expect(a.lineEndings).toEqual(['None', 'OpenArrow']);
    expect(a.bs?.w).toBe(5);
    expect(a.rect).toEqual([60, 160, 300, 480]);
  });

  it.each([
    ['rect', 'Square'],
    ['ellipse', 'Circle'],
  ] as const)(
    '%s 导出为 %s，Rect 取 start/end 的 min/max',
    async (shape, subtype) => {
      const drawing: AnnotationShapeData = {
        shape,
        color: '#3366cc',
        width: 3,
        opacity: 1,
        start: [0.5, 0.6],
        end: [0.1, 0.2],
      };
      const result = await buildAnnotatedPdf(await makePdf(), [
        note({
          id: 9,
          kind: 'shape',
          quote: '',
          contentMd: '不应导出',
          markStyle: 'none',
          color: null,
          anchor: { kind: 'page' },
          drawing,
        }),
      ]);
      const a = annotationAt(await PDFDocument.load(result.bytes), 0);
      expect(a.subtype).toBe(subtype);
      expect(a.rect).toEqual([60, 160, 300, 480]);
      expect(a.bs?.w).toBe(3);
      expect(a.ca).toBeNull();
      expect(a.color[0]).toBeCloseTo(0x33 / 255, 5);
      expect(a.color[1]).toBeCloseTo(0x66 / 255, 5);
      expect(a.color[2]).toBeCloseTo(0xcc / 255, 5);
      expect(a.nm).toBe('paperlens-annotation-9');
      expect(a.contents).toBe('');
    },
  );

  it('Ink Rect 取散点包围盒且 InkList 保持点序', async () => {
    const result = await buildAnnotatedPdf(await makePdf(), [
      note({
        kind: 'ink',
        quote: '',
        contentMd: '',
        markStyle: 'none',
        color: null,
        anchor: { kind: 'page' },
        drawing: {
          tool: 'pen',
          color: '#111827',
          width: 2,
          opacity: 1,
          points: [
            [0.5, 0.2],
            [0.1, 0.8],
            [0.3, 0.4],
          ],
        },
      }),
    ]);
    const a = annotationAt(await PDFDocument.load(result.bytes), 0);
    expect(a.inkList).toEqual([[300, 160, 60, 640, 180, 320]]);
    expect(a.rect).toEqual([60, 160, 300, 640]);
  });

  it('笔迹与形状不写 Contents', async () => {
    const result = await buildAnnotatedPdf(await makePdf(), [
      note({
        id: 1,
        kind: 'ink',
        quote: '原文',
        contentMd: '便签内容',
        markStyle: 'none',
        color: null,
        anchor: pageAnchor(),
        drawing: inkDrawing(),
      }),
      note({
        id: 2,
        kind: 'shape',
        quote: '原文',
        contentMd: '便签内容',
        markStyle: 'none',
        color: null,
        anchor: pageAnchor(),
        drawing: shapeDrawing(),
      }),
    ]);
    expect(result.exported).toBe(2);
    const pdf = await PDFDocument.load(result.bytes);
    expect(annotationAt(pdf, 0, 0).contents).toBe('');
    expect(annotationAt(pdf, 0, 1).contents).toBe('');
  });

  it('90° 旋转页上的笔迹坐标不做逆变换', async () => {
    const result = await buildAnnotatedPdf(await makePdfWithRotation(90), [
      note({
        kind: 'ink',
        quote: '',
        contentMd: '',
        markStyle: 'none',
        color: null,
        anchor: { kind: 'page' },
        drawing: {
          tool: 'pen',
          color: '#111827',
          width: 2,
          opacity: 1,
          points: [[0.1, 0.1], [0.5, 0.5]],
        },
      }),
    ]);
    const a = annotationAt(await PDFDocument.load(result.bytes), 0);
    expect(a.subtype).toBe('Ink');
    expect(a.inkList).toEqual([[60, 80, 300, 400]]);
    expect(a.rect).toEqual([60, 80, 300, 400]);
  });

  it('一个有效绘制与一个损坏绘制：exported 1，skipped 1', async () => {
    const result = await buildAnnotatedPdf(await makePdf(), [
      note({
        id: 1,
        kind: 'ink',
        quote: '',
        contentMd: '',
        markStyle: 'none',
        color: null,
        anchor: pageAnchor(),
        drawing: inkDrawing(),
      }),
      note({
        id: 2,
        kind: 'shape',
        quote: '',
        contentMd: '',
        markStyle: 'none',
        color: null,
        anchor: pageAnchor(),
        drawing: {
          shape: 'line',
          color: '#111111',
          width: 2,
          opacity: 1,
          start: [0.1, 0.1],
        } as unknown as AnnotationDrawing,
      }),
    ]);
    expect(result.exported).toBe(1);
    expect(result.skipped).toBe(1);
    const pdf = await PDFDocument.load(result.bytes);
    expect(pdf.getPage(0).node.Annots()?.size()).toBe(1);
    expect(annotationAt(pdf, 0).subtype).toBe('Ink');
  });

  it('ink 与 shape 的 drawing 类型不匹配时跳过', async () => {
    const result = await buildAnnotatedPdf(await makePdf(), [
      note({ id: 1 }),
      note({
        id: 2,
        kind: 'ink',
        quote: '',
        contentMd: '',
        markStyle: 'none',
        color: null,
        anchor: pageAnchor(),
        drawing: shapeDrawing(),
      }),
      note({
        id: 3,
        kind: 'shape',
        quote: '',
        contentMd: '',
        markStyle: 'none',
        color: null,
        anchor: pageAnchor(),
        drawing: inkDrawing(),
      }),
    ]);
    expect(result.exported).toBe(1);
    expect(result.skipped).toBe(2);
  });

  it('无文字矩形的标记与无位置的便签计为 skipped', async () => {
    const source = await makePdf();
    const result = await buildAnnotatedPdf(source, [
      note({ id: 1, anchor: emptyTextAnchor(), markStyle: 'highlight' }),
      note({ id: 2, anchor: emptyTextAnchor(), markStyle: 'none' }),
      note({ id: 3 }),
    ]);

    expect(result.exported).toBe(1);
    expect(result.skipped).toBe(2);
    const output = await PDFDocument.load(result.bytes);
    expect(annotationAt(output, 0).subtype).toBe('Highlight');
  });

  it('rejects when every note is unrenderable', async () => {
    const source = await makePdf();
    await expect(
      buildAnnotatedPdf(source, [note({ pageNo: 99 })]),
    ).rejects.toThrow('当前版本没有可导出的标注');
  });

  it('never mutates the source bytes', async () => {
    const source = await makePdf();
    const before = sha256(source);
    await buildAnnotatedPdf(source, [note()]);
    expect(sha256(source)).toBe(before);
  });

  it('truncates annotation contents longer than 10,000 characters', async () => {
    const source = await makePdf();
    const result = await buildAnnotatedPdf(source, [
      note({ contentMd: '长'.repeat(12_000) }),
    ]);

    const output = await PDFDocument.load(result.bytes);
    const { contents } = annotationAt(output, 0);
    expect(contents.endsWith('…（内容过长，已截断）')).toBe(true);
    expect(contents.length).toBeLessThanOrEqual(10_000 + '…（内容过长，已截断）'.length);
  });

  it.each([
    [0, [60, 640, 240, 640, 60, 560, 240, 560]],
    [90, [120, 80, 120, 320, 180, 80, 180, 320]],
    [180, [540, 160, 360, 160, 540, 240, 360, 240]],
    [270, [480, 720, 480, 480, 420, 720, 420, 480]],
  ] as const)('%i° 的文字标记按显示角映射', async (angle, expected) => {
    const source = await makePdfWithRotation(angle);
    const result = await buildAnnotatedPdf(source, [note()]);
    const a = annotationAt(await PDFDocument.load(result.bytes), 0);
    expect(a.subtype).toBe('Highlight');
    expectNumbersClose(a.quadPoints, [...expected]);
  });

  it('旋转 90° 的文字标记仍导出 Highlight 且坐标按显示角映射', async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage([600, 800]).setRotation(degrees(90));
    const source = await pdf.save();
    const result = await buildAnnotatedPdf(source, [note()]);
    const a = annotationAt(await PDFDocument.load(result.bytes), 0);
    expect(a.subtype).toBe('Highlight');
    const expected = [120, 80, 120, 320, 180, 80, 180, 320];
    expect(a.quadPoints).toHaveLength(expected.length);
    a.quadPoints.forEach((value, index) => {
      expect(value).toBeCloseTo(expected[index] ?? Number.NaN, 10);
    });
  });
});

describe('markdownToPlainText', () => {
  it('strips formatting markers but keeps readable content', () => {
    const plain = markdownToPlainText(
      [
        '# 标题',
        '',
        '**粗体** 和 `代码`',
        '',
        '- 列表项',
        '',
        '```js',
        'const x = 1;',
        '```',
        '',
        '$E=mc^2$ [p.3]',
      ].join('\n'),
    );

    expect(plain).toContain('标题');
    expect(plain).toContain('粗体 和 代码');
    expect(plain).toContain('列表项');
    expect(plain).toContain('const x = 1;');
    expect(plain).toContain('E=mc^2 [p.3]');
    expect(plain).not.toContain('#');
    expect(plain).not.toContain('**');
    expect(plain).not.toContain('```');
    expect(plain).not.toContain('$');
  });
});

describe('samePath', () => {
  it('ignores Windows case and separator differences', () => {
    expect(samePath('C:\\Papers\\A.PDF', 'c:/papers/a.pdf')).toBe(true);
    expect(samePath('C:\\Papers\\A.pdf', 'C:\\Papers\\B.pdf')).toBe(false);
  });
});

describe('assertNotManagedPdfTarget', () => {
  it('rejects overwriting any managed PDF path', () => {
    expect(() =>
      assertNotManagedPdfTarget('D:/Papers/a.pdf', [
        'D:\\Papers\\A.PDF',
        null,
        undefined,
      ]),
    ).toThrow('不能覆盖文献库中的 PDF，请选择其他文件名');
  });

  it('allows a target outside the library', () => {
    expect(() =>
      assertNotManagedPdfTarget('D:/Exports/a.pdf', [
        'D:\\Papers\\A.PDF',
        null,
      ]),
    ).not.toThrow();
  });
});
