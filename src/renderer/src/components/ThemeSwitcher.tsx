import { useState } from 'react';
import type { ThemeMode } from '@shared/types';
import { applyTheme, readStoredTheme } from '../lib/theme';
import { useAppSettingsStore } from '../stores/app-settings';

const THEME_OPTIONS: ReadonlyArray<{
  id: ThemeMode;
  label: string;
  title: string;
}> = [
  { id: 'light', label: '浅色', title: '浅色主题：明亮清晰' },
  { id: 'dark', label: '深色', title: '深色主题：适合弱光环境' },
  { id: 'eye-care', label: '护眼', title: '护眼主题：柔和暖色，适合长时间阅读' },
  { id: 'paper', label: '纸感', title: '纸感主题：界面与 PDF 阅读页呈现纸张纹理，不修改 PDF 文件' },
];

/**
 * Always-visible theme switch in the top bar — the only place the theme is
 * changed. It writes through the app-settings store; the theme is applied
 * immediately before the save resolves so the click never feels laggy.
 */
export function ThemeSwitcher(): React.JSX.Element {
  const savedTheme = useAppSettingsStore((state) => state.settings?.theme ?? null);
  const save = useAppSettingsStore((state) => state.save);
  const [saving, setSaving] = useState<ThemeMode | null>(null);
  const current = savedTheme ?? readStoredTheme();

  const choose = (next: ThemeMode): void => {
    if (next === current || saving !== null) {
      return;
    }
    const previous = current;
    applyTheme(next);
    setSaving(next);
    void save({ theme: next })
      .catch(() => {
        // Keep the interface on the committed theme when persistence fails.
        applyTheme(previous);
      })
      .finally(() => {
        setSaving(null);
      });
  };

  return (
    <div className="theme-switcher" role="group" aria-label="外观切换">
      <span className="theme-switcher-label" aria-hidden="true">
        外观
      </span>
      {THEME_OPTIONS.map((option) => {
        const selected = current === option.id;
        return (
          <button
            key={option.id}
            type="button"
            className={selected ? 'active' : undefined}
            aria-pressed={selected}
            title={option.title}
            disabled={saving !== null}
            onClick={() => choose(option.id)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
