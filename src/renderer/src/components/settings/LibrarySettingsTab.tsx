import { useState } from 'react';
import { errorMessage } from '../../lib/errors';
import { useAppSettingsStore } from '../../stores/app-settings';
import { useStorageStore } from '../../stores/storage';

/**
 * Library settings: the configured root, opening it, changing it with a copy
 * migration, the last migration pass and where notes are exported. Every
 * action applies immediately; this tab deliberately has no save button.
 */
export function LibrarySettingsTab(): React.JSX.Element {
  const info = useStorageStore((state) => state.info);
  const busy = useStorageStore((state) => state.busy);
  const loading = useStorageStore((state) => state.loading);
  const storageError = useStorageStore((state) => state.error);
  const lastMigration = useStorageStore((state) => state.lastMigration);
  const rootChangeNotice = useStorageStore((state) => state.rootChangeNotice);
  const chooseAndChangeRoot = useStorageStore((state) => state.chooseAndChangeRoot);
  const openRoot = useStorageStore((state) => state.openRoot);
  const migrateLegacy = useStorageStore((state) => state.migrateLegacy);
  const dismissRootChangeNotice = useStorageStore(
    (state) => state.dismissRootChangeNotice,
  );
  const appSettings = useAppSettingsStore((state) => state.settings);
  const appSettingsError = useAppSettingsStore((state) => state.error);

  const [actionError, setActionError] = useState<string | null>(null);

  const root = info?.root ?? appSettings?.libraryRoot ?? '';
  const migration = lastMigration ?? info?.migration ?? null;
  const storageBusy = busy.storageTask !== null;
  const error = actionError ?? storageError ?? info?.error ?? appSettingsError ?? null;

  const handleOpenRoot = (): void => {
    setActionError(null);
    void openRoot().catch((openError: unknown) => {
      setActionError(errorMessage(openError));
    });
  };

  const handleChangeRoot = (): void => {
    setActionError(null);
    void chooseAndChangeRoot();
  };

  const handleMigrate = (): void => {
    setActionError(null);
    void migrateLegacy();
  };

  return (
    <section className="settings-library">
      <div className="settings-field">
        <span>文献库根目录</span>
        <input
          className="settings-input settings-root-path"
          type="text"
          readOnly
          value={root}
          aria-label="文献库根目录"
          onFocus={(event) => event.currentTarget.select()}
        />
      </div>

      <div className="settings-library-actions">
        <button
          type="button"
          className="menu-button"
          disabled={storageBusy}
          onClick={handleOpenRoot}
        >
          打开文件夹
        </button>
        <button
          type="button"
          className="menu-button"
          disabled={storageBusy}
          onClick={handleChangeRoot}
        >
          更改位置
        </button>
      </div>

      <p className="settings-library-hint">
        单篇笔记 → 文献文件夹/notes/；全部笔记 → exports/
      </p>

      <div className="settings-library-migration">
        <h3 className="settings-library-heading">迁移状态</h3>
        {migration === null ? (
          <p className="settings-library-hint">尚未整理现有文献。</p>
        ) : (
          <>
            <p className="settings-library-status">
              已整理 {migration.adopted} 篇；{migration.skipped.length} 篇未迁移
            </p>
            {migration.skipped.length > 0 && (
              <ul className="settings-skipped-list">
                {migration.skipped.map((item) => (
                  <li key={item.paperId}>
                    {item.title}：{item.reason}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
        <button
          type="button"
          className="menu-button"
          disabled={storageBusy || loading}
          onClick={handleMigrate}
        >
          {busy.storageTask === 'migrateLegacy' ? '整理中…' : '整理现有文献'}
        </button>
      </div>

      {rootChangeNotice !== null && (
        <div className="settings-library-notice" role="status">
          <span>{rootChangeNotice}</span>
          <button type="button" className="menu-button" onClick={dismissRootChangeNotice}>
            关闭
          </button>
        </div>
      )}

      {error !== null && (
        <p className="settings-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
