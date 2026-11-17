import { useTranslationStore } from '../stores/translation';

const STATUS_LABELS = {
  running: '翻译中',
  done: '翻译完成',
  failed: '翻译失败',
  canceled: '翻译已取消',
} as const;

/**
 * Re-entry for a whole-paper translation card the user closed. It sits in the
 * top bar to the left of the theme switch and only exists while a job is
 * present and its card is hidden.
 */
export function TranslationStatusButton(): React.JSX.Element | null {
  const job = useTranslationStore((state) => state.job);
  const hidden = useTranslationStore((state) => state.hidden);
  const show = useTranslationStore((state) => state.show);

  if (job === null || !hidden) {
    return null;
  }

  return (
    <button
      type="button"
      className={
        job.status === 'running'
          ? 'topbar-translation running'
          : 'topbar-translation'
      }
      title="显示整篇翻译窗口"
      onClick={show}
    >
      {STATUS_LABELS[job.status]}
    </button>
  );
}
