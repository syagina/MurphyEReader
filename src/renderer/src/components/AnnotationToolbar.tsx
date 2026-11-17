import { useEffect, useRef, useState } from 'react';
import type { AnnotationMarkStyle } from '@shared/types';
import { markFamily } from '../lib/annotation-marks';
import type { AnnotationMarkFamily } from '../lib/annotation-marks';
import {
  HIGHLIGHT_SWATCHES,
  MARK_SWATCHES,
} from '../lib/annotation-options';

export interface AnnotationToolbarProps {
  disabled: boolean;
  hasSelection: boolean;
  /** 便签模式激活：右键点击页面可在该位置添加便签。 */
  noteMode?: boolean;
  onCreateNote(): void;
  onApplyMark(style: AnnotationMarkStyle, color: string): void;
  onClearMark(family: AnnotationMarkFamily): void;
  /** 绘制模式激活时「绘制」按钮显示按下态，标记与便签禁用。 */
  drawingMode?: boolean;
  onToggleDrawing?(): void;
  /** 标注菜单展开/收起时通知外部，用于隐藏会遮挡菜单的选区浮动栏。 */
  onMenuOpenChange?(open: boolean): void;
}

/** Every text-mark style lives inside the unified 标注 menu. */
const MARK_STYLE_CHOICES: ReadonlyArray<{
  style: AnnotationMarkStyle;
  label: string;
}> = [
  { style: 'highlight', label: '高亮' },
  { style: 'underline', label: '下划线' },
  { style: 'double-underline', label: '双线' },
  { style: 'dotted-underline', label: '虚线' },
  { style: 'wavy-underline', label: '波浪线' },
  { style: 'strikeout', label: '删除线' },
];

/**
 * Reader toolbar actions: one 标注 menu (all mark styles plus colour), the
 * note entry, and drawing mode. Sits inline with search and the rest of the
 * reader toolbar. Every button swallows `mousedown` so clicking the toolbar
 * never clears the PDF text selection the command is about to use.
 */
export function AnnotationToolbar({
  disabled,
  hasSelection,
  noteMode = false,
  onCreateNote,
  onApplyMark,
  onClearMark,
  drawingMode = false,
  onToggleDrawing,
  onMenuOpenChange,
}: AnnotationToolbarProps): React.JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false);
  const [selectedStyle, setSelectedStyle] =
    useState<AnnotationMarkStyle>('highlight');
  const rootRef = useRef<HTMLDivElement | null>(null);
  const marksDisabled = disabled || drawingMode || !hasSelection;
  const family = markFamily(selectedStyle);
  const swatches =
    selectedStyle === 'highlight' ? HIGHLIGHT_SWATCHES : MARK_SWATCHES;

  const keepSelection = (event: React.MouseEvent<HTMLButtonElement>): void => {
    event.preventDefault();
  };

  useEffect(() => {
    onMenuOpenChange?.(menuOpen);
  }, [menuOpen, onMenuOpenChange]);

  // An open menu must not outlive the state that made it usable.
  useEffect(() => {
    if (marksDisabled) {
      setMenuOpen(false);
    }
  }, [marksDisabled]);

  // Click outside the toolbar (or press Esc) closes the annotation menu.
  useEffect(() => {
    if (!menuOpen) {
      return;
    }
    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (
        target instanceof Node &&
        rootRef.current !== null &&
        rootRef.current.contains(target)
      ) {
        return;
      }
      setMenuOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
      }
    };
    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [menuOpen]);

  return (
    <div
      ref={rootRef}
      className="annotation-toolbar-actions"
      data-keep-selection="true"
      role="toolbar"
      aria-label="标注工具栏"
    >
      <div className="annotation-toolbar-menu-wrap">
        <button
          type="button"
          className={
            menuOpen
              ? 'annotation-toolbar-button active'
              : 'annotation-toolbar-button'
          }
          aria-label="标注"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          title={marksDisabled ? '请先选中文字' : '给选中文字添加标注'}
          disabled={marksDisabled}
          onMouseDown={keepSelection}
          onClick={() => setMenuOpen((current) => !current)}
        >
          标注 ▾
        </button>
        {menuOpen && (
          <div
            className="annotation-mark-menu annotation-mark-menu--annotation"
            role="group"
            aria-label="标注样式与颜色"
          >
            <div
              className="annotation-style-row"
              role="group"
              aria-label="标注样式"
            >
              {MARK_STYLE_CHOICES.map(({ style, label }) => (
                <button
                  key={style}
                  type="button"
                  className="annotation-menu-action"
                  aria-pressed={selectedStyle === style}
                  disabled={marksDisabled}
                  onMouseDown={keepSelection}
                  onClick={() => setSelectedStyle(style)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div
              className="annotation-swatch-row"
              role="group"
              aria-label="标注颜色"
            >
              {swatches.map(({ color, label }) => (
                <button
                  key={color}
                  type="button"
                  className="annotation-swatch"
                  aria-label={label}
                  title={color}
                  style={{ backgroundColor: color }}
                  disabled={marksDisabled}
                  onMouseDown={keepSelection}
                  onClick={() => {
                    onApplyMark(selectedStyle, color);
                    setMenuOpen(false);
                  }}
                />
              ))}
            </div>
            <button
              type="button"
              className="annotation-menu-action"
              disabled={marksDisabled}
              onMouseDown={keepSelection}
              onClick={() => {
                if (family !== null) {
                  onClearMark(family);
                }
                setMenuOpen(false);
              }}
            >
              无标记
            </button>
          </div>
        )}
      </div>

      <button
        type="button"
        className={
          noteMode
            ? 'annotation-toolbar-button active'
            : 'annotation-toolbar-button'
        }
        aria-label="便签"
        aria-pressed={noteMode}
        title={
          noteMode
            ? '便签模式已开启：右键点击页面添加便签（Esc 退出）'
            : '为选区添加便签，或开启右键添加便签模式'
        }
        disabled={disabled || drawingMode}
        onMouseDown={keepSelection}
        onClick={() => {
          setMenuOpen(false);
          onCreateNote();
        }}
      >
        便签
      </button>

      <button
        type="button"
        className={
          drawingMode
            ? 'annotation-toolbar-button active'
            : 'annotation-toolbar-button'
        }
        aria-label="绘制"
        aria-pressed={drawingMode}
        title={drawingMode ? '退出绘制模式（Esc）' : '在 PDF 上绘制'}
        disabled={disabled}
        onMouseDown={keepSelection}
        onClick={() => {
          setMenuOpen(false);
          onToggleDrawing?.();
        }}
      >
        绘制
      </button>
    </div>
  );
}
