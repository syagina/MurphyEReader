import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  displayNormalizedToPdfPoint,
  displayPageSize,
  displayRectToPdfQuad,
  normalizeRotation,
  quadToRect,
} from '@main/export/annotation-rotation';

const area = { x: 0, y: 0, width: 600, height: 800 };
const point: [number, number] = [0.1, 0.2];
// 0.25 / 0.125 是二进制精确值，避免显示角 x+width 的浮点漂移影响精确断言。
const noteRect = { x: 0.25, y: 0.25, width: 0.25, height: 0.125 };

afterEach(() => {
  vi.restoreAllMocks();
});

describe('normalizeRotation', () => {
  it('非 90 倍数按 0 处理并告警', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(normalizeRotation(45)).toBe(0);
    expect(warn).toHaveBeenCalled();
  });

  it('按 360 取模，接受负数和整圈角度', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(normalizeRotation(360)).toBe(0);
    expect(normalizeRotation(720)).toBe(0);
    expect(normalizeRotation(90)).toBe(90);
    expect(normalizeRotation(450)).toBe(90);
    expect(normalizeRotation(-90)).toBe(270);
    expect(normalizeRotation(-450)).toBe(270);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('displayNormalizedToPdfPoint', () => {
  it.each([
    [0, [60, 640]],
    [90, [120, 80]],
    [180, [540, 160]],
    [270, [480, 720]],
  ] as const)('%i° 映射', (rotation, expected) => {
    expect(displayNormalizedToPdfPoint(area, rotation, point)).toEqual(expected);
  });

  it('可视框原点计入偏移', () => {
    const shifted = { x: 100, y: 50, width: 600, height: 800 };
    expect(displayNormalizedToPdfPoint(shifted, 0, point)).toEqual([160, 690]);
    expect(displayNormalizedToPdfPoint(shifted, 90, point)).toEqual([220, 130]);
    expect(displayNormalizedToPdfPoint(shifted, 180, point)).toEqual([640, 210]);
    expect(displayNormalizedToPdfPoint(shifted, 270, point)).toEqual([580, 770]);
  });
});

describe('displayRectToPdfQuad', () => {
  // 顺序：显示左上、右上、左下、右下
  it.each([
    [
      0,
      [
        [150, 600],
        [300, 600],
        [150, 500],
        [300, 500],
      ],
    ],
    [
      90,
      [
        [150, 200],
        [150, 400],
        [225, 200],
        [225, 400],
      ],
    ],
    [
      180,
      [
        [450, 200],
        [300, 200],
        [450, 300],
        [300, 300],
      ],
    ],
    [
      270,
      [
        [450, 600],
        [450, 400],
        [375, 600],
        [375, 400],
      ],
    ],
  ] as const)('%i° 四角顺序', (rotation, expected) => {
    expect(displayRectToPdfQuad(area, rotation, noteRect)).toEqual(expected);
  });

  it('90° 下与文字锚点的四角结果一致（浮点精度内）', () => {
    const quad = displayRectToPdfQuad(area, 90, {
      x: 0.1,
      y: 0.2,
      width: 0.3,
      height: 0.1,
    });
    const expected = [120, 80, 120, 320, 180, 80, 180, 320];
    expect(quad.flat()).toHaveLength(expected.length);
    quad.flat().forEach((value, index) => {
      expect(value).toBeCloseTo(expected[index] ?? Number.NaN, 10);
    });
  });
});

describe('quadToRect', () => {
  it.each([
    [0, { x: 150, y: 500, width: 150, height: 100 }],
    [90, { x: 150, y: 200, width: 75, height: 200 }],
    [180, { x: 300, y: 200, width: 150, height: 100 }],
    [270, { x: 375, y: 400, width: 75, height: 200 }],
  ] as const)('%i° 包围盒', (rotation, expected) => {
    expect(quadToRect(displayRectToPdfQuad(area, rotation, noteRect))).toEqual(expected);
  });
});

describe('displayPageSize', () => {
  it.each([
    [0, { width: 600, height: 800 }],
    [90, { width: 800, height: 600 }],
    [180, { width: 600, height: 800 }],
    [270, { width: 800, height: 600 }],
  ] as const)('%i° 显示宽高', (rotation, expected) => {
    expect(displayPageSize(area, rotation)).toEqual(expected);
  });
});
