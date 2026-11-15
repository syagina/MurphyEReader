import { useCallback, useEffect, useState } from 'react';
import type { TranslationEngineStatus } from '@shared/types';
import { errorMessage } from '../../lib/errors';
import { useAppSettingsStore } from '../../stores/app-settings';

/** Install/warmup output shown in this tab; a whole-paper translation has its own card. */
const MAX_LOG_LINES = 100;

type EngineJobKind = 'install' | 'warmup';

function isEngineJobKind(kind: string): kind is EngineJobKind {
  return kind === 'install' || kind === 'warmup';
}

/**
 * Translation-engine settings: detection state, one-click install, model
 * warmup, a custom executable picker, and the install/warmup log. All actions
 * apply immediately (no save button); the engine path is validated by the main
 * process when it is stored.
 */
export function EngineSettingsTab(): React.JSX.Element {
  const settings = useAppSettingsStore((state) => state.settings);
  const storeError = useAppSettingsStore((state) => state.error);

  const [status, setStatus] = useState<TranslationEngineStatus | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [instructions, setInstructions] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const refreshStatus = useCallback(async (): Promise<TranslationEngineStatus | null> => {
    try {
      const next = await window.api.translation.engineStatus();
      setStatus(next);
      return next;
    } catch (error) {
      setActionError(errorMessage(error));
      return null;
    }
  }, []);

  useEffect(() => {
    void refreshStatus();

    const offProgress = window.api.translation.onToolProgress((event) => {
      if (!isEngineJobKind(event.kind)) {
        return;
      }
      setActiveJobId(event.jobId);
      setLogs((lines) => [...lines, event.line].slice(-MAX_LOG_LINES));
    });

    const offDone = window.api.translation.onToolDone((event) => {
      if (!isEngineJobKind(event.kind)) {
        return;
      }
      setActiveJobId(null);
      setStarting(false);
      if (event.canceled) {
        setNotice('已取消');
      } else if (!event.ok) {
        setActionError(event.message ?? '操作失败');
      } else if (event.kind === 'warmup') {
        setNotice('翻译引擎已就绪');
      } else {
        setNotice('翻译引擎安装完成');
      }
      void refreshStatus();
      void useAppSettingsStore.getState().load();
    });

    return () => {
      offProgress();
      offDone();
    };
  }, [refreshStatus]);

  const runAction = async (kind: EngineJobKind): Promise<void> => {
    setActionError(null);
    setNotice(null);
    setInstructions(null);
    setLogs([]);
    setStarting(true);
    try {
      const result =
        kind === 'install'
          ? await window.api.translation.install()
          : await window.api.translation.warmup();
      if (result.instructions !== null) {
        setInstructions(result.instructions);
      }
      // A job can fail before the action result reaches the renderer; the
      // fresh status decides whether the cancel control still applies.
      const next = await refreshStatus();
      setActiveJobId(next?.busy === true ? result.jobId : null);
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setStarting(false);
    }
  };

  const handleChoosePath = async (): Promise<void> => {
    setActionError(null);
    setNotice(null);
    try {
      const picked = await window.api.translation.chooseEnginePath();
      if (picked === null) {
        return;
      }
      await useAppSettingsStore.getState().save({ babeldocPath: picked });
      setNotice('已保存自定义路径');
      await refreshStatus();
    } catch (error) {
      // The store also records this; show it even if the tab is still mounted.
      setActionError(errorMessage(error));
    }
  };

  const handleCancel = async (): Promise<void> => {
    if (activeJobId === null) {
      return;
    }
    try {
      await window.api.translation.cancel(activeJobId);
    } catch (error) {
      setActionError(errorMessage(error));
    }
  };

  const detectedPath = status?.detectedPath ?? settings?.babeldocDetectedPath ?? null;
  const configuredPath = status?.configuredPath ?? settings?.babeldocPath ?? '';
  const busy = starting || activeJobId !== null || status?.busy === true;
  const error = actionError ?? storeError;

  return (
    <section className="settings-engine">
      <div className="settings-field">
        <span>检测状态</span>
        <p
          className={detectedPath === null ? 'settings-engine-state' : 'settings-engine-state ok'}
          role="status"
        >
          {detectedPath === null ? '未检测到' : '已检测到'}
        </p>
      </div>

      <label className="settings-field">
        <span>引擎路径</span>
        <input
          className="settings-input settings-engine-path"
          type="text"
          readOnly
          value={detectedPath ?? ''}
          placeholder="未检测到 BabelDOC"
          aria-label="检测到的翻译引擎路径"
          onFocus={(event) => event.currentTarget.select()}
        />
      </label>

      <label className="settings-field">
        <span>自定义路径</span>
        <input
          className="settings-input settings-engine-path"
          type="text"
          readOnly
          value={configuredPath}
          placeholder="自动检测"
          aria-label="自定义翻译引擎路径"
          onFocus={(event) => event.currentTarget.select()}
        />
      </label>

      <div className="settings-engine-actions">
        <button
          type="button"
          className="menu-button"
          disabled={busy}
          onClick={() => {
            void runAction('install');
          }}
        >
          安装翻译引擎
        </button>
        <button
          type="button"
          className="menu-button"
          disabled={busy || detectedPath === null}
          onClick={() => {
            void runAction('warmup');
          }}
        >
          预热模型
        </button>
        <button
          type="button"
          className="menu-button"
          disabled={busy}
          onClick={() => {
            void handleChoosePath();
          }}
        >
          选择自定义路径…
        </button>
        <button
          type="button"
          className="menu-button"
          disabled={starting}
          onClick={() => {
            void refreshStatus();
          }}
        >
          重新检测
        </button>
        {activeJobId !== null && (
          <button
            type="button"
            className="menu-button"
            onClick={() => {
              void handleCancel();
            }}
          >
            取消
          </button>
        )}
      </div>

      {instructions !== null && (
        <pre className="settings-engine-instructions" aria-label="安装说明">
          {instructions}
        </pre>
      )}

      <div className="settings-engine-logs">
        <h3 className="settings-engine-heading">安装 / 预热日志</h3>
        <pre className="settings-engine-log" aria-label="安装与预热日志">
          {logs.length === 0 ? '暂无日志' : logs.join('\n')}
        </pre>
      </div>

      {notice !== null && (
        <p className="settings-test-result ok" role="status">
          {notice}
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
