import { useEffect, useRef, useState } from 'react';
import type {
  AnnotationMarkStyle,
  AnnotationPin,
  AnnotationPopupPlacement,
  PdfVersion,
  StickyNote,
  StickyNoteAnchor,
  StickyNoteSource,
} from '@shared/types';
import {
  PDF_VERSION_LABELS,
  STICKY_NOTE_LIMITS,
  STICKY_NOTE_SOURCE_LABELS,
} from '@shared/sticky-notes';
import { defaultMarkColor } from '../lib/annotation-colors';
import {
  MARK_STYLE_OPTIONS,
  POPUP_MODE_OPTIONS,
  paletteHasColor,
  swatchesForStyle,
} from '../lib/annotation-options';
import { pinForForm, popupForMode } from '../lib/sticky-note-geometry';
import type { PopupMode } from '../lib/sticky-note-geometry';
import { errorMessage } from '../lib/errors';

/** Everything the dialog edits; exactly one annotation update patch. */
export interface StickyNoteFormValue {
  contentMd: string;
  markStyle: AnnotationMarkStyle;
  color: string | null;
  pin: AnnotationPin | null;
  popup: AnnotationPopupPlacement | null;
}

/** Local form state before pin/popup placement is resolved. */
export interface StickyNoteFormState {
  contentMd: string;
  markStyle: AnnotationMarkStyle;
  color: string | null;
  pinVisible: boolean;
  pinSide: 'left' | 'right';
  pinSideTouched: boolean;
  popupMode: PopupMode;
}

/**
 * Resolves the form state into the annotation fields to persist. A page
 * anchor can never carry a text mark or colour; an empty note body drops the
 * pin and popup so clearing the content turns the note into a pure mark.
 */
export function buildStickyNoteFormValue(
  state: StickyNoteFormState,
  note: StickyNote | null,
  anchor: StickyNoteAnchor,
  initialPin: AnnotationPin | null = null,
): StickyNoteFormValue {
  const pageAnchor = anchor.kind === 'page';
  const markStyle: AnnotationMarkStyle = pageAnchor ? 'none' : state.markStyle;
  const color = pageAnchor || markStyle === 'none' ? null : state.color;

  if (state.contentMd.trim() === '') {
    return {
      contentMd: state.contentMd,
      markStyle,
      color,
      pin: null,
      popup: null,
    };
  }

  return {
    contentMd: state.contentMd,
    markStyle,
    color,
    pin: pinForForm(note ?? { pin: initialPin }, anchor, {
      visible: state.pinVisible,
      side: state.pinSide,
      sideTouched: state.pinSideTouched,
    }),
    popup: popupForMode(note, state.popupMode),
  };
}

export interface StickyNoteDialogProps {
  mode: 'create' | 'edit';
  /** Set in edit mode; the anchor, page and version are read-only. */
  note?: StickyNote;
  /** Create-mode source text and placement. */
  initialQuote?: string;
  pageNo?: number;
  version?: PdfVersion;
  source?: StickyNoteSource;
  /** Create-mode anchor; falls back to the note's own anchor in edit mode. */
  anchor?: StickyNoteAnchor;
  /** Create-mode pin at the point the user clicked on the page. */
  initialPin?: AnnotationPin | null;
  /** Resolves true when the annotation was saved and the dialog may close. */
  onSave(value: StickyNoteFormValue): Promise<boolean>;
  onClose(): void;
}

/**
 * Create/edit form for a note or mark. The quote, page, version and anchor
 * are fixed: editing only changes the content and annotation presentation.
 */
export function StickyNoteDialog({
  mode,
  note,
  initialQuote,
  pageNo,
  version,
  source,
  anchor,
  initialPin = null,
  onSave,
  onClose,
}: StickyNoteDialogProps): React.JSX.Element {
  const effectiveAnchor: StickyNoteAnchor = note?.anchor ?? anchor ?? {
    kind: 'page',
  };
  const pageAnchor = effectiveAnchor.kind === 'page';
  const placedPin = note?.pin ?? initialPin;
  const pinPlacedOnPage = mode === 'create' && initialPin !== null;
  const initialMarkStyle: AnnotationMarkStyle = pageAnchor
    ? 'none'
    : note?.markStyle ?? 'highlight';

  const [content, setContent] = useState(note?.contentMd ?? '');
  const [markStyle, setMarkStyle] =
    useState<AnnotationMarkStyle>(initialMarkStyle);
  const [color, setColor] = useState<string | null>(
    initialMarkStyle === 'none'
      ? null
      : note?.color ?? defaultMarkColor(initialMarkStyle),
  );
  const [pinVisible, setPinVisible] = useState(
    placedPin?.visible ?? (pageAnchor || initialMarkStyle === 'none'),
  );
  const [pinSide, setPinSide] = useState<'left' | 'right'>(
    placedPin !== null && placedPin !== undefined
      ? placedPin.x < 0.5
        ? 'left'
        : 'right'
      : 'right',
  );
  const [pinSideTouched, setPinSideTouched] = useState(false);
  const [pinVisibleTouched, setPinVisibleTouched] = useState(false);
  // New notes open in a draggable card; an existing note keeps what it has.
  const [popupMode, setPopupMode] = useState<PopupMode>(
    note?.popup?.mode ?? 'free',
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const effectiveStyle: AnnotationMarkStyle = pageAnchor ? 'none' : markStyle;

  const quote = note?.quote ?? initialQuote ?? '';
  const displayPage = note?.pageNo ?? pageNo;
  const displayVersion = note?.pdfVersion ?? version;
  const displaySource = note?.source ?? source;

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleMarkStyleChange = (next: AnnotationMarkStyle): void => {
    setMarkStyle(next);
    // Until the user touches the checkbox, the design default follows the
    // mark style: no mark shows the pin, a text mark hides it.
    if (!pinVisibleTouched) {
      setPinVisible(next === 'none');
    }
    if (next !== 'none' && !paletteHasColor(next, color)) {
      setColor(defaultMarkColor(next));
    }
  };

  const handlePinVisibleChange = (next: boolean): void => {
    setPinVisible(next);
    setPinVisibleTouched(true);
  };

  const choosePinSide = (side: 'left' | 'right'): void => {
    setPinSide(side);
    setPinSideTouched(true);
    // Picking a side expresses intent to show the pin; the checkbox can
    // still hide it afterwards.
    setPinVisible(true);
    setPinVisibleTouched(true);
  };

  const submit = async (): Promise<void> => {
    if (saving) {
      return;
    }
    if (content.length > STICKY_NOTE_LIMITS.contentMd) {
      setError(`内容不能超过 ${STICKY_NOTE_LIMITS.contentMd} 个字符`);
      return;
    }
    if (content.trim() === '' && effectiveStyle === 'none') {
      setError('请填写内容或选择一种正文标记');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const saved = await onSave(
        buildStickyNoteFormValue(
          {
            contentMd: content,
            markStyle,
            color,
            pinVisible,
            pinSide,
            pinSideTouched,
            popupMode,
          },
          note ?? null,
          effectiveAnchor,
          initialPin,
        ),
      );
      if (!saved) {
        setError('保存标注失败');
      }
    } catch (saveError) {
      setError(errorMessage(saveError));
    } finally {
      setSaving(false);
    }
  };

  const metaParts: string[] = [];
  if (displayPage !== undefined) {
    metaParts.push(`第 ${displayPage} 页`);
  }
  if (displayVersion !== undefined) {
    metaParts.push(PDF_VERSION_LABELS[displayVersion]);
  }
  if (displaySource !== undefined) {
    metaParts.push(STICKY_NOTE_SOURCE_LABELS[displaySource]);
  }

  const title = mode === 'edit' ? '编辑标注' : '添加标注';
  const swatches = swatchesForStyle(effectiveStyle);

  return (
    <div
      className="settings-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <form
        className="settings-dialog sticky-note-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <h2 className="settings-title">{title}</h2>
        {metaParts.length > 0 && (
          <p className="sticky-note-dialog-meta">{metaParts.join(' · ')}</p>
        )}
        {quote.trim() !== '' && (
          <blockquote className="sticky-note-dialog-quote">{quote}</blockquote>
        )}
        <label className="settings-field">
          标注内容
          <textarea
            ref={textareaRef}
            className="settings-input sticky-note-dialog-textarea"
            value={content}
            rows={8}
            maxLength={STICKY_NOTE_LIMITS.contentMd}
            placeholder={
              pageAnchor
                ? '写点什么…（整页标注需填写内容）'
                : '可留空，仅保留正文标记'
            }
            disabled={saving}
            onChange={(event) => setContent(event.target.value)}
            onKeyDown={(event) => {
              if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                event.preventDefault();
                void submit();
              }
            }}
          />
        </label>
        <span className="sticky-note-dialog-count">{content.length} 字</span>

        {!pageAnchor && (
          <label className="settings-field">
            显示方式
            <select
              className="settings-input sticky-note-dialog-select"
              value={markStyle}
              disabled={saving}
              onChange={(event) =>
                handleMarkStyleChange(
                  event.target.value as AnnotationMarkStyle,
                )
              }
            >
              {MARK_STYLE_OPTIONS.map(({ style, label }) => (
                <option key={style} value={style}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        )}

        {!pageAnchor && effectiveStyle !== 'none' && (
          <div className="settings-field" role="group" aria-label="标注颜色">
            <span>颜色</span>
            <div className="sticky-note-dialog-swatches">
              {swatches.map(({ color: swatchColor, label }) => (
                <button
                  key={swatchColor}
                  type="button"
                  className="annotation-swatch"
                  aria-label={label}
                  aria-pressed={color === swatchColor}
                  title={swatchColor}
                  style={{ backgroundColor: swatchColor }}
                  disabled={saving}
                  onClick={() => setColor(swatchColor)}
                />
              ))}
            </div>
          </div>
        )}

        <label className="sticky-note-dialog-check">
          <input
            type="checkbox"
            checked={pinVisible}
            disabled={saving}
            onChange={(event) => handlePinVisibleChange(event.target.checked)}
          />
          {pinPlacedOnPage ? '在点击位置显示标注图标' : '在页边显示标注图标'}
        </label>

        {!pinPlacedOnPage && (
          <div
            className="settings-field"
            role="group"
            aria-label="页边图标位置"
          >
            <span>页边位置</span>
            <div className="sticky-note-dialog-sides">
              <button
                type="button"
                className="menu-button sticky-note-dialog-side"
                aria-pressed={pinSide === 'left'}
                disabled={saving}
                onClick={() => choosePinSide('left')}
              >
                左侧
              </button>
              <button
                type="button"
                className="menu-button sticky-note-dialog-side"
                aria-pressed={pinSide === 'right'}
                disabled={saving}
                onClick={() => choosePinSide('right')}
              >
                右侧
              </button>
            </div>
          </div>
        )}

        <div
          className="settings-field"
          role="radiogroup"
          aria-label="弹窗位置"
        >
          <span>弹窗位置</span>
          <div className="sticky-note-dialog-options">
            {POPUP_MODE_OPTIONS.map(({ mode: optionMode, label }) => (
              <label key={optionMode} className="sticky-note-dialog-option">
                <input
                  type="radio"
                  name="sticky-note-popup-mode"
                  value={optionMode}
                  checked={popupMode === optionMode}
                  disabled={saving}
                  onChange={() => setPopupMode(optionMode)}
                />
                {label}
              </label>
            ))}
          </div>
        </div>

        {error !== null && (
          <div className="settings-error" role="alert">
            {error}
          </div>
        )}

        <div className="settings-actions">
          <button type="button" className="menu-button" disabled={saving} onClick={onClose}>
            取消
          </button>
          <button type="submit" className="primary-button settings-save" disabled={saving}>
            {saving ? '保存中…' : '保存标注'}
          </button>
        </div>
      </form>
    </div>
  );
}
