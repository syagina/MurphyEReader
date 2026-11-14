import type Database from 'better-sqlite3';
import type { AiSettings, Note, Paper } from '@shared/types';
import type { AiClient } from './client';
import {
  buildPaperContextBlock,
  chunkPages,
  estimateTokens,
  retrieveRelevantPages,
  selectRelatedNotes,
} from './context';
import {
  SUMMARY_MINI_SYSTEM_PROMPT,
  SUMMARY_SYSTEM_PROMPT,
  buildDepthPrompt,
  buildInnovationPrompt,
  buildSummaryUserPrompt,
} from './prompts';
import { createNote, listNotes } from '../db/notes';
import { getPaper } from '../db/papers';
import { getPageText, getPages } from '../db/pages';

export type NoteKind = 'summary' | 'concept' | 'innovation';

export interface NoteParams {
  paperId: number;
  selectionText?: string;
  conceptTitle?: string;
  currentPageNo?: number;
}

export interface NoteDeps {
  db: Database.Database;
  ai: Pick<AiClient, 'complete'>;
  getSettings: () => AiSettings;
}

function saveNote(
  db: Database.Database,
  paper: Paper,
  type: Note['type'],
  title: string,
  contentMd: string,
): Note {
  return createNote(db, {
    paperId: paper.id,
    type,
    title,
    contentMd,
    tags: paper.tags,
  });
}

function buildReduceUserPrompt(miniSummaries: string[]): string {
  const sections = miniSummaries
    .map((summary, index) => `### 第 ${index + 1} 部分摘要\n${summary}`)
    .join('\n\n');
  return `以下是论文各部分的分块摘要：\n\n${sections}\n\n${buildSummaryUserPrompt()}`;
}

async function generateSummary(deps: NoteDeps, paper: Paper): Promise<Note> {
  const settings = deps.getSettings();
  const pages = getPages(deps.db, paper.id);
  const title = `《${paper.title}》核心思想总结`;
  const system = `${SUMMARY_SYSTEM_PROMPT}\n\n${buildPaperContextBlock(paper, pages)}`;
  const user = buildSummaryUserPrompt();

  if (estimateTokens(system + user) <= settings.tokenBudget) {
    const contentMd = await deps.ai.complete([
      { role: 'system', content: system },
      { role: 'user', content: user },
    ]);
    return saveNote(deps.db, paper, 'summary', title, contentMd);
  }

  const chunks = chunkPages(pages, settings.tokenBudget);
  const miniSummaries: string[] = [];
  for (const chunk of chunks) {
    const miniSummary = await deps.ai.complete([
      { role: 'system', content: SUMMARY_MINI_SYSTEM_PROMPT },
      { role: 'user', content: buildPaperContextBlock(paper, chunk) },
    ]);
    miniSummaries.push(miniSummary);
  }

  const contentMd = await deps.ai.complete([
    { role: 'system', content: SUMMARY_SYSTEM_PROMPT },
    { role: 'user', content: buildReduceUserPrompt(miniSummaries) },
  ]);
  return saveNote(deps.db, paper, 'summary', title, contentMd);
}

function deriveConcept(params: NoteParams): string {
  if (params.conceptTitle !== undefined && params.conceptTitle.trim() !== '') {
    return params.conceptTitle;
  }
  const firstLine = (params.selectionText ?? '').split('\n')[0].trim();
  if (firstLine !== '') {
    return firstLine.slice(0, 30);
  }
  return '概念';
}

async function generateConcept(
  deps: NoteDeps,
  paper: Paper,
  params: NoteParams,
): Promise<Note> {
  const pageNo = params.currentPageNo ?? 1;
  const concept = deriveConcept(params);
  const pageText = getPageText(deps.db, paper.id, pageNo);
  const base = buildDepthPrompt(concept, params.selectionText ?? '');
  const contextPages =
    pageText === null ? [] : [{ paperId: paper.id, pageNo, text: pageText }];
  const system = `${base.system}\n\n${buildPaperContextBlock(
    paper,
    contextPages,
    params.selectionText,
    pageNo,
  )}`;

  const contentMd = await deps.ai.complete([
    { role: 'system', content: system },
    { role: 'user', content: base.user },
  ]);
  return saveNote(deps.db, paper, 'concept', concept, contentMd);
}

async function generateInnovation(
  deps: NoteDeps,
  paper: Paper,
  params: NoteParams,
): Promise<Note> {
  const settings = deps.getSettings();
  const pages = getPages(deps.db, paper.id);
  const related = selectRelatedNotes(
    listNotes(deps.db),
    paper,
    settings.tokenBudget,
  );
  const prompt = buildInnovationPrompt(related);

  const fullContextBlock = buildPaperContextBlock(paper, pages);
  let contextBlock: string;
  if (estimateTokens(fullContextBlock) <= settings.tokenBudget) {
    contextBlock = fullContextBlock;
  } else {
    const remainingBudget =
      settings.tokenBudget - estimateTokens(prompt.system + prompt.user);
    const query = [
      paper.title,
      params.conceptTitle,
      params.selectionText,
      ...related.map((note) => note.title),
    ]
      .filter(Boolean)
      .join(' ');
    contextBlock = buildPaperContextBlock(
      paper,
      retrieveRelevantPages(pages, query, remainingBudget, params.currentPageNo),
    );
  }

  const system = `${prompt.system}\n\n${contextBlock}`;
  const contentMd = await deps.ai.complete([
    { role: 'system', content: system },
    { role: 'user', content: prompt.user },
  ]);
  return saveNote(
    deps.db,
    paper,
    'idea',
    `《${paper.title}》创新点分析`,
    contentMd,
  );
}

/**
 * Generates a note for the requested paper. Returns `null` only when the paper
 * itself is missing; AI failures reject so the caller can surface them.
 */
export async function generateNote(
  deps: NoteDeps,
  kind: NoteKind,
  params: NoteParams,
): Promise<Note | null> {
  const paper = getPaper(deps.db, params.paperId);
  if (paper === null) {
    return null;
  }
  if (kind === 'summary') {
    return generateSummary(deps, paper);
  }
  if (kind === 'concept') {
    return generateConcept(deps, paper, params);
  }
  return generateInnovation(deps, paper, params);
}
