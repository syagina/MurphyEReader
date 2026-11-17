import { useState } from 'react';
import { TRANSLATION_NOT_CONFIGURED } from '@shared/translation';

export interface SelectionTranslationCardProps {
  text: string;
  targetLabel: string;
  top: number;
  left: number;
  loading: boolean;
  translation: string | null;
  error: string | null;
  unconfigured: boolean;
  onRetry(): void;
  onClose(): void;
  onOpenSettings?(): void;
  /** Saves the finished translation as a sticky note. */
  onSaveSticky?(): void;
}

/**
 * Fixed-position free-selection translation card. It is independent of the AI
 * panel and owns only transient UI state: the copy-failure hint. Everything
 * else comes from the viewer so stale responses can be discarded there.
 */
export function SelectionTranslationCard({
  text,
  targetLabel,
  top,
  left,
  loading,
  translation,
  error,
  unconfigured,
  onRetry,
  onClose,
  onOpenSettings,
  onSaveSticky,
}: SelectionTranslationCardProps): React.JSX.Element {
  const [copyFailed, setCopyFailed] = useState(false);

  const handleCopy = (): void => {
    setCopyFailed(false);
    try {
      void navigator.clipboard.writeText(translation ?? '').catch(() => {
        setCopyFailed(true);
      });
    } catch {
      // A missing clipboard API must never take the card down.
      setCopyFailed(true);
    }
  };

  const actions = (): React.JSX.Element => (
    <div className="selection-translation-actions">
      {unconfigured && onOpenSettings !== undefined && (
        <button type="button" className="menu-button" onClick={onOpenSettings}>
          打开设置
        </button>
      )}
      {error !== null && (
        <button type="button" className="menu-button" onClick={onRetry}>
          重试
        </button>
      )}
      {!loading && !unconfigured && error === null && translation !== null && (
        <>
          <button type="button" className="menu-button" onClick={handleCopy}>
            复制
          </button>
          {onSaveSticky !== undefined && (
            <button type="button" className="menu-button" onClick={onSaveSticky}>
              存为标注
            </button>
          )}
        </>
      )}
      <button type="button" className="menu-button" onClick={onClose}>
        关闭
      </button>
    </div>
  );

  return (
    <div
      className="selection-translation-card"
      role="dialog"
      aria-label="划词翻译"
      style={{ top, left }}
    >
      <p className="selection-translation-original" title={text}>
        {text}
      </p>

      {loading ? (
        <p className="selection-translation-status" role="status">
          <span className="selection-translation-spinner" aria-hidden="true" />
          正在翻译为{targetLabel}…
        </p>
      ) : unconfigured ? (
        <p className="selection-translation-status" role="alert">
          {TRANSLATION_NOT_CONFIGURED}
        </p>
      ) : error !== null ? (
        <p className="selection-translation-error" role="alert">
          {error}
        </p>
      ) : (
        <>
          <div className="selection-translation-result">{translation}</div>
          {copyFailed && (
            <p className="selection-translation-copy-error" role="status">
              复制失败，请手动选择译文
            </p>
          )}
        </>
      )}

      {actions()}
    </div>
  );
}
