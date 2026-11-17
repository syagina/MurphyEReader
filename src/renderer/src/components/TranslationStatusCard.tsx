import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Paper } from '@shared/types';
import {
  formatTranslationElapsed,
  formatTranslationLogs,
  localizeTranslationLine,
} from '@shared/translation';
import {
  clampTranslationCardPosition,
  readTranslationCardPosition,
  writeTranslationCardPosition,
} from '../lib/translation-card-position';
import type { TranslationCardPosition } from '../lib/translation-card-position';
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
  const hidden = useTranslationStore((state) => state.hidden);
  const donePaper = useTranslationStore((state) => state.donePaper);
  const cancel = useTranslationStore((state) => state.cancel);
  const dismiss = useTranslationStore((state) => state.dismiss);
  const hide = useTranslationStore((state) => state.hide);
  const toggleLogs = useTranslationStore((state) => state.toggleLogs);

  const running = job !== null && job.status === 'running';
  const [now, setNow] = useState(() => Date.now());
  const cardRef = useRef<HTMLElement | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    offsetX: number;
    offsetY: number;
  } | null>(null);
  const [position, setPosition] = useState<TranslationCardPosition | null>(
    readTranslationCardPosition,
  );
  const positionRef = useRef<TranslationCardPosition | null>(position);
  const [dragging, setDragging] = useState(false);

  // A position saved on a larger window is clamped once the card has a size,
  // so it can never reopen partly off-screen.
  useLayoutEffect(() => {
    if (position === null || cardRef.current === null) {
      return;
    }
    const rect = cardRef.current.getBoundingClientRect();
    const clamped = clampTranslationCardPosition(
      position,
      window.innerWidth,
      window.innerHeight,
      rect.width,
      rect.height,
    );
    if (clamped.left !== position.left || clamped.top !== position.top) {
      positionRef.current = clamped;
      setPosition(clamped);
    }
  }, [position]);

  // Shrinking the window can push a saved position off-screen. Re-clamp
  // locally without persisting, so a temporarily small window never
  // overwrites the position chosen on a larger screen.
  useEffect(() => {
    if (position === null) {
      return;
    }
    const handleResize = (): void => {
      const card = cardRef.current;
      const current = positionRef.current;
      if (card === null || current === null) {
        return;
      }
      const rect = card.getBoundingClientRect();
      const clamped = clampTranslationCardPosition(
        current,
        window.innerWidth,
        window.innerHeight,
        rect.width,
        rect.height,
      );
      if (clamped.left !== current.left || clamped.top !== current.top) {
        positionRef.current = clamped;
        setPosition(clamped);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, [position]);

  const handleDragPointerDown = (
    event: React.PointerEvent<HTMLDivElement>,
  ): void => {
    if (event.button !== 0 || cardRef.current === null) {
      return;
    }
    // Buttons inside the header (the close control) keep their own behavior.
    if (
      event.target instanceof Element &&
      event.target.closest('button') !== null
    ) {
      return;
    }
    const rect = cardRef.current.getBoundingClientRect();
    dragRef.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
    };
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const handleDragPointerMove = (
    event: React.PointerEvent<HTMLDivElement>,
  ): void => {
    const drag = dragRef.current;
    if (drag === null || drag.pointerId !== event.pointerId) {
      return;
    }
    const card = cardRef.current;
    if (card === null) {
      return;
    }
    const rect = card.getBoundingClientRect();
    const next = clampTranslationCardPosition(
      {
        left: event.clientX - drag.offsetX,
        top: event.clientY - drag.offsetY,
      },
      window.innerWidth,
      window.innerHeight,
      rect.width,
      rect.height,
    );
    positionRef.current = next;
    setPosition(next);
  };

  const handleDragEnd = (event: React.PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    if (drag === null || drag.pointerId !== event.pointerId) {
      return;
    }
    dragRef.current = null;
    setDragging(false);
    try {
      if (event.currentTarget.hasPointerCapture(drag.pointerId)) {
        event.currentTarget.releasePointerCapture(drag.pointerId);
      }
    } catch {
      // Capture may already be gone after an implicit release.
    }
    if (positionRef.current !== null) {
      writeTranslationCardPosition(positionRef.current);
    }
  };

  // Tick once a second only while a job runs; terminal cards show no clock.
  useEffect(() => {
    if (job === null || job.status !== 'running' || hidden) {
      return;
    }
    setNow(Date.now());
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      window.clearInterval(timer);
    };
  }, [job?.jobId, job?.status, hidden]);

  if (job === null || hidden) {
    return null;
  }

  const percent = job.percent;
  const latestLine = localizeTranslationLine(job.error ?? job.line);
  const displayLogs = formatTranslationLogs(logs);
  const elapsedMs = running ? Math.max(0, now - job.startedAt) : 0;

  return (
    <aside
      ref={cardRef}
      className="translation-status-card"
      style={
        position === null
          ? undefined
          : {
              left: position.left,
              top: position.top,
              right: 'auto',
              bottom: 'auto',
            }
      }
      role="status"
      aria-live="polite"
      aria-label="整篇翻译状态"
    >
      <div
        className={
          dragging
            ? 'translation-status-head dragging'
            : 'translation-status-head'
        }
        title="按住拖动窗口"
        onPointerDown={handleDragPointerDown}
        onPointerMove={handleDragPointerMove}
        onPointerUp={handleDragEnd}
        onPointerCancel={handleDragEnd}
        onLostPointerCapture={handleDragEnd}
      >
        <span className="translation-status-title" title={job.title}>
          {job.title === '' ? '文献翻译' : job.title}
        </span>
        <span className="translation-status-meta">
          {running && (
            <span className="translation-status-elapsed">
              已用时 {formatTranslationElapsed(elapsedMs)}
            </span>
          )}
          <span className={`translation-status-state ${job.status}`}>
            {STATUS_LABELS[job.status]}
          </span>
        </span>
        <button
          type="button"
          className="translation-status-close"
          aria-label="关闭翻译窗口"
          title={
            running
              ? '关闭窗口（翻译继续进行，可从顶栏重新打开）'
              : '关闭窗口（可从顶栏重新打开）'
          }
          onPointerDown={(event) => event.stopPropagation()}
          onClick={hide}
        >
          ×
        </button>
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

      {running && (
        <p className="translation-status-hint">
          AI 需要逐段翻译整篇文献，耗时主要取决于接口响应、模型速度和限流；
          空回复、输出被截断或限流会自动重试，因此页数越多等待越久。可在设置 →
          翻译引擎中调整请求速率、并行线程数或关闭自动术语提取。
        </p>
      )}

      {!collapsed && (
        <pre className="translation-status-logs" aria-label="翻译日志">
          {displayLogs.length === 0 ? '暂无日志' : displayLogs.join('\n')}
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
