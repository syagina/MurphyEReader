import type { AnnotationMarkStyle } from '@shared/types';
import { HIGHLIGHT_COLORS, MARK_COLORS } from './annotation-colors';
import type { PopupMode } from './sticky-note-geometry';

export interface AnnotationSwatch {
  color: string;
  label: string;
}

/** Swatch accessible names, aligned with the fixed palettes by colour. */
const HIGHLIGHT_LABELS: Record<(typeof HIGHLIGHT_COLORS)[number], string> = {
  '#facc15': '高亮黄色',
  '#4ade80': '高亮绿色',
  '#60a5fa': '高亮蓝色',
  '#f472b6': '高亮粉色',
  '#c084fc': '高亮紫色',
};

const MARK_LABELS: Record<(typeof MARK_COLORS)[number], string> = {
  '#ef4444': '下划线红色',
  '#f97316': '下划线橙色',
  '#eab308': '下划线黄色',
  '#22c55e': '下划线绿色',
  '#3b82f6': '下划线蓝色',
  '#a855f7': '下划线紫色',
  '#000000': '下划线黑色',
};

export const HIGHLIGHT_SWATCHES: readonly AnnotationSwatch[] =
  HIGHLIGHT_COLORS.map((color) => ({
    color,
    label: HIGHLIGHT_LABELS[color],
  }));

export const MARK_SWATCHES: readonly AnnotationSwatch[] = MARK_COLORS.map(
  (color) => ({
    color,
    label: MARK_LABELS[color],
  }),
);

/** Highlight and mark styles use separate fixed palettes. */
export function swatchesForStyle(
  style: AnnotationMarkStyle,
): readonly AnnotationSwatch[] {
  return style === 'highlight' ? HIGHLIGHT_SWATCHES : MARK_SWATCHES;
}

/** Whether `color` belongs to the fixed palette of `style`. */
export function paletteHasColor(
  style: AnnotationMarkStyle,
  color: string | null,
): boolean {
  return (
    color !== null &&
    swatchesForStyle(style).some((swatch) => swatch.color === color)
  );
}

export interface MarkStyleOption {
  style: AnnotationMarkStyle;
  label: string;
}

/** Every display style a text annotation can take. */
export const MARK_STYLE_OPTIONS: readonly MarkStyleOption[] = [
  { style: 'highlight', label: '高亮' },
  { style: 'underline', label: '下划线' },
  { style: 'double-underline', label: '双下划线' },
  { style: 'dotted-underline', label: '虚线下划线' },
  { style: 'wavy-underline', label: '波浪下划线' },
  { style: 'strikeout', label: '删除线' },
  { style: 'none', label: '不做正文标记' },
];

export interface PopupModeOption {
  mode: PopupMode;
  label: string;
}

/** Where an annotation popup opens. */
export const POPUP_MODE_OPTIONS: readonly PopupModeOption[] = [
  { mode: 'anchor', label: '跟随标记' },
  { mode: 'right', label: '固定右侧' },
  { mode: 'free', label: '自由位置' },
];
