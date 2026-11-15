import { useEffect, useState } from 'react';
import { useAppSettingsStore } from '../stores/app-settings';
import { AiSettingsTab } from './settings/AiSettingsTab';
import { EngineSettingsTab } from './settings/EngineSettingsTab';
import { LibrarySettingsTab } from './settings/LibrarySettingsTab';

export type SettingsTab = 'ai' | 'library' | 'engine';

export interface SettingsDialogProps {
  onClose(): void;
  initialTab?: SettingsTab;
}

const SETTINGS_TABS: Array<{ id: SettingsTab; label: string }> = [
  { id: 'ai', label: 'AI 接口' },
  { id: 'library', label: '文献库' },
  { id: 'engine', label: '翻译引擎' },
];

const SHORTCUTS: Array<{ keys: string; label: string }> = [
  { keys: 'Ctrl+Shift+T', label: '切译本' },
  { keys: 'Ctrl+K', label: '搜索' },
  { keys: 'Ctrl+F', label: '页内搜索' },
  { keys: 'Ctrl+Enter', label: '发送' },
];

/**
 * Modal settings shell. All tab panels stay mounted and only the inactive ones
 * are hidden, so an unsaved AI draft survives switching tabs. Escape and a
 * backdrop click close the whole dialog; the shortcut list is shared.
 */
export function SettingsDialog({
  onClose,
  initialTab = 'ai',
}: SettingsDialogProps): React.JSX.Element {
  const [tab, setTab] = useState<SettingsTab>(initialTab);

  useEffect(() => {
    void useAppSettingsStore.getState().load();
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') {
        return;
      }
      event.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

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
      <div className="settings-dialog" role="dialog" aria-modal="true" aria-label="设置">
        <h2 className="settings-title">设置</h2>

        <div className="settings-tabs" role="tablist" aria-label="设置分类">
          {SETTINGS_TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              className={tab === item.id ? 'settings-tab active' : 'settings-tab'}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="settings-panel" role="tabpanel" aria-label="AI 接口" hidden={tab !== 'ai'}>
          <AiSettingsTab onClose={onClose} />
        </div>

        <div
          className="settings-panel"
          role="tabpanel"
          aria-label="文献库"
          hidden={tab !== 'library'}
        >
          <LibrarySettingsTab />
        </div>

        <div
          className="settings-panel"
          role="tabpanel"
          aria-label="翻译引擎"
          hidden={tab !== 'engine'}
        >
          <EngineSettingsTab />
        </div>

        <section className="settings-shortcuts" aria-label="快捷键">
          <h3>快捷键</h3>
          <ul>
            {SHORTCUTS.map((shortcut) => (
              <li key={shortcut.keys}>
                <kbd>{shortcut.keys}</kbd>
                <span>{shortcut.label}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
