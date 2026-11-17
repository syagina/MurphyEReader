import { DRAWING_COLORS } from '../lib/annotation-colors';
import type { DrawingTool } from '../lib/annotation-drawing';

export interface DrawingToolbarProps {
  tool: DrawingTool;
  color: string;
  width: number;
  canUndo: boolean;
  canRedo: boolean;
  onToolChange(tool: DrawingTool): void;
  onColorChange(color: string): void;
  onWidthChange(width: number): void;
  onUndo(): void;
  onRedo(): void;
  onClearPage(): void;
  onExit(): void;
}

const TOOL_OPTIONS: ReadonlyArray<{ tool: DrawingTool; label: string }> = [
  { tool: 'pen', label: '笔' },
  { tool: 'highlighter', label: '荧光笔' },
  { tool: 'line', label: '直线' },
  { tool: 'rect', label: '矩形' },
  { tool: 'ellipse', label: '椭圆' },
  { tool: 'arrow', label: '箭头' },
  { tool: 'eraser', label: '橡皮' },
];

/** 固定绘制调色板的可访问名，与 DRAWING_COLORS 一一对应。 */
const COLOR_LABELS: Record<(typeof DRAWING_COLORS)[number], string> = {
  '#111827': '黑色',
  '#ef4444': '红色',
  '#f97316': '橙色',
  '#eab308': '黄色',
  '#22c55e': '绿色',
  '#3b82f6': '蓝色',
  '#a855f7': '紫色',
};

const WIDTH_OPTIONS = [1, 2, 3, 4, 8, 12, 16, 24] as const;

/**
 * 绘制模式下的工具栏：纯展示，所有状态与历史都由 PdfViewer 持有。
 */
export function DrawingToolbar({
  tool,
  color,
  width,
  canUndo,
  canRedo,
  onToolChange,
  onColorChange,
  onWidthChange,
  onUndo,
  onRedo,
  onClearPage,
  onExit,
}: DrawingToolbarProps): React.JSX.Element {
  return (
    <div className="drawing-toolbar" role="toolbar" aria-label="绘制工具栏">
      {TOOL_OPTIONS.map(({ tool: value, label }) => (
        <button
          key={value}
          type="button"
          className="annotation-toolbar-button"
          aria-label={label}
          aria-pressed={tool === value}
          onClick={() => onToolChange(value)}
        >
          {label}
        </button>
      ))}
      <span className="annotation-toolbar-label">颜色：</span>
      {DRAWING_COLORS.map((swatchColor) => (
        <button
          key={swatchColor}
          type="button"
          className="annotation-swatch"
          aria-label={COLOR_LABELS[swatchColor]}
          aria-pressed={color === swatchColor}
          title={swatchColor}
          style={{ backgroundColor: swatchColor }}
          onClick={() => onColorChange(swatchColor)}
        />
      ))}
      <span className="annotation-toolbar-label">粗细：</span>
      {WIDTH_OPTIONS.map((option) => (
        <button
          key={option}
          type="button"
          className="annotation-toolbar-button"
          aria-label={`粗细 ${option}`}
          aria-pressed={width === option}
          onClick={() => onWidthChange(option)}
        >
          {option}
        </button>
      ))}
      <button
        type="button"
        className="annotation-toolbar-button"
        disabled={!canUndo}
        onClick={onUndo}
      >
        撤销
      </button>
      <button
        type="button"
        className="annotation-toolbar-button"
        disabled={!canRedo}
        onClick={onRedo}
      >
        重做
      </button>
      <button
        type="button"
        className="annotation-toolbar-button"
        onClick={onClearPage}
      >
        清空本页
      </button>
      <button
        type="button"
        className="annotation-toolbar-button"
        onClick={onExit}
      >
        完成
      </button>
    </div>
  );
}
