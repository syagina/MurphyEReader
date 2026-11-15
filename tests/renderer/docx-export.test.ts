import { describe, expect, it, vi } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { buildNotesDocx } from '@renderer/lib/docx-export';

// 1×1 transparent PNG. The builder only needs a decodable data URI.
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function readZip(bytes: Uint8Array): Record<string, string> {
  const entries = unzipSync(bytes);
  return Object.fromEntries(
    Object.entries(entries).map(([name, data]) => [name, strFromU8(data)]),
  );
}

const SAMPLE = `# 论文笔记

**文献：**《测试论文》
正文包含行内公式 $a^2+b^2=c^2$ 和 **粗体**。

$$
\\int_0^1 x^2\\,dx
$$

- 第一项
- 第二项

\`\`\`ts
const a = 1;
\`\`\`
`;

describe('buildNotesDocx', () => {
  it('builds an A4 Word document with Chinese fonts, footers, and formula images', async () => {
    const renderFormula = vi.fn(async () => ({
      dataUrl: PNG,
      width: 120,
      height: 30,
    }));

    const bytes = await buildNotesDocx(SAMPLE, '论文笔记', { renderFormula });
    const files = readZip(bytes);
    const documentXml = files['word/document.xml'] ?? '';
    const stylesXml = files['word/styles.xml'] ?? '';

    expect(bytes.byteLength).toBeGreaterThan(1000);
    expect(documentXml).toContain('论文笔记');
    expect(documentXml).toContain('测试论文');
    expect(documentXml).toContain('第一项');
    expect(documentXml).toContain('const a = 1;');
    expect(documentXml).toContain('<w:drawing>');
    expect(stylesXml).toContain('Microsoft YaHei');
    expect(documentXml).toContain('Consolas');
    expect(Object.keys(files).some((name) => name.startsWith('word/media/'))).toBe(true);
    expect(Object.keys(files).some((name) => /^word\/footer\d*\.xml$/.test(name))).toBe(true);

    const footerName = Object.keys(files).find((name) => /^word\/footer\d*\.xml$/.test(name));
    const footerXml = footerName === undefined ? '' : (files[footerName] ?? '');
    expect(footerXml).toContain('PAGE');
    expect(footerXml).toContain('NUMPAGES');

    expect(renderFormula).toHaveBeenCalledTimes(2);
    expect(renderFormula.mock.calls[0]?.[0]).toBe('a^2+b^2=c^2');
    expect(renderFormula.mock.calls[0]?.[1]).toBe(false);
    expect(renderFormula.mock.calls[1]?.[1]).toBe(true);
  });

  it('falls back to literal TeX when a formula cannot be rendered', async () => {
    const renderFormula = vi.fn(async () => null);

    const bytes = await buildNotesDocx('# 标题\n\n公式 $x+1$', '标题', { renderFormula });
    const files = readZip(bytes);
    const documentXml = files['word/document.xml'] ?? '';

    expect(documentXml).toContain('$x+1$');
    expect(documentXml).not.toContain('<w:drawing>');
    expect(Object.keys(files).some((name) => name.startsWith('word/media/'))).toBe(false);
  });

  it('renders identical formulas only once', async () => {
    const renderFormula = vi.fn(async () => ({
      dataUrl: PNG,
      width: 100,
      height: 20,
    }));

    await buildNotesDocx('$x$ 和 $x$，再 $y$', '标题', { renderFormula });

    expect(renderFormula).toHaveBeenCalledTimes(2);
    expect(renderFormula.mock.calls.map((call) => call[0])).toEqual(['x', 'y']);
  });

  it('uses a default title for blank titles', async () => {
    const bytes = await buildNotesDocx('正文', '   ', { renderFormula: async () => null });
    const files = readZip(bytes);

    expect(files['docProps/core.xml']).toContain('PaperLens 笔记');
  });
});
