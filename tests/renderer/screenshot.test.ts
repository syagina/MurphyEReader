// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cropToDataUrl, normalizeRect, toSourceRect } from '@renderer/lib/screenshot';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('normalizeRect', () => {
  it('反向拖拽归一化为左上角起点', () => {
    expect(normalizeRect({ x: 100, y: 100 }, { x: 40, y: 50 })).toEqual({
      x: 40,
      y: 50,
      width: 60,
      height: 50,
    });
  });

  it('正向拖拽保持不变', () => {
    expect(normalizeRect({ x: 40, y: 50 }, { x: 100, y: 100 })).toEqual({
      x: 40,
      y: 50,
      width: 60,
      height: 50,
    });
  });

  it('不做取整，保留浮点坐标', () => {
    expect(normalizeRect({ x: 10.5, y: 20.25 }, { x: 4.25, y: 30.75 })).toEqual({
      x: 4.25,
      y: 20.25,
      width: 6.25,
      height: 10.5,
    });
  });
});

describe('toSourceRect', () => {
  it('CSS 800×600 到 canvas 1600×1200 的 2 倍矩形精确换算', () => {
    expect(
      toSourceRect(
        { x: 10, y: 10, width: 100, height: 50 },
        { width: 800, height: 600 },
        { width: 1600, height: 1200 },
      ),
    ).toEqual({ x: 20, y: 20, width: 200, height: 100 });
  });

  it('四个值都四舍五入并钳制在画布范围内', () => {
    expect(
      toSourceRect(
        { x: 750.4, y: 550.6, width: 100, height: 100 },
        { width: 800, height: 600 },
        { width: 1600, height: 1200 },
      ),
    ).toEqual({ x: 1501, y: 1101, width: 99, height: 99 });

    expect(
      toSourceRect(
        { x: -10, y: -10, width: 20, height: 20 },
        { width: 800, height: 600 },
        { width: 1600, height: 1200 },
      ),
    ).toEqual({ x: 0, y: 0, width: 40, height: 40 });
  });

  it('CSS 尺寸为零或负数时返回零尺寸矩形', () => {
    const zero = { x: 0, y: 0, width: 0, height: 0 };
    expect(
      toSourceRect(rect(10, 10, 100, 50), { width: 0, height: 600 }, { width: 1600, height: 1200 }),
    ).toEqual(zero);
    expect(
      toSourceRect(rect(10, 10, 100, 50), { width: 800, height: 0 }, { width: 1600, height: 1200 }),
    ).toEqual(zero);
    expect(
      toSourceRect(rect(10, 10, 100, 50), { width: -1, height: -1 }, { width: 1600, height: 1200 }),
    ).toEqual(zero);
  });
});

function rect(x: number, y: number, width: number, height: number) {
  return { x, y, width, height };
}

interface FakeCanvas {
  width: number;
  height: number;
  getContext(kind: string): { drawImage: ReturnType<typeof vi.fn> } | null;
  toDataURL(type: string): string;
}

function installFakeOutputCanvas(): {
  canvas: FakeCanvas;
  drawImage: ReturnType<typeof vi.fn>;
  toDataURL: ReturnType<typeof vi.fn>;
  createSpy: ReturnType<typeof vi.spyOn>;
} {
  const drawImage = vi.fn();
  const toDataURL = vi.fn(() => 'data:image/png;base64,AAAA');
  const canvas: FakeCanvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => ({ drawImage })),
    toDataURL,
  };
  const original = document.createElement.bind(document);
  const createSpy = vi
    .spyOn(document, 'createElement')
    .mockImplementation(((tagName: string) =>
      tagName === 'canvas' ? canvas : original(tagName)) as typeof document.createElement);
  return { canvas, drawImage, toDataURL, createSpy };
}

describe('cropToDataUrl', () => {
  it('按源矩形裁剪并返回 PNG data URL', async () => {
    const { canvas, drawImage, toDataURL } = installFakeOutputCanvas();
    const source = { width: 800, height: 600 } as unknown as HTMLCanvasElement;

    const dataUrl = await cropToDataUrl(source, rect(10, 20, 100, 50));

    expect(dataUrl).toBe('data:image/png;base64,AAAA');
    expect(canvas.width).toBe(100);
    expect(canvas.height).toBe(50);
    expect(drawImage).toHaveBeenCalledTimes(1);
    expect(drawImage).toHaveBeenCalledWith(source, 10, 20, 100, 50, 0, 0, 100, 50);
    expect(toDataURL).toHaveBeenCalledWith('image/png');
  });

  it('把源矩形钳制在源画布范围内', async () => {
    const { drawImage } = installFakeOutputCanvas();
    const source = { width: 100, height: 100 } as unknown as HTMLCanvasElement;

    await cropToDataUrl(source, rect(-5, -5, 20, 20));

    expect(drawImage).toHaveBeenCalledWith(source, 0, 0, 20, 20, 0, 0, 20, 20);
  });

  it('2D 上下文不可用时抛出明确错误', async () => {
    const toDataURL = vi.fn(() => 'data:image/png;base64,AAAA');
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => null),
      toDataURL,
    };
    const original = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((tagName: string) =>
      tagName === 'canvas' ? canvas : original(tagName)) as typeof document.createElement);

    await expect(
      cropToDataUrl({ width: 10, height: 10 } as unknown as HTMLCanvasElement, rect(0, 0, 5, 5)),
    ).rejects.toThrow('无法创建 2D 画布上下文');
    expect(toDataURL).not.toHaveBeenCalled();
  });
});
