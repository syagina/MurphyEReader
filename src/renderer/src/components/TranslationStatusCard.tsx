import type { Paper } from '@shared/types';
import { useTranslationStore } from '../stores/translation';

export interface TranslationStatusCardProps {
  /** Opens the paper rebound by a successful translation. */
  onOpenPaper?(paper: Paper): void;
}

const STATUS_LABELS = {
  running: '翻译中',
  done: '翻译完成',
  failed: '翻译失败',
  canceled: '已取消',
} as const;

/**
 * Fixed bottom-right status for the one running whole-paper translation. It
 * stays visible over both the library and the reader; 查看译本 opens the
 * updated paper without switching the reader's PDF version.
 */
export function TranslationStatusCard({
  onOpenPaper,
}: TranslationStatusCardProps): React.JSX.Element | null {
  const job = useTranslationStore((state) => state.job);
  const logs = useTranslationStore((state) => state.logs);
  const collapsed = useTranslationStore((state) => state.collapsed);
  const donePaper = useTranslationStore((state) => state.donePaper);
  const cancel = useTranslationStore((state) => state.cancel);
  const dismiss = useTranslationStore((state) => state.dismiss);
  const toggleLogs = useTranslationStore((state) => state.toggleLogs);

  if (job === null) {
    return null;
  }

  const running = job.status === 'running';
  const percent = job.percent;
  const latestLine = job.error ?? job.line;

  return (
    <aside
      className="translation-status-card"
      role="status"
      aria-live="polite"
      aria-label="整篇翻译状态"
    >
      <div className="translation-status-head">
        <span className="translation-status-title" title={job.title}>
          {job.title === '' ? '文献翻译' : job.title}
        </span>
        <span className={`translation-status-state ${job.status}`}>
          {STATUS_LABELS[job.status]}
        </span>
      </div>

      <div
        className={
          percent === null
            ? 'translation-status-progress indeterminate'
            : 'translation-status-progress'
        }
        role="progressbar"
        aria-label="翻译进度"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent ?? undefined}
      >
        <span
          style={
            percent === null
              ? undefined
              : { width: `${Math.min(100, Math.max(0, percent))}%` }
          }
        />
      </div>

      <p className="translation-status-line">
        {running && percent !== null && (
          <span className="translation-status-percent">{percent}%</span>
        )}
        {latestLine === '' ? (running ? '正在启动 BabelDOC…' : '') : latestLine}
      </p>

      {!collapsed && (
        <pre className="translation-status-logs" aria-label="翻译日志">
          {logs.length === 0 ? '暂无日志' : logs.join('\n')}
        </pre>
      )}

      <div className="translation-status-actions">
        {running && (
          <button type="button" className="menu-button" onClick={() => void cancel()}>
            取消
          </button>
        )}
        <button type="button" className="menu-button" onClick={toggleLogs}>
          {collapsed ? '展开日志' : '收起日志'}
        </button>
        {job.status === 'done' && donePaper !== null && onOpenPaper !== undefined && (
          <button
            type="button"
            className="menu-button"
            onClick={() => onOpenPaper(donePaper)}
          >
            查看译本
          </button>
        )}
        {!running && (
          <button type="button" className="menu-button" onClick={dismiss}>
            关闭
          </button>
        )}
      </div>
    </aside>
  );
}
