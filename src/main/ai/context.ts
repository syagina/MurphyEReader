import type {
  ChatContextMode,
  ChatMessage,
  Note,
  OutlineNode,
  Paper,
  PaperPage,
} from '@shared/types';
import type { AiMessage } from './client';
import { ASK_SYSTEM_PROMPT, CONVERSATION_SYSTEM_PROMPT } from './prompts';

export interface AssembleInput {
  paper: Paper;
  pages: PaperPage[];
  history: ChatMessage[];
  question: string;
  selectionText?: string;
  currentPageNo?: number;
  contextMode: ChatContextMode;
  budgetTokens: number;
}

export interface AssembleOutput {
  system: string;
  messages: AiMessage[];
  includedPageNos: number[];
  trimmed: boolean;
}

const CJK_TOKEN_PATTERN = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\u3000-\u303F]/u;
const CJK_CHAR_PATTERN = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/u;
const LATIN_WORD_PATTERN = /[a-z]+/g;
const OUTLINE_INDENT = '  ';

/**
 * Estimates the token cost of a string: every CJK character (including CJK
 * punctuation) counts 1 token, every other character counts 1/4 token, and the
 * total is rounded up.
 */
export function estimateTokens(text: string): number {
  let tokens = 0;
  for (const char of text) {
    tokens += CJK_TOKEN_PATTERN.test(char) ? 1 : 0.25;
  }
  return Math.ceil(tokens);
}

function renderOutline(nodes: OutlineNode[], depth: number): string[] {
  const lines: string[] = [];
  for (const node of nodes) {
    const pageSuffix = node.pageNo === null ? '' : `（第 ${node.pageNo} 页）`;
    lines.push(`${OUTLINE_INDENT.repeat(depth)}- ${node.title}${pageSuffix}`);
    lines.push(...renderOutline(node.children, depth + 1));
  }
  return lines;
}

function renderPaperInfo(paper: Paper, currentPageNo?: number): string[] {
  const lines: string[] = ['【文献信息】'];
  lines.push(`标题：${paper.title}`);
  lines.push(`作者：${paper.authors.trim() === '' ? '未知' : paper.authors}`);
  lines.push(`年份：${paper.year === null ? '未知' : String(paper.year)}`);
  if (currentPageNo !== undefined) {
    lines.push(`当前页：${currentPageNo}`);
  }
  return lines;
}

function renderOutlineBlock(paper: Paper): string[] {
  const lines: string[] = ['', '【目录】'];
  if (paper.outline.length === 0) {
    lines.push('（无目录信息）');
  } else {
    lines.push(...renderOutline(paper.outline, 0));
  }
  return lines;
}

function renderPageBlocks(pages: PaperPage[]): string[] {
  if (pages.length === 0) {
    return ['（无正文）'];
  }
  const sorted = [...pages].sort((a, b) => a.pageNo - b.pageNo);
  const lines: string[] = [];
  sorted.forEach((page, index) => {
    if (index > 0) {
      lines.push('');
    }
    lines.push(`[第 ${page.pageNo} 页]`);
    lines.push(page.text);
  });
  return lines;
}

/**
 * Formats paper metadata, the outline and the given page texts. The selection
 * block is appended whenever a non-empty selection is provided; callers decide
 * which pages enter the budget.
 */
export function buildPaperContextBlock(
  paper: Paper,
  pages: PaperPage[],
  selectionText?: string,
  currentPageNo?: number,
): string {
  const lines = [
    ...renderPaperInfo(paper, currentPageNo),
    ...renderOutlineBlock(paper),
    '',
    '【正文】',
    ...renderPageBlocks(pages),
  ];

  if (selectionText !== undefined && selectionText !== '') {
    lines.push('', '【选中文本】', selectionText);
  }

  return lines.join('\n');
}

/**
 * The paper prefix shared by chat turns. It deliberately excludes the current
 * page and the selection so that scrolling or selecting text does not change
 * the cached prefix; those volatile parts are sent in the current user message
 * instead.
 */
export function buildStablePaperContextBlock(
  paper: Paper,
  pages: PaperPage[],
): string {
  const lines = [...renderPaperInfo(paper), ...renderOutlineBlock(paper)];
  if (pages.length > 0) {
    lines.push('', '【正文】', ...renderPageBlocks(pages));
  }
  return lines.join('\n');
}

interface TurnContextInput {
  selectionText?: string;
  currentPageNo?: number;
  pages: PaperPage[];
  includeCurrentPage?: boolean;
}

/**
 * Formats the per-turn context. Everything here is placed after the stable
 * paper prefix and the conversation history, so changing it only invalidates
 * the tail of the request.
 */
function buildTurnContextBlock({
  selectionText,
  currentPageNo,
  pages,
  includeCurrentPage = true,
}: TurnContextInput): string {
  const lines: string[] = [];

  if (includeCurrentPage && currentPageNo !== undefined) {
    lines.push(`【当前页】第 ${currentPageNo} 页`);
  }

  if (pages.length > 0) {
    if (lines.length > 0) {
      lines.push('');
    }
    lines.push('【本轮附带正文】', ...renderPageBlocks(pages));
  }

  if (selectionText !== undefined && selectionText !== '') {
    if (lines.length > 0) {
      lines.push('');
    }
    const pageLabel =
      currentPageNo === undefined ? '' : `（第 ${currentPageNo} 页）`;
    lines.push(`【用户选中的原文${pageLabel}】`, selectionText);
  }

  return lines.join('\n');
}

function appendTurnContext(turnContext: string, question: string): string {
  return turnContext === '' ? question : `${turnContext}\n\n${question}`;
}

function pageBlockText(page: PaperPage): string {
  return `[第 ${page.pageNo} 页]\n${page.text}`;
}

function extractQueryTerms(query: string): string[] {
  const terms = new Set<string>();
  for (const word of query.toLowerCase().match(LATIN_WORD_PATTERN) ?? []) {
    if (word.length >= 2) {
      terms.add(word);
    }
  }
  for (const char of query) {
    if (CJK_CHAR_PATTERN.test(char)) {
      terms.add(char);
    }
  }
  return [...terms];
}

function scorePage(page: PaperPage, terms: string[]): number {
  const text = page.text.toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (text.includes(term)) {
      score += 1;
    }
  }
  return score;
}

/**
 * Selects pages by query-term overlap within the token budget. The current
 * page is always included, even when it alone exceeds the budget; the result is
 * ordered by page number ascending.
 */
export function retrieveRelevantPages(
  pages: PaperPage[],
  query: string,
  budgetTokens: number,
  currentPageNo?: number,
): PaperPage[] {
  const terms = extractQueryTerms(query);
  const forced =
    currentPageNo === undefined
      ? undefined
      : pages.find((page) => page.pageNo === currentPageNo);
  const selected: PaperPage[] = forced === undefined ? [] : [forced];
  let usedTokens = forced === undefined ? 0 : estimateTokens(pageBlockText(forced));

  const candidates = pages
    .filter((page) => page !== forced)
    .map((page) => ({ page, score: scorePage(page, terms) }))
    .sort((a, b) => b.score - a.score || a.page.pageNo - b.page.pageNo);

  for (const candidate of candidates) {
    const cost = estimateTokens(pageBlockText(candidate.page));
    if (usedTokens + cost <= budgetTokens) {
      selected.push(candidate.page);
      usedTokens += cost;
    }
  }

  return selected.sort((a, b) => a.pageNo - b.pageNo);
}

function composeStableSystem(paper: Paper, pages: PaperPage[]): string {
  return `${ASK_SYSTEM_PROMPT}\n\n${buildStablePaperContextBlock(paper, pages)}`;
}

function buildMessages(
  history: ChatMessage[],
  questionContent: string,
  remainingTokens: number,
): AiMessage[] {
  const kept: ChatMessage[] = [];
  let usedTokens = 0;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const message = history[index];
    const cost = estimateTokens(message.content);
    if (usedTokens + cost > remainingTokens) {
      break;
    }
    kept.unshift(message);
    usedTokens += cost;
  }

  const messages: AiMessage[] = kept.map((message) => ({
    role: message.role,
    content: message.content,
  }));
  messages.push({ role: 'user', content: questionContent });
  return messages;
}

export function assembleChatContext(input: AssembleInput): AssembleOutput {
  const { paper, pages, history, question, selectionText, contextMode, budgetTokens } = input;
  const sortedPages = [...pages].sort((a, b) => a.pageNo - b.pageNo);

  if (contextMode === 'conversation') {
    const system = CONVERSATION_SYSTEM_PROMPT;
    const turnContext = buildTurnContextBlock({
      selectionText,
      currentPageNo: input.currentPageNo,
      pages: [],
      includeCurrentPage: false,
    });
    const questionContent = appendTurnContext(turnContext, question);
    return {
      system,
      messages: buildMessages(
        history,
        questionContent,
        budgetTokens - estimateTokens(system) - estimateTokens(questionContent),
      ),
      includedPageNos: [],
      trimmed: false,
    };
  }

  if (contextMode === 'page') {
    const currentPageNo = input.currentPageNo ?? 1;
    const currentPage = sortedPages.find((page) => page.pageNo === currentPageNo);
    const includedPages = currentPage === undefined ? [] : [currentPage];
    const system = composeStableSystem(paper, []);
    const turnContext = buildTurnContextBlock({
      selectionText,
      currentPageNo,
      pages: includedPages,
    });
    const questionContent = appendTurnContext(turnContext, question);
    return {
      system,
      messages: buildMessages(
        history,
        questionContent,
        budgetTokens - estimateTokens(system) - estimateTokens(questionContent),
      ),
      includedPageNos: includedPages.map((page) => page.pageNo),
      trimmed: false,
    };
  }

  const fullSystem = composeStableSystem(paper, sortedPages);
  const baseTurnContext = buildTurnContextBlock({
    selectionText,
    currentPageNo: input.currentPageNo,
    pages: [],
  });
  const baseQuestionContent = appendTurnContext(baseTurnContext, question);
  const fullTokens = estimateTokens(fullSystem) + estimateTokens(baseQuestionContent);

  if (fullTokens <= budgetTokens) {
    return {
      system: fullSystem,
      messages: buildMessages(
        history,
        baseQuestionContent,
        budgetTokens - fullTokens,
      ),
      includedPageNos: sortedPages.map((page) => page.pageNo),
      trimmed: false,
    };
  }

  const baseSystem = composeStableSystem(paper, []);
  const pageBudget =
    budgetTokens - estimateTokens(baseSystem) - estimateTokens(baseQuestionContent);
  const includedPages = retrieveRelevantPages(
    sortedPages,
    question,
    pageBudget,
    input.currentPageNo,
  );
  const turnContext = buildTurnContextBlock({
    selectionText,
    currentPageNo: input.currentPageNo,
    pages: includedPages,
  });
  const questionContent = appendTurnContext(turnContext, question);

  return {
    system: baseSystem,
    messages: buildMessages(
      history,
      questionContent,
      budgetTokens - estimateTokens(baseSystem) - estimateTokens(questionContent),
    ),
    includedPageNos: includedPages.map((page) => page.pageNo),
    trimmed: true,
  };
}

/**
 * Greedily packs consecutive pages into chunks whose text-token sum stays
 * within the budget. A page larger than the budget occupies its own chunk.
 */
export function chunkPages(pages: PaperPage[], budgetTokens: number): PaperPage[][] {
  const chunks: PaperPage[][] = [];
  let currentChunk: PaperPage[] = [];
  let currentTokens = 0;

  for (const page of pages) {
    const cost = estimateTokens(page.text);
    if (currentChunk.length > 0 && currentTokens + cost > budgetTokens) {
      chunks.push(currentChunk);
      currentChunk = [];
      currentTokens = 0;
    }
    currentChunk.push(page);
    currentTokens += cost;
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }
  return chunks;
}

/**
 * Ranks notes sharing a tag with the current paper first, then the rest; each
 * group is ordered by updatedAt and id descending. Whole notes are added until
 * the next one would exceed maxChars.
 */
export function selectRelatedNotes(
  notes: Note[],
  currentPaper: Paper,
  maxChars: number,
): Note[] {
  const paperTags = new Set(currentPaper.tags);
  const byRecency = (a: Note, b: Note): number => b.updatedAt - a.updatedAt || b.id - a.id;
  const sharesTag = (note: Note): boolean => note.tags.some((tag) => paperTags.has(tag));
  const ranked = [
    ...notes.filter(sharesTag).sort(byRecency),
    ...notes.filter((note) => !sharesTag(note)).sort(byRecency),
  ];

  const selected: Note[] = [];
  let usedChars = 0;
  for (const note of ranked) {
    const size = note.title.length + note.contentMd.length;
    if (usedChars + size > maxChars) {
      break;
    }
    selected.push(note);
    usedChars += size;
  }
  return selected;
}
