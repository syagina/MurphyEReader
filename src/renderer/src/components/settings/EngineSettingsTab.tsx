import { useCallback, useEffect, useState } from 'react';
import {
  TRANSLATION_QPS_DEFAULT,
  TRANSLATION_QPS_MAX,
  TRANSLATION_QPS_MIN,
  TRANSLATION_WORKERS_DEFAULT,
  TRANSLATION_WORKERS_MAX,
  TRANSLATION_WORKERS_MIN,
  normalizeTranslationQps,
  normalizeTranslationWorkers,
} from '@shared/translation';
import type { AppSettingsUpdate, TranslationEngineStatus } from '@shared/types';
import { errorMessage, stripIpcErrorPrefix } from '../../lib/errors';
import { useAppSettingsStore } from '../../stores/app-settings';

/** Install/warmup output shown in this tab; a whole-paper translation has its own card. */
const MAX_LOG_LINES = 100;

type EngineJobKind = 'install' | 'warmup';

function isEngineJobKind(kind: string): kind is EngineJobKind {
  return kind === 'install' || kind === 'warmup';
}

/**
 * Translation-engine settings: detection state, one-click install, model
 * warmup, a custom executable picker, whole-paper performance knobs, and the
 * install/warmup log. All actions apply immediately (no save button); the
 * engine path is validated by the main process when it is stored.
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
  const [cancelable, setCancelable] = useState(true);
  const [starting, setStarting] = useState(false);
  const [qpsText, setQpsText] = useState('');
  const [workersText, setWorkersText] = useState('');
  const [savingPerformance, setSavingPerformance] = useState(false);
  const [performanceNotice, setPerformanceNotice] = useState<string | null>(null);

  const refreshStatus = useCallback(async (): Promise<TranslationEngineStatus | null> => {
    try {
      const next = await window.api.translation.engineStatus();
      setStatus(next);
      return next;
    } catch (error) {
      setActionError(stripIpcErrorPrefix(errorMessage(error)));
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
      setCancelable(true);
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

  // Keep the performance drafts in sync when the settings snapshot first
  // arrives or is replaced after a save.
  useEffect(() => {
    if (settings !== null) {
      setQpsText(String(settings.translationQps));
      setWorkersText(String(settings.translationWorkers));
    }
  }, [settings]);

  const savePerformance = async (patch: AppSettingsUpdate): Promise<void> => {
    setPerformanceNotice(null);
    setSavingPerformance(true);
    try {
      await useAppSettingsStore.getState().save(patch);
      setPerformanceNotice('已保存，将在下一次整篇翻译时生效');
    } catch {
      // The store records the reason; the tab renders it below.
    } finally {
      setSavingPerformance(false);
    }
  };

  const commitQps = (): void => {
    const raw = qpsText.trim();
    const normalized = normalizeTranslationQps(
      raw === '' ? TRANSLATION_QPS_DEFAULT : Number(raw),
    );
    setQpsText(String(normalized));
    if (settings !== null && normalized === settings.translationQps) {
      return;
    }
    void savePerformance({ translationQps: normalized });
  };

  const commitWorkers = (): void => {
    const raw = workersText.trim();
    const normalized = normalizeTranslationWorkers(
      raw === '' ? TRANSLATION_WORKERS_DEFAULT : Number(raw),
    );
    setWorkersText(String(normalized));
    if (settings !== null && normalized === settings.translationWorkers) {
      return;
    }
    void savePerformance({ translationWorkers: normalized });
  };

  const runAction = async (kind: EngineJobKind): Promise<void> => {
    setActionError(null);
    setNotice(null);
    setInstructions(null);
    setLogs([]);
    setStarting(true);
    setCancelable(kind !== 'install');
    try {
      const result =
        kind === 'install'
          ? await window.api.translation.install()
          : await window.api.translation.warmup();
      setCancelable(result.cancelable ?? true);
      if (result.instructions !== null) {
        setInstructions(result.instructions);
      }
      // A job can fail before the action result reaches the renderer; the
      // fresh status decides whether the cancel control still applies.
      const next = await refreshStatus();
      setActiveJobId(next?.busy === true ? result.jobId : null);
    } catch (error) {
      setActionError(stripIpcErrorPrefix(errorMessage(error)));
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
      setActionError(stripIpcErrorPrefix(errorMessage(error)));
    }
  };

  const handleCancel = async (): Promise<void> => {
    if (activeJobId === null) {
      return;
    }
    try {
      await window.api.translation.cancel(activeJobId);
    } catch (error) {
      setActionError(stripIpcErrorPrefix(errorMessage(error)));
    }
  };

  // While status is loaded it is authoritative: a stale settings snapshot must
  // not keep showing 已检测到 after 重新检测 found nothing.
  const detectedPath =
    status !== null ? status.detectedPath : (settings?.babeldocDetectedPath ?? null);
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
          一键安装翻译引擎
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
        {activeJobId !== null && cancelable && (
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

      <p className="settings-hint">
        Windows 一键安装会弹出管理员授权，并在独立的 PowerShell 窗口中显示进度。安装器会
        自动使用国内镜像下载 uv、Python 3.12 和 BabelDOC，镜像不可用时回退到官方源；
        文件只写入当前用户的 LocalAppData，不修改系统 Python 或 PATH。安装约占用 700 MB，
        下载阶段临时占用约 1.2 GB，完成后会自动清理安装缓存。
      </p>

      <div className="settings-engine-performance">
        <h3 className="settings-engine-heading">翻译性能</h3>

        <label className="settings-field">
          <span>请求速率上限（QPS）</span>
          <input
            className="settings-input"
            type="number"
            min={TRANSLATION_QPS_MIN}
            max={TRANSLATION_QPS_MAX}
            step={1}
            value={qpsText}
            aria-label="请求速率上限（QPS）"
            disabled={settings === null || savingPerformance}
            onChange={(event) => setQpsText(event.target.value)}
            onBlur={commitQps}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.currentTarget.blur();
              }
            }}
          />
          <span className="settings-hint">
            每秒最多向 AI 发起多少次翻译请求。它只限制请求速率，不再决定并行线程数；
            数值越高越快，但超过服务商限额会触发限流与重试。默认{' '}
            {TRANSLATION_QPS_DEFAULT}，可设 {TRANSLATION_QPS_MIN}–
            {TRANSLATION_QPS_MAX}；仅影响整篇排版翻译。
          </span>
        </label>

        <label className="settings-field">
          <span>并行翻译线程数</span>
          <input
            className="settings-input"
            type="number"
            min={TRANSLATION_WORKERS_MIN}
            max={TRANSLATION_WORKERS_MAX}
            step={1}
            value={workersText}
            aria-label="并行翻译线程数"
            disabled={settings === null || savingPerformance}
            onChange={(event) => setWorkersText(event.target.value)}
            onBlur={commitWorkers}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.currentTarget.blur();
              }
            }}
          />
          <span className="settings-hint">
            同时进行多少段翻译。实际吞吐约为「QPS」与「线程数 ÷ 单段平均耗时」中较小的一项：
            接口响应越慢，越需要更高的线程数才能跑满速率。默认{' '}
            {TRANSLATION_WORKERS_DEFAULT}，可设 {TRANSLATION_WORKERS_MIN}–
            {TRANSLATION_WORKERS_MAX}；仅影响整篇排版翻译。
          </span>
        </label>

        <label className="settings-checkbox-field">
          <input
            type="checkbox"
            checked={settings?.translationAutoGlossary ?? true}
            disabled={settings === null}
            onChange={(event) => {
              void savePerformance({ translationAutoGlossary: event.target.checked });
            }}
          />
          <span>自动术语提取</span>
        </label>
        <span className="settings-hint">
          开启后先让 AI 提取并统一专业术语，译文术语更一致，但会多出一整轮请求；
          关闭可明显加快翻译速度，代价是术语一致性略降。
        </span>
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

      {performanceNotice !== null && (
        <p className="settings-test-result ok" role="status">
          {performanceNotice}
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
