import type { Paragraph as DocxParagraph, ParagraphChild } from 'docx';
import type { MarkdownBlock, MarkdownInline } from './markdown';
import { parseMarkdown } from './markdown';
import { loadKatexFonts, nextFrame } from './katex-fonts';

export interface RenderedFormula {
  dataUrl: string;
  width: number;
  height: number;
}

export type FormulaRenderer = (
  latex: string,
  display: boolean,
) => Promise<RenderedFormula | null>;

export interface DocxExportOptions {
  /** Tests inject this; production uses an offscreen KaTeX DOM node. */
  renderFormula?: FormulaRenderer;
}

type DocxModule = typeof import('docx');

const BODY_FONT = {
  ascii: 'Microsoft YaHei',
  hAnsi: 'Microsoft YaHei',
  eastAsia: 'Microsoft YaHei',
  cs: 'Microsoft YaHei',
} as const;

const CODE_FONT = {
  ascii: 'Consolas',
  hAnsi: 'Consolas',
  eastAsia: 'Microsoft YaHei',
  cs: 'Consolas',
} as const;

const INLINE_MATH_MAX_WIDTH = 560;
const INLINE_MATH_MAX_HEIGHT = 48;
const DISPLAY_MATH_MAX_WIDTH = 620;
const DISPLAY_MATH_MAX_HEIGHT = 360;

function scaledSize(
  formula: RenderedFormula,
  maxWidth: number,
  maxHeight: number,
): { width: number; height: number } {
  const width = Math.max(1, formula.width);
  const height = Math.max(1, formula.height);
  const scale = Math.min(1, maxWidth / width, maxHeight / height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function headingLevel(
  docx: DocxModule,
  level: number,
): (typeof docx.HeadingLevel)[keyof typeof docx.HeadingLevel] {
  const levels = [
    docx.HeadingLevel.HEADING_1,
    docx.HeadingLevel.HEADING_2,
    docx.HeadingLevel.HEADING_3,
    docx.HeadingLevel.HEADING_4,
    docx.HeadingLevel.HEADING_5,
    docx.HeadingLevel.HEADING_6,
  ];
  return levels[Math.min(Math.max(level, 1), 6) - 1] ?? docx.HeadingLevel.HEADING_6;
}

function literalMath(text: string, display: boolean): string {
  return display ? `$$\n${text}\n$$` : `$${text}$`;
}

/**
 * Renders one formula to an offscreen DOM node, waits for KaTeX fonts, and
 * snapshots the node as a 2× PNG. The result is embedded into Word because
 * `.docx` has no simple lossless representation of arbitrary LaTeX.
 */
async function renderFormulaToPng(
  latex: string,
  display: boolean,
): Promise<RenderedFormula | null> {
  const source = latex.trim();
  if (source === '' || typeof document === 'undefined') {
    return null;
  }

  const [{ toPng }, katexModule] = await Promise.all([
    import('html-to-image'),
    import('katex'),
  ]);
  const katex = katexModule.default;
  const stage = document.createElement('div');
  stage.setAttribute('aria-hidden', 'true');
  stage.style.position = 'fixed';
  stage.style.left = '-10000px';
  stage.style.top = '0';
  stage.style.zIndex = '-1';
  stage.style.display = 'inline-block';
  stage.style.maxWidth = '1400px';
  stage.style.background = '#ffffff';
  stage.style.color = '#111827';
  stage.style.fontSize = '20px';
  stage.style.lineHeight = '1.2';

  const target = document.createElement(display ? 'div' : 'span');
  target.style.display = 'inline-block';
  target.style.maxWidth = '1400px';
  target.style.padding = '4px 6px';
  target.style.background = '#ffffff';
  target.style.whiteSpace = 'nowrap';
  target.style.fontFamily = "'KaTeX_Main', 'Times New Roman', serif";
  stage.appendChild(target);
  document.body.appendChild(stage);

  try {
    katex.render(source, target, {
      displayMode: display,
      throwOnError: false,
      trust: false,
      strict: 'ignore',
      output: 'html',
    });
    await nextFrame();
    await loadKatexFonts();
    await nextFrame();
    const rect = target.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) {
      return null;
    }
    const dataUrl = await toPng(target, {
      pixelRatio: 2,
      backgroundColor: '#ffffff',
      cacheBust: false,
    });
    return {
      dataUrl,
      width: rect.width,
      height: rect.height,
    };
  } catch {
    // A broken formula or a failed snapshot degrades to literal LaTeX instead
    // of aborting the whole document export.
    return null;
  } finally {
    stage.remove();
  }
}

async function inlineRuns(
  docx: DocxModule,
  nodes: MarkdownInline[],
  bold: boolean,
  getFormula: (latex: string, display: boolean) => Promise<RenderedFormula | null>,
): Promise<ParagraphChild[]> {
  const runs: ParagraphChild[] = [];
  for (const node of nodes) {
    switch (node.type) {
      case 'text':
        if (node.text !== '') {
          runs.push(
            new docx.TextRun({
              text: node.text,
              ...(bold ? { bold: true } : {}),
            }),
          );
        }
        break;
      case 'code':
        runs.push(
          new docx.TextRun({
            text: node.text.replace(/\r?\n/g, ' '),
            font: CODE_FONT,
            size: 20,
            shading: { type: docx.ShadingType.CLEAR, color: 'auto', fill: 'F1F3F5' },
            ...(bold ? { bold: true } : {}),
          }),
        );
        break;
      case 'bold':
        runs.push(...(await inlineRuns(docx, node.children, true, getFormula)));
        break;
      case 'break':
        runs.push(new docx.TextRun({ break: 1 }));
        break;
      case 'math': {
        const formula = await getFormula(node.text, node.display);
        if (formula === null) {
          runs.push(
            new docx.TextRun({
              text: literalMath(node.text, node.display),
              ...(bold ? { bold: true } : {}),
            }),
          );
        } else {
          const size = scaledSize(
            formula,
            node.display ? DISPLAY_MATH_MAX_WIDTH : INLINE_MATH_MAX_WIDTH,
            node.display ? DISPLAY_MATH_MAX_HEIGHT : INLINE_MATH_MAX_HEIGHT,
          );
          runs.push(
            new docx.ImageRun({
              type: 'png',
              data: formula.dataUrl,
              transformation: size,
              altText: { title: '公式', description: node.text },
            }),
          );
        }
        break;
      }
    }
  }
  return runs;
}

async function blockParagraphs(
  docx: DocxModule,
  block: MarkdownBlock,
  getFormula: (latex: string, display: boolean) => Promise<RenderedFormula | null>,
): Promise<DocxParagraph[]> {
  switch (block.type) {
    case 'paragraph':
      return [
        new docx.Paragraph({
          children: await inlineRuns(docx, block.children, false, getFormula),
        }),
      ];
    case 'heading':
      return [
        new docx.Paragraph({
          heading: headingLevel(docx, block.level),
          children: await inlineRuns(docx, block.children, false, getFormula),
        }),
      ];
    case 'codeBlock': {
      const lines = block.text.replace(/\r\n?/g, '\n').split('\n');
      const codeRuns: ParagraphChild[] = [];
      lines.forEach((line, index) => {
        if (index > 0) {
          codeRuns.push(new docx.TextRun({ break: 1 }));
        }
        codeRuns.push(
          new docx.TextRun({
            text: line === '' ? ' ' : line,
            font: CODE_FONT,
            size: 18,
          }),
        );
      });
      return [
        new docx.Paragraph({
          shading: { type: docx.ShadingType.CLEAR, color: 'auto', fill: 'F3F4F6' },
          indent: { left: 160, right: 160 },
          spacing: { before: 80, after: 140, line: 276 },
          children: codeRuns,
        }),
      ];
    }
    case 'mathBlock': {
      const formula = await getFormula(block.text, true);
      if (formula === null) {
        return [
          new docx.Paragraph({
            alignment: docx.AlignmentType.CENTER,
            children: [new docx.TextRun({ text: literalMath(block.text, true) })],
          }),
        ];
      }
      return [
        new docx.Paragraph({
          alignment: docx.AlignmentType.CENTER,
          spacing: { before: 100, after: 140 },
          children: [
            new docx.ImageRun({
              type: 'png',
              data: formula.dataUrl,
              transformation: scaledSize(
                formula,
                DISPLAY_MATH_MAX_WIDTH,
                DISPLAY_MATH_MAX_HEIGHT,
              ),
              altText: { title: '公式', description: block.text },
            }),
          ],
        }),
      ];
    }
    case 'list': {
      const paragraphs: DocxParagraph[] = [];
      for (const [index, item] of block.items.entries()) {
        const prefix = block.ordered ? `${index + 1}. ` : '• ';
        paragraphs.push(
          new docx.Paragraph({
            children: [
              new docx.TextRun({ text: prefix }),
              ...(await inlineRuns(docx, item, false, getFormula)),
            ],
            indent: { left: 360, hanging: 180 },
            spacing: { after: 60, line: 320 },
          }),
        );
      }
      return paragraphs;
    }
  }
}

/**
 * Builds a Word document from the same Markdown subset the reader renders.
 * Text uses Microsoft YaHei, code uses Consolas, and formulas are embedded as
 * PNG images (or literal TeX when a formula cannot be rendered). A footer
 * carries page numbers.
 */
export async function buildNotesDocx(
  markdown: string,
  title: string,
  options: DocxExportOptions = {},
): Promise<Uint8Array> {
  const docx = await import('docx');
  const renderFormula = options.renderFormula ?? renderFormulaToPng;
  const formulaCache = new Map<string, Promise<RenderedFormula | null>>();

  const getFormula = (latex: string, display: boolean): Promise<RenderedFormula | null> => {
    const key = `${display ? 'd' : 'i'}:${latex}`;
    const cached = formulaCache.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const rendered = renderFormula(latex, display).catch(() => null);
    formulaCache.set(key, rendered);
    return rendered;
  };

  const children: DocxParagraph[] = [];
  for (const block of parseMarkdown(markdown)) {
    children.push(...(await blockParagraphs(docx, block, getFormula)));
  }

  const documentTitle = title.trim() === '' ? 'MurphyEReader 笔记' : title;
  const doc = new docx.Document({
    title: documentTitle,
    creator: 'MurphyEReader',
    lastModifiedBy: 'MurphyEReader',
    description: '由 MurphyEReader 导出的文献笔记',
    features: { updateFields: true },
    styles: {
      default: {
        document: {
          run: { font: BODY_FONT, size: 22, color: '1F2329' },
          paragraph: { spacing: { line: 340, after: 120 } },
        },
        title: {
          run: { font: BODY_FONT, size: 40, bold: true, color: '111827' },
          paragraph: { spacing: { before: 0, after: 260 }, keepNext: true },
        },
        heading1: {
          run: { font: BODY_FONT, size: 36, bold: true, color: '111827' },
          paragraph: { spacing: { before: 0, after: 220 }, keepNext: true },
        },
        heading2: {
          run: { font: BODY_FONT, size: 28, bold: true, color: '1F2937' },
          paragraph: { spacing: { before: 300, after: 140 }, keepNext: true },
        },
        heading3: {
          run: { font: BODY_FONT, size: 24, bold: true, color: '1F2937' },
          paragraph: { spacing: { before: 220, after: 100 }, keepNext: true },
        },
        heading4: {
          run: { font: BODY_FONT, size: 22, bold: true, color: '1F2937' },
          paragraph: { spacing: { before: 180, after: 80 }, keepNext: true },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            size: {
              width: docx.convertMillimetersToTwip(210),
              height: docx.convertMillimetersToTwip(297),
            },
            margin: {
              top: docx.convertMillimetersToTwip(20),
              right: docx.convertMillimetersToTwip(20),
              bottom: docx.convertMillimetersToTwip(20),
              left: docx.convertMillimetersToTwip(20),
              footer: docx.convertMillimetersToTwip(10),
            },
          },
        },
        footers: {
          default: new docx.Footer({
            children: [
              new docx.Paragraph({
                alignment: docx.AlignmentType.CENTER,
                children: [
                  new docx.TextRun({
                    children: [
                      docx.PageNumber.CURRENT,
                      ' / ',
                      docx.PageNumber.TOTAL_PAGES,
                    ],
                    font: BODY_FONT,
                    size: 18,
                    color: '6B7280',
                  }),
                ],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });

  const blob = await docx.Packer.toBlob(doc);
  return new Uint8Array(await blob.arrayBuffer());
}
