import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AI_FLOATING_BOUNDS_STORAGE_KEY,
  AI_PANEL_LAYOUT_STORAGE_KEY,
  readAiFloatingBounds,
  readAiPanelLayout,
  writeAiFloatingBounds,
  writeAiPanelLayout,
} from '@renderer/lib/ai-panel-layout';
import {
  defaultAiFloatingBounds,
  type AiPanelFloatingBounds,
} from '@shared/ai-panel';

function makeStorage(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial));
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key: string) => data.get(key) ?? null,
    key: (index: number) => [...data.keys()][index] ?? null,
    removeItem: (key: string) => data.delete(key),
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
}

function stubStorage(storage: Storage): void {
  vi.stubGlobal('window', { localStorage: storage });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AI 面板布局持久化', () => {
  it('未保存或无法读取时回退到停靠布局', () => {
    stubStorage(makeStorage());
    expect(readAiPanelLayout()).toBe('docked');

    stubStorage({
      ...makeStorage(),
      getItem: () => {
        throw new Error('storage blocked');
      },
    } as Storage);
    expect(readAiPanelLayout()).toBe('docked');
  });

  it('读取并写入悬浮布局', () => {
    const storage = makeStorage();
    stubStorage(storage);

    writeAiPanelLayout('floating');
    expect(storage.getItem(AI_PANEL_LAYOUT_STORAGE_KEY)).toBe('floating');
    expect(readAiPanelLayout()).toBe('floating');

    writeAiPanelLayout('docked');
    expect(readAiPanelLayout()).toBe('docked');
  });

  it('写入失败时不抛错，布局切换仍可继续', () => {
    stubStorage({
      ...makeStorage(),
      setItem: () => {
        throw new Error('quota exceeded');
      },
    } as Storage);

    expect(() => writeAiPanelLayout('floating')).not.toThrow();
    expect(() => writeAiFloatingBounds(defaultAiFloatingBounds(1200, 800))).not.toThrow();
  });
});

describe('AI 悬浮面板边界持久化', () => {
  it('未保存、JSON 损坏或字段无效时回退到默认位置', () => {
    stubStorage(makeStorage());
    expect(readAiFloatingBounds(1440, 900)).toEqual(defaultAiFloatingBounds(1440, 900));

    stubStorage(makeStorage({ [AI_FLOATING_BOUNDS_STORAGE_KEY]: '{not json' }));
    expect(readAiFloatingBounds(1440, 900)).toEqual(defaultAiFloatingBounds(1440, 900));

    stubStorage(
      makeStorage({
        [AI_FLOATING_BOUNDS_STORAGE_KEY]: JSON.stringify({
          x: '10',
          y: 20,
          width: 400,
          height: 500,
        }),
      }),
    );
    expect(readAiFloatingBounds(1440, 900)).toEqual(defaultAiFloatingBounds(1440, 900));
  });

  it('读取旧布局时按当前窗口夹紧，避免面板落在窗口外', () => {
    const stored: AiPanelFloatingBounds = {
      x: -100,
      y: -100,
      width: 100,
      height: 100,
    };
    stubStorage(
      makeStorage({ [AI_FLOATING_BOUNDS_STORAGE_KEY]: JSON.stringify(stored) }),
    );

    expect(readAiFloatingBounds(1200, 800)).toEqual({
      x: 16,
      y: 16,
      width: 320,
      height: 320,
    });
  });

  it('写入后按原样读回', () => {
    const storage = makeStorage();
    stubStorage(storage);
    const bounds: AiPanelFloatingBounds = { x: 700, y: 90, width: 430, height: 610 };

    writeAiFloatingBounds(bounds);

    expect(JSON.parse(storage.getItem(AI_FLOATING_BOUNDS_STORAGE_KEY) ?? '')).toEqual(
      bounds,
    );
    expect(readAiFloatingBounds(1440, 900)).toEqual(bounds);
  });
});
