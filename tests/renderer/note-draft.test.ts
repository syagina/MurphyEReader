import { describe, expect, it } from 'vitest';
import { isNoteDraftDirty, noteDraftFromNote } from '@renderer/lib/note-draft';

describe('noteDraftFromNote', () => {
  it('把标签数组转为逗号分隔的原始输入', () => {
    const note = { title: 'A', tags: ['x', 'y'], contentMd: 'body' };
    expect(noteDraftFromNote(note)).toEqual({
      title: 'A',
      tags: 'x, y',
      contentMd: 'body',
    });
  });

  it('没有标签时得到空字符串', () => {
    expect(noteDraftFromNote({ title: '', tags: [], contentMd: '' })).toEqual({
      title: '',
      tags: '',
      contentMd: '',
    });
  });
});

describe('isNoteDraftDirty', () => {
  const note = { title: 'A', tags: ['x', 'y'], contentMd: 'body' };

  it('草稿与笔记一致时不脏', () => {
    const draft = noteDraftFromNote(note);
    expect(isNoteDraftDirty(note, draft)).toBe(false);
  });

  it('内容变化时变脏', () => {
    const draft = noteDraftFromNote(note);
    expect(isNoteDraftDirty(note, { ...draft, contentMd: 'changed' })).toBe(true);
  });

  it('标题变化时变脏', () => {
    const draft = noteDraftFromNote(note);
    expect(isNoteDraftDirty(note, { ...draft, title: 'B' })).toBe(true);
  });

  it('原始标签字符串变化时变脏，即使解析结果相同', () => {
    const draft = noteDraftFromNote(note);
    expect(isNoteDraftDirty(note, { ...draft, tags: 'x' })).toBe(true);
    expect(isNoteDraftDirty(note, { ...draft, tags: 'x,y' })).toBe(true);
  });
});
