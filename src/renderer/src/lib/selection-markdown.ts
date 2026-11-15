const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

const BLOCK_TAGS = new Set([
  'P',
  'DIV',
  'SECTION',
  'ARTICLE',
  'UL',
  'OL',
  'LI',
  'PRE',
  'BLOCKQUOTE',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'TABLE',
]);

export interface AssistantSelection {
  markdown: string;
  messageId: number;
  /** Selection rectangle in viewport coordinates, used to place the popup. */
  rect: { left: number; top: number; right: number; bottom: number };
}

function isElement(node: Node): node is Element {
  return node.nodeType === ELEMENT_NODE;
}

function parentElement(node: Node): Element | null {
  return isElement(node) ? node : node.parentElement;
}

/** Collapses whitespace that HTML inserted between inline elements. */
function normalizeInlineText(value: string): string {
  return value.replace(/ /g, ' ').replace(/\s+/g, ' ');
}

function annotationText(element: Element): string | null {
  const annotation = element.querySelector(
    'annotation[encoding="application/x-tex"], annotation',
  );
  const text = annotation?.textContent?.trim();
  return text === undefined || text === '' ? null : text;
}

function mathMarkdown(element: Element, forceDisplay?: boolean): string | null {
  const source =
    element.getAttribute('aria-label')?.trim() ?? annotationText(element) ?? '';
  if (source === '') {
    return null;
  }
  const display =
    forceDisplay === true ||
    element.classList.contains('markdown-math-display') ||
    element.closest('.markdown-math-block') !== null;
  return display ? `$$\n${source}\n$$` : `$${source}$`;
}

function inlineCode(value: string): string {
  const text = value.replace(/\r?\n/g, ' ').trim();
  if (text === '') {
    return '';
  }
  const ticks = text.includes('`') ? '``' : '`';
  return `${ticks}${text}${ticks}`;
}

function inlineOf(node: Node): string {
  if (node.nodeType === TEXT_NODE) {
    return normalizeInlineText(node.textContent ?? '');
  }
  if (!isElement(node)) {
    return normalizeInlineText(node.textContent ?? '');
  }

  const tag = node.tagName;
  if (node.classList.contains('markdown-math')) {
    return mathMarkdown(node) ?? normalizeInlineText(node.textContent ?? '');
  }
  if (node.classList.contains('katex')) {
    return mathMarkdown(node) ?? normalizeInlineText(node.textContent ?? '');
  }
  if (tag === 'BR') {
    return '\n';
  }
  if (tag === 'STRONG' || tag === 'B') {
    const content = inlineChildren(node).trim();
    return content === '' ? '' : `**${content}**`;
  }
  if (tag === 'CODE') {
    return inlineCode(node.textContent ?? '');
  }
  if (tag === 'BUTTON') {
    return normalizeInlineText(node.textContent ?? '');
  }
  return inlineChildren(node);
}

function inlineChildren(element: Element): string {
  return Array.from(element.childNodes).map(inlineOf).join('');
}

function fenceFor(code: string): string {
  let fence = '```';
  while (code.includes(fence)) {
    fence += '`';
  }
  return fence;
}

function listMarkdown(element: Element, ordered: boolean): string {
  const items = Array.from(element.children).filter((child) => child.tagName === 'LI');
  const lines = items
    .map((item, index) => {
      const content = inlineOf(item).trim().replace(/\s*\n\s*/g, ' ');
      return content === '' ? '' : `${ordered ? `${index + 1}.` : '-'} ${content}`;
    })
    .filter((line) => line !== '');
  return lines.length === 0 ? '' : `${lines.join('\n')}\n\n`;
}

function blockOf(node: Node): string {
  if (!isElement(node)) {
    return inlineOf(node);
  }
  const tag = node.tagName;

  if (node.classList.contains('markdown-math-block')) {
    const math = node.querySelector('.markdown-math');
    const rendered = math === null ? null : mathMarkdown(math, true);
    return rendered === null ? `${inlineOf(node)}\n\n` : `${rendered}\n\n`;
  }
  if (node.classList.contains('markdown-math')) {
    return `${mathMarkdown(node) ?? inlineOf(node)}\n\n`;
  }
  if (tag === 'PRE') {
    const code = node.querySelector('code');
    const text = (code?.textContent ?? node.textContent ?? '').replace(/\n$/, '');
    const fence = fenceFor(text);
    return `${fence}\n${text}\n${fence}\n\n`;
  }
  if (tag === 'UL' || tag === 'OL') {
    return listMarkdown(node, tag === 'OL');
  }
  if (/^H[1-6]$/.test(tag)) {
    const level = Number(tag.slice(1));
    const content = inlineOf(node).trim();
    return content === '' ? '' : `${'#'.repeat(level)} ${content}\n\n`;
  }
  if (tag === 'P') {
    const content = inlineOf(node).trim();
    return content === '' ? '' : `${content}\n\n`;
  }
  if (tag === 'BLOCKQUOTE') {
    const content = blockChildren(node).trim();
    return content === '' ? '' : `${content.split('\n').map((line) => `> ${line}`).join('\n')}\n\n`;
  }
  if (tag === 'LI') {
    const content = inlineOf(node).trim();
    return content === '' ? '' : `- ${content}\n`;
  }
  if (BLOCK_TAGS.has(tag)) {
    return blockChildren(node);
  }
  return inlineOf(node);
}

function blockChildren(node: Node): string {
  return Array.from(node.childNodes)
    .map((child) =>
      isElement(child) && BLOCK_TAGS.has(child.tagName) ? blockOf(child) : inlineOf(child),
    )
    .join('');
}

function normalizeMarkdown(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Converts a DOM range to the Markdown subset PaperLens understands. KaTeX
 * nodes contribute their original TeX (`aria-label` or MathML annotation)
 * instead of the rendered glyph soup, so formulas survive the trip into notes
 * and exported documents.
 */
export function serializeRange(range: Range): string {
  const startElement = parentElement(range.startContainer);
  const endElement = parentElement(range.endContainer);
  const startMath = startElement?.closest('.markdown-math') ?? null;
  const endMath = endElement?.closest('.markdown-math') ?? null;
  if (startMath !== null && startMath === endMath) {
    const whole = mathMarkdown(startMath);
    if (whole !== null) {
      return whole;
    }
  }

  const fragment = range.cloneContents();
  const markdown = normalizeMarkdown(blockChildren(fragment));
  if (markdown !== '') {
    return markdown;
  }
  return normalizeMarkdown(range.toString());
}

/**
 * Reads the current document selection when it lies inside one assistant
 * message. Selections that span messages, UI buttons, or are collapsed return
 * null so the note affordance only appears for answer text.
 */
export function readAssistantSelection(): AssistantSelection | null {
  const selection = window.getSelection();
  if (selection === null || selection.isCollapsed || selection.rangeCount === 0) {
    return null;
  }
  const range = selection.getRangeAt(0);
  const startElement = parentElement(range.startContainer);
  const endElement = parentElement(range.endContainer);
  if (startElement === null || endElement === null) {
    return null;
  }
  if (startElement.closest('.chat-message-actions, .chat-selection-popup') !== null) {
    return null;
  }
  if (endElement.closest('.chat-message-actions, .chat-selection-popup') !== null) {
    return null;
  }
  const startArticle = startElement.closest(
    '.chat-message-assistant[data-message-id]',
  );
  const endArticle = endElement.closest('.chat-message-assistant[data-message-id]');
  if (startArticle === null || startArticle !== endArticle) {
    return null;
  }
  const messageId = Number(startArticle.getAttribute('data-message-id'));
  if (!Number.isInteger(messageId)) {
    return null;
  }
  const markdown = serializeRange(range);
  if (markdown === '') {
    return null;
  }
  const rect = range.getBoundingClientRect();
  return {
    markdown,
    messageId,
    rect: {
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
    },
  };
}
