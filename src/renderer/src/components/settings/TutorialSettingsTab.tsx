export interface TutorialSettingsTabProps {
  onReplayOnboarding?: () => void;
}

const SHORTCUTS: Array<{ keys: string; label: string }> = [
  { keys: 'Ctrl+Shift+T', label: '切译本' },
  { keys: 'Ctrl+K', label: '搜索' },
  { keys: 'Ctrl+F', label: '页内搜索' },
  { keys: 'Ctrl+Enter', label: '发送' },
];

/** Help tab: replays the first-run wizard and lists the global shortcuts once. */
export function TutorialSettingsTab({
  onReplayOnboarding,
}: TutorialSettingsTabProps): React.JSX.Element {
  return (
    <div className="settings-tutorial">
      <section className="settings-tutorial-block" aria-label="新手引导">
        <h3>新手引导</h3>
        <p>
          重新查看文献库、阅读与翻译、智慧阅读与标注的四步介绍。
        </p>
        {onReplayOnboarding !== undefined ? (
          <button
            type="button"
            className="menu-button"
            onClick={onReplayOnboarding}
          >
            重新查看新手引导
          </button>
        ) : (
          <p>新手引导暂不可用。</p>
        )}
      </section>

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
  );
}
