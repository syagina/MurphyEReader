// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import type { PDFPageProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type {
  AnnotationShapeData,
  AnnotationStroke,
  StickyNote,
} from '@shared/types';
import {
  DrawingCaptureLayer,
  DrawingLayer,
} from '@renderer/components/DrawingLayer';
import type {
  DrawingCaptureLayerProps,
  DrawingLayerProps,
} from '@renderer/components/DrawingLayer';

const PAGE_WIDTH = 400;
const PAGE_HEIGHT = 600;
const LAYER_LEFT = 10;
const LAYER_TOP = 20;

let setPointerCapture: ReturnType<typeof vi.fn>;
let releasePointerCapture: ReturnType<typeof vi.fn>;
let hasPointerCapture: ReturnType<typeof vi.fn>;

function rect(
  left: number,
  top: number,
  width: number,
  height: number,
): DOMRect {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

function makeNote(overrides: Partial<StickyNote> = {}): StickyNote {
  return {
    id: 1,
    paperId: 1,
    pdfVersion: 'original',
    pageNo: 1,
    quote: '',
    contentMd: '',
    anchor: { kind: 'page' },
    source: 'manual',
    kind: 'ink',
    markStyle: 'none',
    color: null,
    pin: null,
    popup: null,
    drawing: null,
    createdAt: 1_000,
    updatedAt: 1_000,
    ...overrides,
  };
}

function makeStroke(
  points: Array<[number, number]>,
  overrides: Partial<AnnotationStroke> = {},
): AnnotationStroke {
  return {
    tool: 'pen',
    color: '#111827',
    width: 3,
    opacity: 1,
    points,
    ...overrides,
  };
}

function makeShape(
  shape: AnnotationShapeData['shape'],
  start: [number, number],
  end: [number, number],
  overrides: Partial<AnnotationShapeData> = {},
): AnnotationShapeData {
  return {
    shape,
    color: '#111827',
    width: 3,
    opacity: 1,
    start,
    end,
    ...overrides,
  };
}

function renderLayer(
  notes: StickyNote[],
  overrides: Partial<DrawingLayerProps> = {},
) {
  return render(
    <DrawingLayer
      notes={notes}
      pageWidth={PAGE_WIDTH}
      pageHeight={PAGE_HEIGHT}
      rotation={0}
      zoom={1}
      {...overrides}
    />,
  );
}

/** A pdf.js page stub: identity-ish mapping with the PDF origin at bottom-left. */
function makePage(rotation = 0): PDFPageProxy {
  const viewBox = [0, 0, PAGE_WIDTH, PAGE_HEIGHT];
  return {
    rotate: rotation,
    getViewport: ({ scale }: { scale: number }) => ({
      width: PAGE_WIDTH * scale,
      height: PAGE_HEIGHT * scale,
      viewBox,
      scale,
      rotation,
      convertToPdfPoint: (x: number, y: number): number[] => [
        x / scale,
        PAGE_HEIGHT - y / scale,
      ],
    }),
  } as unknown as PDFPageProxy;
}

function pointerInit(
  clientX: number,
  clientY: number,
  overrides: Partial<PointerEventInit> = {},
): PointerEventInit {
  return {
    pointerId: 1,
    button: 0,
    buttons: 1,
    clientX,
    clientY,
    ...overrides,
  };
}

/** Screen position of a normalized PDF point at zoom 1 inside the layer. */
function screenPoint(x: number, y: number): [number, number] {
  return [
    LAYER_LEFT + x * PAGE_WIDTH,
    LAYER_TOP + (1 - y) * PAGE_HEIGHT,
  ];
}

type CaptureHandlers = {
  onCommitStroke: ReturnType<typeof vi.fn>;
  onCommitShape: ReturnType<typeof vi.fn>;
  onErase: ReturnType<typeof vi.fn>;
};

function renderCapture(
  overrides: Partial<DrawingCaptureLayerProps> = {},
): CaptureHandlers & {
  layer: HTMLElement;
  container: HTMLElement;
  unmount(): void;
} {
  const handlers: CaptureHandlers = {
    onCommitStroke: vi.fn(() => Promise.resolve(true)),
    onCommitShape: vi.fn(() => Promise.resolve(true)),
    onErase: vi.fn(() => Promise.resolve()),
  };
  const view = render(
    <DrawingCaptureLayer
      page={makePage()}
      zoom={1}
      enabled
      tool="pen"
      color="#111827"
      width={3}
      notes={[]}
      {...handlers}
      {...overrides}
    />,
  );
  const layer = view.container.querySelector<HTMLElement>(
    '.drawing-capture-layer',
  );
  if (layer === null) {
    throw new Error('drawing capture layer not rendered');
  }
  layer.getBoundingClientRect = () =>
    rect(LAYER_LEFT, LAYER_TOP, PAGE_WIDTH, PAGE_HEIGHT);
  return { ...handlers, layer, container: view.container, unmount: view.unmount };
}

function drag(
  layer: HTMLElement,
  from: [number, number],
  via: [number, number],
  to: [number, number],
): void {
  const [startX, startY] = screenPoint(from[0], from[1]);
  const [viaX, viaY] = screenPoint(via[0], via[1]);
  const [endX, endY] = screenPoint(to[0], to[1]);
  fireEvent.pointerDown(layer, pointerInit(startX, startY));
  fireEvent.pointerMove(layer, pointerInit(viaX, viaY));
  fireEvent.pointerUp(layer, pointerInit(endX, endY));
}

beforeEach(() => {
  setPointerCapture = vi.fn();
  releasePointerCapture = vi.fn();
  hasPointerCapture = vi.fn(() => true);
  // jsdom does not implement pointer capture; provide the surface the
  // component uses without changing its behavior.
  Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
    configurable: true,
    value: setPointerCapture,
  });
  Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', {
    configurable: true,
    value: releasePointerCapture,
  });
  Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', {
    configurable: true,
    value: hasPointerCapture,
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  for (const name of [
    'setPointerCapture',
    'releasePointerCapture',
    'hasPointerCapture',
  ]) {
    delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name];
  }
});

describe('DrawingLayer', () => {
  it('把归一化笔迹映射到显示坐标并随缩放加粗', () => {
    const { container } = renderLayer(
      [
        makeNote({
          drawing: makeStroke(
            [
              [0.1, 0.1],
              [0.5, 0.5],
            ],
            { color: '#ef4444', width: 3 },
          ),
        }),
      ],
      // The page box passed by PdfPage already includes the zoom scale.
      { pageWidth: PAGE_WIDTH * 2, pageHeight: PAGE_HEIGHT * 2, zoom: 2 },
    );
    const polyline = container.querySelector('polyline');
    expect(polyline).not.toBeNull();
    expect(polyline?.getAttribute('points')).toBe('80,1080 400,600');
    expect(polyline?.getAttribute('stroke')).toBe('#ef4444');
    expect(polyline?.getAttribute('stroke-width')).toBe('6');
    expect(polyline?.getAttribute('opacity')).toBe('1');
  });

  it('旋转 90 度的页面按显示坐标系映射笔迹', () => {
    const { container } = renderLayer(
      [
        makeNote({
          drawing: makeStroke([
            [0.1, 0.2],
            [0.3, 0.4],
          ]),
        }),
      ],
      { rotation: 90 },
    );
    expect(container.querySelector('polyline')?.getAttribute('points')).toBe(
      '80,60 160,180',
    );
  });

  it('直线、矩形与椭圆生成对应的 SVG 元素', () => {
    const { container } = renderLayer([
      makeNote({
        id: 1,
        kind: 'shape',
        drawing: makeShape('line', [0.2, 0.2], [0.8, 0.8], { width: 2 }),
      }),
      makeNote({
        id: 2,
        kind: 'shape',
        drawing: makeShape('rect', [0.25, 0.25], [0.75, 0.75]),
      }),
      makeNote({
        id: 3,
        kind: 'shape',
        drawing: makeShape('ellipse', [0.25, 0.25], [0.75, 0.75]),
      }),
    ]);

    const line = container.querySelector('line');
    // 1 - 0.8 is not exactly representable, so compare numerically.
    expect(Number(line?.getAttribute('x1'))).toBeCloseTo(80);
    expect(Number(line?.getAttribute('y1'))).toBeCloseTo(480);
    expect(Number(line?.getAttribute('x2'))).toBeCloseTo(320);
    expect(Number(line?.getAttribute('y2'))).toBeCloseTo(120);
    expect(line?.getAttribute('stroke-width')).toBe('2');
    expect(line?.hasAttribute('marker-end')).toBe(false);

    const box = container.querySelector('rect');
    expect(box?.getAttribute('x')).toBe('100');
    expect(box?.getAttribute('y')).toBe('150');
    expect(box?.getAttribute('width')).toBe('200');
    expect(box?.getAttribute('height')).toBe('300');

    const ellipse = container.querySelector('ellipse');
    expect(ellipse?.getAttribute('cx')).toBe('200');
    expect(ellipse?.getAttribute('cy')).toBe('300');
    expect(ellipse?.getAttribute('rx')).toBe('100');
    expect(ellipse?.getAttribute('ry')).toBe('150');
  });

  it('荧光笔保留存储透明度与线宽', () => {
    const { container } = renderLayer([
      makeNote({
        drawing: makeStroke(
          [
            [0, 0],
            [1, 1],
          ],
          {
            tool: 'highlighter',
            color: '#eab308',
            width: 16,
            opacity: 0.35,
          },
        ),
      }),
    ]);
    const polyline = container.querySelector('polyline');
    expect(polyline?.getAttribute('opacity')).toBe('0.35');
    expect(polyline?.getAttribute('stroke-width')).toBe('16');
  });

  it('箭头使用笔记唯一的 marker id 并显式填充颜色', () => {
    const { container } = renderLayer([
      makeNote({
        id: 7,
        kind: 'shape',
        drawing: makeShape('arrow', [0.1, 0.1], [0.9, 0.9], {
          color: '#22c55e',
        }),
      }),
      makeNote({
        id: 8,
        kind: 'shape',
        drawing: makeShape('arrow', [0.2, 0.2], [0.8, 0.8], {
          color: '#3b82f6',
        }),
      }),
    ]);

    const markers = Array.from(container.querySelectorAll('marker'));
    expect(markers).toHaveLength(2);
    const ids = markers.map((marker) => marker.getAttribute('id'));
    expect(new Set(ids).size).toBe(2);
    expect(markers[0].querySelector('polygon')?.getAttribute('fill')).toBe(
      '#22c55e',
    );
    expect(markers[1].querySelector('polygon')?.getAttribute('fill')).toBe(
      '#3b82f6',
    );

    const lines = Array.from(container.querySelectorAll('line'));
    expect(lines).toHaveLength(2);
    expect(lines[0].getAttribute('marker-end')).toBe(`url(#${ids[0]})`);
    expect(lines[1].getAttribute('marker-end')).toBe(`url(#${ids[1]})`);
  });

  it('跳过绘制数据为空的损坏记录', () => {
    const { container } = renderLayer([
      makeNote({ id: 1, kind: 'ink', drawing: null }),
      makeNote({ id: 2, drawing: makeStroke([[0.1, 0.1], [0.2, 0.2]]) }),
      makeNote({ id: 3, kind: 'note', drawing: null }),
    ]);
    expect(container.querySelectorAll('polyline')).toHaveLength(1);
    expect(container.querySelectorAll('line')).toHaveLength(0);
  });
});

describe('DrawingCaptureLayer', () => {
  it('未启用时不渲染捕获层', () => {
    const { container } = render(
      <DrawingCaptureLayer
        page={makePage()}
        zoom={1}
        enabled={false}
        tool="pen"
        color="#111827"
        width={3}
        notes={[]}
        onCommitStroke={vi.fn(() => Promise.resolve(true))}
        onCommitShape={vi.fn(() => Promise.resolve(true))}
        onErase={vi.fn(() => Promise.resolve())}
      />,
    );
    expect(container.querySelector('.drawing-capture-layer')).toBeNull();
  });

  it('非主键按下直接返回', () => {
    const { layer, onCommitStroke } = renderCapture();
    fireEvent.pointerDown(layer, pointerInit(50, 80, { button: 2 }));
    expect(setPointerCapture).not.toHaveBeenCalled();
    expect(layer.querySelector('.annotation-drawing-draft')).toBeNull();
    fireEvent.pointerUp(layer, pointerInit(50, 80, { buttons: 0 }));
    expect(onCommitStroke).not.toHaveBeenCalled();
  });

  it('笔迹按下/移动/抬起后简化并提交归一化点', () => {
    const { layer, onCommitStroke } = renderCapture();
    drag(layer, [0.1, 0.9], [0.5, 0.6], [0.6, 0.4]);
    expect(setPointerCapture).toHaveBeenCalledWith(1);
    expect(onCommitStroke).toHaveBeenCalledTimes(1);
    expect(onCommitStroke).toHaveBeenCalledWith({
      tool: 'pen',
      color: '#111827',
      width: 3,
      opacity: 1,
      points: [
        [0.1, 0.9],
        [0.5, 0.6],
        [0.6, 0.4],
      ],
    });
    expect(releasePointerCapture).toHaveBeenCalledWith(1);
    expect(layer.querySelector('.annotation-drawing-draft')).toBeNull();
  });

  it('高亮笔迹使用荧光笔透明度', () => {
    const { layer, onCommitStroke } = renderCapture({
      tool: 'highlighter',
      width: 16,
    });
    drag(layer, [0.1, 0.9], [0.5, 0.6], [0.6, 0.4]);
    expect(onCommitStroke).toHaveBeenCalledWith(
      expect.objectContaining({
        tool: 'highlighter',
        width: 16,
        opacity: 0.35,
      }),
    );
  });

  it('只有按下没有移动时笔迹点数不足，不提交', () => {
    const { layer, onCommitStroke } = renderCapture();
    fireEvent.pointerDown(layer, pointerInit(...screenPoint(0.2, 0.3)));
    fireEvent.pointerUp(layer, pointerInit(...screenPoint(0.2, 0.3), { buttons: 0 }));
    expect(onCommitStroke).not.toHaveBeenCalled();
  });

  it('图形拖动超过 2px 后提交归一化起止点', () => {
    const { layer, onCommitShape } = renderCapture({ tool: 'rect' });
    drag(layer, [0.1, 0.9], [0.5, 0.6], [0.6, 0.4]);
    expect(onCommitShape).toHaveBeenCalledTimes(1);
    expect(onCommitShape).toHaveBeenCalledWith({
      shape: 'rect',
      color: '#111827',
      width: 3,
      opacity: 1,
      start: [0.1, 0.9],
      end: [0.6, 0.4],
    });
    expect(layer.querySelector('.annotation-drawing-draft')).toBeNull();
  });

  it('图形拖动不超过 2px 时不提交', () => {
    const { layer, onCommitShape } = renderCapture({ tool: 'line' });
    const [x, y] = screenPoint(0.2, 0.3);
    fireEvent.pointerDown(layer, pointerInit(x, y));
    fireEvent.pointerUp(layer, pointerInit(x + 1, y + 1, { buttons: 0 }));
    expect(onCommitShape).not.toHaveBeenCalled();
    expect(layer.querySelector('.annotation-drawing-draft')).toBeNull();
  });

  it('橡皮按下命中时立即删除最上层对象且不开始框选', () => {
    const bottom = makeNote({
      id: 1,
      kind: 'shape',
      drawing: makeShape('rect', [0.2, 0.2], [0.4, 0.4]),
    });
    const top = makeNote({
      id: 2,
      kind: 'shape',
      drawing: makeShape('rect', [0.2, 0.2], [0.4, 0.4]),
    });
    const { layer, onErase } = renderCapture({
      tool: 'eraser',
      notes: [bottom, top],
    });
    fireEvent.pointerDown(layer, pointerInit(...screenPoint(0.3, 0.3)));
    expect(onErase).toHaveBeenCalledTimes(1);
    expect(onErase).toHaveBeenCalledWith([top]);
    expect(setPointerCapture).not.toHaveBeenCalled();
    expect(layer.querySelector('.annotation-drawing-draft')).toBeNull();
    fireEvent.pointerUp(layer, pointerInit(...screenPoint(0.3, 0.3), { buttons: 0 }));
    expect(onErase).toHaveBeenCalledTimes(1);
  });

  it('橡皮容差按屏边距加半线宽换算，细线边缘也能命中', () => {
    const line = makeNote({
      id: 5,
      kind: 'shape',
      drawing: makeShape('line', [0.2, 0.5], [0.8, 0.5], { width: 3 }),
    });
    const hit = renderCapture({ tool: 'eraser', notes: [line] });
    // tolerance = (6 + 3/2) / min(400, 600) = 0.01875.
    fireEvent.pointerDown(hit.layer, pointerInit(...screenPoint(0.5, 0.518)));
    expect(hit.onErase).toHaveBeenCalledWith([line]);
    hit.unmount();

    const miss = renderCapture({ tool: 'eraser', notes: [line] });
    fireEvent.pointerDown(miss.layer, pointerInit(...screenPoint(0.5, 0.52)));
    expect(miss.onErase).not.toHaveBeenCalled();
  });

  it('橡皮空白处拖动框选删除相交对象，不删未相交对象', () => {
    const inside = makeNote({
      id: 1,
      kind: 'shape',
      drawing: makeShape('rect', [0.2, 0.2], [0.4, 0.4]),
    });
    const outside = makeNote({
      id: 2,
      kind: 'shape',
      drawing: makeShape('rect', [0.7, 0.7], [0.9, 0.9]),
    });
    const textNote = makeNote({ id: 3, kind: 'note', drawing: null });
    const { layer, onErase } = renderCapture({
      tool: 'eraser',
      notes: [inside, outside, textNote],
    });
    fireEvent.pointerDown(layer, pointerInit(...screenPoint(0.05, 0.05)));
    fireEvent.pointerMove(layer, pointerInit(...screenPoint(0.3, 0.3)));
    fireEvent.pointerUp(layer, pointerInit(...screenPoint(0.5, 0.5), { buttons: 0 }));
    expect(onErase).toHaveBeenCalledTimes(1);
    expect(onErase).toHaveBeenCalledWith([inside]);
  });

  it('pointercancel 丢弃草稿且不提交', () => {
    const { layer, onCommitStroke } = renderCapture();
    const [x, y] = screenPoint(0.2, 0.3);
    fireEvent.pointerDown(layer, pointerInit(x, y));
    fireEvent.pointerMove(layer, pointerInit(x + 40, y - 40));
    expect(layer.querySelector('.annotation-drawing-draft')).not.toBeNull();
    fireEvent.pointerCancel(layer, pointerInit(x + 40, y - 40));
    expect(layer.querySelector('.annotation-drawing-draft')).toBeNull();
    expect(onCommitStroke).not.toHaveBeenCalled();
  });

  it('第二个指针不能开始第二次手势', () => {
    const { layer, onCommitShape } = renderCapture({ tool: 'rect' });
    const [x, y] = screenPoint(0.2, 0.3);
    fireEvent.pointerDown(layer, pointerInit(x, y, { pointerId: 1 }));
    fireEvent.pointerDown(layer, pointerInit(x + 20, y + 20, { pointerId: 2 }));
    fireEvent.pointerUp(layer, pointerInit(x + 40, y + 40, { pointerId: 2, buttons: 0 }));
    expect(onCommitShape).not.toHaveBeenCalled();
  });
});
