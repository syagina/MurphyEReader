import { describe, expect, it } from 'vitest';
import type { Note } from '@shared/types';
import {
  ASK_SYSTEM_PROMPT,
  DEPTH_SYSTEM_PROMPT,
  INNOVATION_SYSTEM_PROMPT,
  SUMMARY_MINI_SYSTEM_PROMPT,
  SUMMARY_SYSTEM_PROMPT,
  buildDepthPrompt,
  buildInnovationPrompt,
  buildSummaryUserPrompt,
} from '@main/ai/prompts';

function makeNote(overrides: Partial<Note> & Pick<Note, 'id'>): Note {
  return {
    paperId: 1,
    type: 'manual',
    title: `笔记${overrides.id}`,
    contentMd: '内容',
    tags: [],
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  };
}

describe('系统提示词', () => {
  it('ASK_SYSTEM_PROMPT 要求中文回答并包含 [p.N] 引用格式', () => {
    expect(ASK_SYSTEM_PROMPT).toContain('中文');
    expect(ASK_SYSTEM_PROMPT).toContain('[p.N]');
  });

  it('DEPTH_SYSTEM_PROMPT 包含五个段名', () => {
    for (const section of ['角色', '判断依据', '学习深度', '最小学习路径', '跳过的代价']) {
      expect(DEPTH_SYSTEM_PROMPT).toContain(section);
    }
  });

  it('SUMMARY_SYSTEM_PROMPT 包含八个段名', () => {
    for (const section of [
      '研究问题',
      '方法核心',
      '关键假设',
      '数据与实验',
      '结论',
      '局限',
      '与我的方向的关系',
      '可借鉴点',
    ]) {
      expect(SUMMARY_SYSTEM_PROMPT).toContain(section);
    }
  });

  it('SUMMARY_MINI_SYSTEM_PROMPT 与 INNOVATION_SYSTEM_PROMPT 为非空中文提示词', () => {
    expect(SUMMARY_MINI_SYSTEM_PROMPT.length).toBeGreaterThan(0);
    expect(SUMMARY_MINI_SYSTEM_PROMPT).toContain('中文');
    expect(INNOVATION_SYSTEM_PROMPT.length).toBeGreaterThan(0);
    expect(INNOVATION_SYSTEM_PROMPT).toContain('创新');
  });
});

describe('buildDepthPrompt', () => {
  it('返回 DEPTH 系统提示，user 含概念名与选文', () => {
    const concept = '有限元空间';
    const selectionText = '本文第三章引入有限元空间，用于离散化弱形式。';

    const result = buildDepthPrompt(concept, selectionText);

    expect(result.system).toBe(DEPTH_SYSTEM_PROMPT);
    expect(result.user).toContain(concept);
    expect(result.user).toContain(selectionText);
  });
});

describe('buildSummaryUserPrompt', () => {
  it('返回非空的总结指令', () => {
    const prompt = buildSummaryUserPrompt();

    expect(prompt.length).toBeGreaterThan(0);
    expect(prompt).toContain('总结');
  });
});

describe('buildInnovationPrompt', () => {
  it('返回 INNOVATION 系统提示，user 含每条笔记的标题与内容', () => {
    const notes = [
      makeNote({
        id: 1,
        type: 'concept',
        title: '概念卡：有限元空间',
        contentMd: '有限元空间是逼近解所在的空间。',
      }),
      makeNote({
        id: 2,
        type: 'summary',
        title: '总结：另一篇文献',
        contentMd: '该文用谱方法求解，精度更高。',
      }),
    ];

    const result = buildInnovationPrompt(notes);

    expect(result.system).toBe(INNOVATION_SYSTEM_PROMPT);
    for (const note of notes) {
      expect(result.user).toContain(note.title);
      expect(result.user).toContain(note.contentMd);
    }
  });

  it('没有相关笔记时仍返回可用的 user 提示', () => {
    const result = buildInnovationPrompt([]);

    expect(result.user.length).toBeGreaterThan(0);
  });
});
