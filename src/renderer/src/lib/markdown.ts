export type MarkdownInline =
  | { type: 'text'; text: string }
  | { type: 'code'; text: string }
  | { type: 'bold'; children: MarkdownInline[] }
  | { type: 'break' };

export type MarkdownBlock =
  | { type: 'paragraph'; children: MarkdownInline[] }
  | { type: 'heading'; level: number; children: MarkdownInline[] }
  | { type: 'codeBlock'; lang: string; text: string }
  | { type: 'list'; ordered: boolean; items: MarkdownInline[][] };

const HEADING_PATTERN = /^(#{1,6})\s+(.*)$/;
const UNORDERED_ITEM_PATTERN = /^\s{0,3}[-*+]\s+(.*)$/;
const ORDERED_ITEM_PATTERN = /^\s{0,3}\d+[.)]\s+(.*)$/;
const FENCE_OPEN_PATTERN = /^\s{0,3}(`{3,})([^`]*)$/;
const FENCE_CLOSE_PATTERN = /^\s{0,3}(`{3,})\s*$/;

/**
 * Minimal inline parser for `` `code` `` and `**bold**`. Any other syntax is
 * left untouched so unknown markup renders literally. Bold content is parsed
 * recursively, which is enough for nested inline code.
 */
export function parseInline(text: string): MarkdownInline[] {
  const nodes: MarkdownInline[] = [];
  let buffer = '';
  let index = 0;

  const flush = (): void => {
    if (buffer !== '') {
      nodes.push({ type: 'text', text: buffer });
      buffer = '';
    }
  };

  while (index < text.length) {
    if (text[index] === '`') {
      const end = text.indexOf('`', index + 1);
      if (end > index + 1) {
        flush();
        nodes.push({ type: 'code', text: text.slice(index + 1, end) });
        index = end + 1;
        continue;
      }
      // Unmatched or empty inline code stays literal.
      buffer += text.slice(index, end === -1 ? index + 1 : end + 1);
      index = end === -1 ? index + 1 : end + 1;
      continue;
    }
    if (text[index] === '*' && text[index + 1] === '*') {
      const end = text.indexOf('**', index + 2);
      if (end > index + 2) {
        flush();
        nodes.push({ type: 'bold', children: parseInline(text.slice(index + 2, end)) });
        index = end + 2;
        continue;
      }
      // Unmatched bold stays literal.
      buffer += '**';
      index += 2;
      continue;
    }
    buffer += text[index];
    index += 1;
  }
  flush();
  return nodes;
}

function isClosingFence(line: string, fenceLength: number): boolean {
  const match = FENCE_CLOSE_PATTERN.exec(line);
  return match !== null && match[1].length >= fenceLength;
}

function isBlockStart(line: string): boolean {
  return (
    FENCE_OPEN_PATTERN.test(line) ||
    HEADING_PATTERN.test(line) ||
    UNORDERED_ITEM_PATTERN.test(line) ||
    ORDERED_ITEM_PATTERN.test(line)
  );
}

function joinLines(lines: MarkdownInline[][]): MarkdownInline[] {
  const nodes: MarkdownInline[] = [];
  lines.forEach((line, index) => {
    if (index > 0) {
      nodes.push({ type: 'break' });
    }
    nodes.push(...line);
  });
  return nodes;
}

/**
 * Parses a small Markdown subset: fenced code blocks, headings, ordered and
 * unordered lists, paragraphs with hard line breaks, inline code and bold.
 * Unknown syntax is kept as literal text.
 */
export function parseMarkdown(source: string): MarkdownBlock[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: MarkdownBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (line.trim() === '') {
      index += 1;
      continue;
    }

    const fence = FENCE_OPEN_PATTERN.exec(line);
    if (fence !== null) {
      const fenceLength = fence[1].length;
      const lang = fence[2].trim();
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !isClosingFence(lines[index], fenceLength)) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) {
        index += 1;
      }
      blocks.push({ type: 'codeBlock', lang, text: codeLines.join('\n') });
      continue;
    }

    const heading = HEADING_PATTERN.exec(line);
    if (heading !== null) {
      blocks.push({
        type: 'heading',
        level: heading[1].length,
        children: parseInline(heading[2]),
      });
      index += 1;
      continue;
    }

    const unordered = UNORDERED_ITEM_PATTERN.exec(line);
    const ordered = ORDERED_ITEM_PATTERN.exec(line);
    if (unordered !== null || ordered !== null) {
      const isOrdered = ordered !== null;
      const items: MarkdownInline[][] = [];
      while (index < lines.length) {
        const item = (isOrdered ? ORDERED_ITEM_PATTERN : UNORDERED_ITEM_PATTERN).exec(
          lines[index],
        );
        if (item === null) {
          break;
        }
        items.push(parseInline(item[1]));
        index += 1;
      }
      blocks.push({ type: 'list', ordered: isOrdered, items });
      continue;
    }

    const paragraphLines: MarkdownInline[][] = [];
    while (index < lines.length) {
      const current = lines[index];
      if (current.trim() === '' || isBlockStart(current)) {
        break;
      }
      paragraphLines.push(parseInline(current));
      index += 1;
    }
    blocks.push({ type: 'paragraph', children: joinLines(paragraphLines) });
  }

  return blocks;
}
