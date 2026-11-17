import { describe, expect, it } from 'vitest';
import type {
  AnnotationShapeData,
  AnnotationStroke,
} from '@shared/types';
import {
  HIGHLIGHTER_OPACITY,
  MAX_STROKE_POINTS,
  annotationBounds,
  clampNormalizedPoint,
  distanceToPolyline,
  distanceToSegment,
  drawingIntersectsRect,
  drawingKind,
  hitTestDrawing,
  limitPoints,
  pdfNormalizedToDisplay,
  screenPointToPdfNormalized,
  simplifyPoints,
} from '@renderer/lib/annotation-drawing';
import type { PdfViewportLike } from '@renderer/lib/annotation-drawing';

function makeStroke(points: Array<[number, number]>): AnnotationStroke {
  return { tool: 'pen', color: '#111827', width: 2, opacity: 1, points };
}

function makeShape(
  kind: AnnotationShapeData['shape'],
  start: [number, number],
  end: [number, number],
): AnnotationShapeData {
  return {
    shape: kind,
    color: '#111827',
    width: 2,
    opacity: 1,
    start,
    end,
  };
}

describe('常量', () => {
  it('高亮透明度与单笔点数上限固定', () => {
    expect(HIGHLIGHTER_OPACITY).toBe(0.35);
    expect(MAX_STROKE_POINTS).toBe(4000);
  });
});

describe('drawingKind', () => {
  it('带 tool 的是笔迹，带 shape 的是图形', () => {
    expect(drawingKind(makeStroke([[0, 0]]))).toBe('ink');
    expect(drawingKind(makeShape('rect', [0, 0], [1, 1]))).toBe('shape');
  });
});

describe('clampNormalizedPoint', () => {
  it('夹紧越界坐标', () => {
    expect(clampNormalizedPoint([0.5, 0.5])).toEqual([0.5, 0.5]);
    expect(clampNormalizedPoint([-0.2, 1.2])).toEqual([0, 1]);
  });

  it('非有限坐标归零', () => {
    expect(clampNormalizedPoint([Number.NaN, 0.5])).toEqual([0, 0.5]);
    expect(clampNormalizedPoint([Infinity, -Infinity])).toEqual([0, 0]);
  });
});

describe('simplifyPoints', () => {
  it('简化掉近共线点并保留首尾', () => {
    expect(simplifyPoints([[0, 0], [0.5, 0.0001], [1, 0]], 0.001)).toEqual([[0, 0], [1, 0]]);
  });

  it('少于三点原样返回副本', () => {
    const points: Array<[number, number]> = [[0.25, 0.25], [0.75, 0.75]];
    const simplified = simplifyPoints(points);
    expect(simplified).toEqual(points);
    expect(simplified).not.toBe(points);
  });

  it('非有限或负容差按 0 处理，不丢转折点', () => {
    const points: Array<[number, number]> = [[0, 0], [0.5, 0.0001], [1, 0]];
    expect(simplifyPoints(points, Number.NaN)).toHaveLength(3);
    expect(simplifyPoints(points, -0.5)).toHaveLength(3);
  });

  it('保留明显转折点', () => {
    expect(
      simplifyPoints([[0, 0], [0.5, 0.5], [1, 0]], 0.001),
    ).toEqual([[0, 0], [0.5, 0.5], [1, 0]]);
  });
});

describe('limitPoints', () => {
  it('点上限取首尾并均匀抽样', () => {
    const points = Array.from({ length: 5000 }, (_, i) => [i / 5000, 0] as [number, number]);
    const limited = limitPoints(points, 4000);
    expect(limited).toHaveLength(4000);
    expect(limited[0]).toEqual([0, 0]);
    expect(limited.at(-1)).toEqual(points.at(-1));
  });

  it('max=1 只保留首点', () => {
    expect(limitPoints([[0.1, 0.1], [0.5, 0.5], [0.9, 0.9]], 1)).toEqual([
      [0.1, 0.1],
    ]);
  });

  it('空数组返回空数组', () => {
    expect(limitPoints([], 5)).toEqual([]);
  });

  it('未超过上限时返回副本', () => {
    const points: Array<[number, number]> = [[0, 0], [1, 1]];
    const limited = limitPoints(points, 5);
    expect(limited).toEqual(points);
    expect(limited).not.toBe(points);
    expect(limited[0]).not.toBe(points[0]);
  });

  it('恰好返回 max 个等步长抽样点', () => {
    const points: Array<[number, number]> = [
      [0, 0],
      [1, 0],
      [2, 0],
      [3, 0],
      [4, 0],
    ];
    expect(limitPoints(points, 3)).toEqual([
      [0, 0],
      [2, 0],
      [4, 0],
    ]);
  });
});

describe('distanceToSegment / distanceToPolyline', () => {
  it('点到线段的最短距离含端点', () => {
    expect(distanceToSegment([0, 1], [0, 0], [1, 0])).toBe(1);
    expect(distanceToSegment([0.5, 0], [0, 0], [1, 0])).toBe(0);
    expect(distanceToSegment([2, 0], [0, 0], [1, 0])).toBe(1);
  });

  it('退化线段取到端点的距离', () => {
    expect(distanceToSegment([1, 1], [0, 0], [0, 0])).toBeCloseTo(Math.SQRT2);
  });

  it('空折线为 Infinity，单点取点距', () => {
    expect(distanceToPolyline([], [0.5, 0.5])).toBe(Infinity);
    expect(distanceToPolyline([[0.5, 0.5]], [0.5, 0.5])).toBe(0);
    expect(distanceToPolyline([[0, 0]], [0.3, 0.4])).toBeCloseTo(0.5);
  });

  it('多段折线取各段最小值', () => {
    expect(
      distanceToPolyline([[0, 0], [1, 0], [1, 1]], [0.5, 0.5]),
    ).toBe(0.5);
  });
});

describe('annotationBounds', () => {
  it('笔迹包围盒取所有点', () => {
    expect(
      annotationBounds(
        makeStroke([[0.25, 0.25], [0.75, 0.75], [0.5, 0.5]]),
      ),
    ).toEqual({ x: 0.25, y: 0.25, width: 0.5, height: 0.5 });
  });

  it('空笔迹返回零矩形', () => {
    expect(annotationBounds(makeStroke([]))).toEqual({
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    });
  });

  it('图形包围盒覆盖起点终点，与方向无关', () => {
    expect(
      annotationBounds(makeShape('line', [0.75, 0.25], [0.25, 0.75])),
    ).toEqual({ x: 0.25, y: 0.25, width: 0.5, height: 0.5 });
  });
});

describe('hitTestDrawing', () => {
  it('橡皮命中笔迹/矩形/椭圆', () => {
    const stroke = {
      tool: 'pen' as const,
      color: '#111827',
      width: 2,
      opacity: 1,
      points: [[0.1, 0.1], [0.9, 0.9]] as Array<[number, number]>,
    };
    expect(hitTestDrawing(stroke, [0.5, 0.5], 0.01)).toBe(true);
    expect(hitTestDrawing(stroke, [0.1, 0.9], 0.01)).toBe(false);
  });

  it('矩形内部（含边界）命中，四边容差内也命中', () => {
    const rect = makeShape('rect', [0.2, 0.2], [0.6, 0.6]);
    expect(hitTestDrawing(rect, [0.4, 0.4], 0)).toBe(true);
    expect(hitTestDrawing(rect, [0.6, 0.6], 0)).toBe(true);
    expect(hitTestDrawing(rect, [0.15, 0.4], 0.06)).toBe(true);
    expect(hitTestDrawing(rect, [0.1, 0.4], 0)).toBe(false);
  });

  it('椭圆内部与边界命中，外部角落不命中', () => {
    const ellipse = makeShape('ellipse', [0.25, 0.25], [0.75, 0.75]);
    expect(hitTestDrawing(ellipse, [0.5, 0.5], 0)).toBe(true);
    expect(hitTestDrawing(ellipse, [0.25, 0.5], 0)).toBe(true);
    expect(hitTestDrawing(ellipse, [0.5, 0.77], 0.03)).toBe(true);
    expect(hitTestDrawing(ellipse, [0.25, 0.25], 0)).toBe(false);
  });

  it('椭圆边界距离按采样折线而非顶点计算', () => {
    const ellipse = makeShape('ellipse', [0.2, 0.2], [0.8, 0.8]);
    // 半径 0.3 的椭圆，在采样角 0°/5.625° 的中间角度上、解析边界外 0.001：
    // 到最近采样顶点约 0.0148，到采样折线约 0.0014。
    const angle = (2.8125 * Math.PI) / 180;
    const click: [number, number] = [
      0.5 + 0.301 * Math.cos(angle),
      0.5 + 0.301 * Math.sin(angle),
    ];
    expect(hitTestDrawing(ellipse, click, 0.0126)).toBe(true);
    expect(hitTestDrawing(ellipse, click, 0.001)).toBe(false);
  });

  it('椭圆边界包含 354.375°→0° 的闭合段', () => {
    const ellipse = makeShape('ellipse', [0.2, 0.2], [0.8, 0.8]);
    // 接缝中点 357.1875°，解析边界外 0.001：到最近采样端点约 0.0148，
    // 到 354.375°→0° 闭合弦约 0.0014。
    const angle = (357.1875 * Math.PI) / 180;
    const click: [number, number] = [
      0.5 + 0.301 * Math.cos(angle),
      0.5 + 0.301 * Math.sin(angle),
    ];
    expect(hitTestDrawing(ellipse, click, 0.0126)).toBe(true);
    expect(hitTestDrawing(ellipse, click, 0.001)).toBe(false);
  });

  it('退化为线段的椭圆按线段命中', () => {
    const ellipse = makeShape('ellipse', [0.2, 0.4], [0.6, 0.4]);
    expect(hitTestDrawing(ellipse, [0.4, 0.4], 0)).toBe(true);
    expect(hitTestDrawing(ellipse, [0.4, 0.43], 0.05)).toBe(true);
    expect(hitTestDrawing(ellipse, [0.4, 0.5], 0.05)).toBe(false);
  });

  it('负容差与非有限容差按 0 处理', () => {
    const stroke = makeStroke([[0.1, 0.1], [0.9, 0.9]]);
    expect(hitTestDrawing(stroke, [0.5, 0.5], -1)).toBe(true);
    expect(hitTestDrawing(stroke, [0.5, 0.5], Number.NaN)).toBe(true);
    expect(hitTestDrawing(stroke, [0.2, 0.8], Number.NaN)).toBe(false);
  });

  it('直线与箭头按线段命中', () => {
    const line = makeShape('line', [0, 0.5], [1, 0.5]);
    const arrow = makeShape('arrow', [0, 0.5], [1, 0.5]);
    expect(hitTestDrawing(line, [0.5, 0.52], 0.03)).toBe(true);
    expect(hitTestDrawing(line, [0.5, 0.6], 0.03)).toBe(false);
    expect(hitTestDrawing(arrow, [0.5, 0.5], 0)).toBe(true);
  });
});

describe('drawingIntersectsRect', () => {
  it('框选与笔迹/图形相交', () => {
    const stroke = {
      tool: 'pen' as const,
      color: '#111827',
      width: 2,
      opacity: 1,
      points: [[0.1, 0.1], [0.9, 0.9]] as Array<[number, number]>,
    };
    const rect = { x: 0.4, y: 0.4, width: 0.2, height: 0.2 };
    expect(drawingIntersectsRect(stroke, rect)).toBe(true);
  });

  it('笔迹点落在框内或线段穿过框都算相交', () => {
    const rect = { x: 0.4, y: 0.4, width: 0.2, height: 0.2 };
    expect(drawingIntersectsRect(makeStroke([[0.5, 0.5]]), rect)).toBe(true);
    expect(
      drawingIntersectsRect(makeStroke([[0, 0.5], [1, 0.5]]), rect),
    ).toBe(true);
    expect(
      drawingIntersectsRect(makeStroke([[0.1, 0.1], [0.2, 0.1]]), rect),
    ).toBe(false);
  });

  it('直线、箭头与矩形按线段相交', () => {
    const rect = { x: 0.4, y: 0.4, width: 0.2, height: 0.2 };
    expect(
      drawingIntersectsRect(makeShape('line', [0, 0.5], [1, 0.5]), rect),
    ).toBe(true);
    expect(
      drawingIntersectsRect(makeShape('arrow', [0, 0.5], [1, 0.5]), rect),
    ).toBe(true);
    expect(
      drawingIntersectsRect(makeShape('line', [0, 0.1], [0.2, 0.1]), rect),
    ).toBe(false);
  });

  it('矩形与框选按轴对齐重叠判断，贴边也算', () => {
    const rect = { x: 0.4, y: 0.4, width: 0.2, height: 0.2 };
    expect(
      drawingIntersectsRect(makeShape('rect', [0.3, 0.3], [0.5, 0.5]), rect),
    ).toBe(true);
    expect(
      drawingIntersectsRect(makeShape('rect', [0.5, 0.5], [0.6, 0.6]), rect),
    ).toBe(true);
    expect(
      drawingIntersectsRect(makeShape('rect', [0.1, 0.1], [0.2, 0.2]), rect),
    ).toBe(false);
  });

  it('椭圆边界穿过框时相交，包围盒不重叠时不相交', () => {
    const ellipse = makeShape('ellipse', [0.2, 0.2], [0.6, 0.6]);
    expect(
      drawingIntersectsRect(ellipse, { x: 0.38, y: 0.58, width: 0.04, height: 0.04 }),
    ).toBe(true);
    expect(
      drawingIntersectsRect(ellipse, { x: 0.7, y: 0.7, width: 0.1, height: 0.1 }),
    ).toBe(false);
  });

  it('退化椭圆按线段相交', () => {
    const ellipse = makeShape('ellipse', [0.2, 0.5], [0.8, 0.5]);
    expect(
      drawingIntersectsRect(ellipse, { x: 0.4, y: 0.4, width: 0.2, height: 0.2 }),
    ).toBe(true);
    expect(
      drawingIntersectsRect(ellipse, { x: 0.4, y: 0.7, width: 0.2, height: 0.2 }),
    ).toBe(false);
  });
});

describe('pdfNormalizedToDisplay', () => {
  it('四向逆映射', () => {
    expect(pdfNormalizedToDisplay([0.2, 0.3], 0)).toEqual([0.2, 0.7]);
    expect(pdfNormalizedToDisplay([0.2, 0.3], 90)).toEqual([0.3, 0.2]);
    expect(pdfNormalizedToDisplay([0.2, 0.3], 180)).toEqual([0.8, 0.3]);
    expect(pdfNormalizedToDisplay([0.2, 0.3], 270)).toEqual([0.7, 0.8]);
  });

  it('旋转角先归一化到 0..359', () => {
    expect(pdfNormalizedToDisplay([0.25, 0.5], 450)).toEqual([0.5, 0.25]);
    expect(pdfNormalizedToDisplay([0.25, 0.5], -90)).toEqual([0.5, 0.75]);
  });

  it('非 0/90/180/270 的角按 0 处理', () => {
    expect(pdfNormalizedToDisplay([0.25, 0.5], 45)).toEqual([0.25, 0.5]);
    expect(pdfNormalizedToDisplay([0.25, 0.5], Number.NaN)).toEqual([
      0.25, 0.5,
    ]);
  });

  it('输出夹紧到 [0,1]', () => {
    expect(pdfNormalizedToDisplay([1.5, -0.5], 0)).toEqual([1, 1]);
  });
});

describe('screenPointToPdfNormalized', () => {
  it('viewport 坐标在 50%/200% 缩放下归一到同一点', () => {
    const make = (scale: number) => ({
      width: 600 * scale,
      height: 800 * scale,
      viewBox: [0, 0, 600, 800] as [number, number, number, number],
      convertToPdfPoint: (x: number, y: number) =>
        [x / scale, (800 * scale - y) / scale] as [number, number],
      convertToViewportPoint: (x: number, y: number) =>
        [x * scale, y * scale] as [number, number],
    });
    expect(screenPointToPdfNormalized(make(0.5), 150, 100)).toEqual([0.5, 0.75]);
    expect(screenPointToPdfNormalized(make(2), 600, 400)).toEqual([0.5, 0.75]);
  });

  it('viewBox 非正尺寸返回原点', () => {
    const viewport: PdfViewportLike = {
      width: 100,
      height: 100,
      viewBox: [0, 0, 0, 100],
      convertToPdfPoint: () => [50, 50],
    };
    expect(screenPointToPdfNormalized(viewport, 10, 10)).toEqual([0, 0]);
  });

  it('PDF 坐标非有限时返回原点', () => {
    const viewport: PdfViewportLike = {
      width: 100,
      height: 100,
      viewBox: [0, 0, 100, 100],
      convertToPdfPoint: () => [Number.NaN, 10],
    };
    expect(screenPointToPdfNormalized(viewport, 10, 10)).toEqual([0, 0]);
  });

  it('按 viewBox 原点归一化并夹紧', () => {
    const offset: PdfViewportLike = {
      width: 200,
      height: 400,
      viewBox: [50, 100, 200, 400],
      convertToPdfPoint: () => [150, 300],
    };
    expect(screenPointToPdfNormalized(offset, 1, 1)).toEqual([0.5, 0.5]);

    const outside: PdfViewportLike = {
      width: 100,
      height: 100,
      viewBox: [0, 0, 100, 100],
      convertToPdfPoint: () => [-50, 150],
    };
    expect(screenPointToPdfNormalized(outside, 0, 0)).toEqual([0, 1]);
  });
});
