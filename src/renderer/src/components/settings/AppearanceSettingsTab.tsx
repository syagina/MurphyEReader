import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  PAPER_TEXTURE_DEFAULT,
  PAPER_TEXTURE_MAX,
  PAPER_TEXTURE_MIN,
  normalizePaperTexture,
} from '@shared/appearance';
import { applyPaperTexture } from '../../lib/paper-texture';
import { useAppSettingsStore } from '../../stores/app-settings';

/**
 * The only settings tab control: 纸感 grain strength. The theme itself stays in
 * the always-visible top-bar switch; this only tunes the texture used by the
 * 纸感 mode and previews it immediately while the slider moves.
 */
export function AppearanceSettingsTab(): React.JSX.Element {
  const settings = useAppSettingsStore((state) => state.settings);
  const error = useAppSettingsStore((state) => state.error);

  const saved = settings?.paperTexture ?? PAPER_TEXTURE_DEFAULT;
  const [value, setValue] = useState(saved);
  const [saving, setSaving] = useState(false);
  // The value the store already has (or one currently being saved), so a
  // pointer-up followed by blur never writes the same number twice.
  const committed = useRef(saved);
  const saveSeq = useRef(0);

  // Adopt the persisted value once the settings snapshot arrives or a save
  // replaces it. Equal values keep the current draft untouched.
  useEffect(() => {
    committed.current = saved;
    setValue(saved);
    applyPaperTexture(saved);
  }, [saved]);

  const preview = (next: number): void => {
    setValue(next);
    applyPaperTexture(next);
  };

  const commit = (raw: number): void => {
    const next = normalizePaperTexture(raw);
    preview(next);
    if (next === committed.current) {
      return;
    }
    committed.current = next;
    const seq = saveSeq.current + 1;
    saveSeq.current = seq;
    setSaving(true);
    void useAppSettingsStore
      .getState()
      .save({ paperTexture: next })
      .catch(() => {
        // A newer drag already owns the slider; only the latest failed value
        // rolls back.
        if (saveSeq.current !== seq) {
          return;
        }
        const previous =
          useAppSettingsStore.getState().settings?.paperTexture ??
          PAPER_TEXTURE_DEFAULT;
        committed.current = previous;
        setValue(previous);
        applyPaperTexture(previous);
      })
      .finally(() => {
        if (saveSeq.current === seq) {
          setSaving(false);
        }
      });
  };

  const commitFrom = (target: HTMLInputElement): void => {
    commit(Number(target.value));
  };

  return (
    <section className="settings-appearance">
      <div
        className="paper-texture-preview"
        aria-hidden="true"
        style={
          {
            '--paper-preview-strength': String(value),
          } as CSSProperties
        }
      >
        纸纹预览
      </div>

      <div className="settings-field">
        <span>纸纹强度</span>
        <div className="settings-range-row">
          <input
            className="settings-range"
            type="range"
            min={PAPER_TEXTURE_MIN}
            max={PAPER_TEXTURE_MAX}
            step={1}
            value={value}
            disabled={settings === null}
            aria-label="纸纹强度"
            onChange={(event) => {
              preview(Number(event.currentTarget.value));
            }}
            onPointerUp={(event) => {
              commitFrom(event.currentTarget);
            }}
            onKeyUp={(event) => {
              commitFrom(event.currentTarget);
            }}
            onBlur={(event) => {
              commitFrom(event.currentTarget);
            }}
          />
          <span className="settings-range-value">{value}%</span>
        </div>
        <span className="settings-hint">
          数值越大，界面与 PDF 阅读页的纸纹越明显；设为 0 可完全关闭。
          纸感模式会把阅读页调成与界面一致的纸张色，但只影响显示，
          不会修改 PDF 文件本身。外观模式请在顶栏切换。
        </span>
      </div>

      <div className="settings-engine-actions">
        <button
          type="button"
          className="menu-button"
          disabled={settings === null || saving}
          onClick={() => {
            commit(PAPER_TEXTURE_DEFAULT);
          }}
        >
          恢复默认（{PAPER_TEXTURE_DEFAULT}%）
        </button>
      </div>

      {saving && (
        <p className="settings-test-result" role="status">
          正在保存…
        </p>
      )}

      {error !== null && (
        <p className="settings-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
