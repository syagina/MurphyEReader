import { useEffect, useRef, useState } from 'react';
import { OnboardingArt } from './OnboardingArt';
import type { OnboardingStep } from './OnboardingArt';

export interface OnboardingProps {
  onFinish(reason: 'done' | 'skip'): void;
  onOpenSettings(tab: 'ai' | 'engine'): void;
}

interface StepCopy {
  label: string;
  title: string;
  body: string;
  points?: readonly string[];
}

const STEP_COPY: Record<OnboardingStep, StepCopy> = {
  1: {
    label: '文献库',
    title: '把论文收进一个井井有条的文献库',
    body: '导入 PDF 或整个文件夹，MurphyEReader 会复制并统一管理文件。原文、译文和笔记都收在一处，不再散落在各个目录。',
    points: [
      '导入 PDF 或整个文件夹',
      '文件夹、标签与阅读进度',
      'Ctrl+K 搜索页码、对话和笔记',
    ],
  },
  2: {
    label: '阅读与翻译',
    title: '保留排版的整篇翻译，原文译文随时对照',
    body: '安装 BabelDOC 后，整篇论文可按原排版生成译文；一键切换原文、译文或中英对照。选中段落也能即时翻译。',
    points: [
      '整篇排版翻译，译文绑定到原文',
      '原文 / 译文 / 中英对照切换',
      '选中文字即时翻译',
      '大纲、页内搜索与全屏专注',
    ],
  },
  3: {
    label: '智慧阅读与标注',
    title: '边读边问，边读边标',
    body: '基于当前页、全文或仅对话向 AI 提问；高亮、下划线、删除线、便签和自由绘制都直接落在 PDF 页面上，笔记还可以导出。',
    points: [
      '三种上下文模式：仅本页 / 全文 / 仅对话',
      '高亮、下划线、删除线与便签',
      '自由绘制与页边标注',
      '笔记导出为 Markdown / DOCX',
    ],
  },
  4: {
    label: '开始使用',
    title: '准备好了，从第一篇论文开始',
    body: '下面两项都是可选的，可以现在配置，也可以稍后在右上角「设置」里完成。',
  },
};

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Onboarding({
  onFinish,
  onOpenSettings,
}: OnboardingProps): React.JSX.Element {
  const [step, setStep] = useState<OnboardingStep>(1);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  const goNext = (): void => {
    if (step < 4) {
      setStep((step + 1) as OnboardingStep);
    }
  };

  const goPrev = (): void => {
    if (step > 1) {
      setStep((step - 1) as OnboardingStep);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onFinish('skip');
      return;
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      goNext();
      return;
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      goPrev();
      return;
    }
    if (event.key !== 'Tab') {
      return;
    }
    const nodes = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [],
    );
    if (nodes.length === 0) {
      return;
    }
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const copy = STEP_COPY[step];

  return (
    <div
      ref={dialogRef}
      className="onboarding"
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
      tabIndex={-1}
      onKeyDown={handleKeyDown}
    >
      <aside className="onboarding-rail">
        <div className="onboarding-brand">
          <span className="onboarding-mark" aria-hidden="true">
            M
          </span>
          MurphyEReader
        </div>
        <p className="onboarding-tagline">让论文更好读</p>
        <nav className="onboarding-steps" aria-label="引导步骤">
          {([1, 2, 3, 4] as const).map((n) => (
            <button
              key={n}
              type="button"
              className={n === step ? 'onboarding-step active' : 'onboarding-step'}
              aria-current={n === step ? 'step' : undefined}
              onClick={() => setStep(n)}
            >
              <span>{n}</span>
              {STEP_COPY[n].label}
            </button>
          ))}
        </nav>
        {step < 4 && (
          <button
            type="button"
            className="onboarding-skip"
            onClick={() => onFinish('skip')}
          >
            跳过引导
          </button>
        )}
      </aside>

      <main className="onboarding-main">
        <div className="onboarding-content">
          <div className="onboarding-stage" key={step}>
            <p className="onboarding-eyebrow">第 {step} 步 / 共 4 步</p>
            <h2 id="onboarding-title" className="onboarding-title">
              {copy.title}
            </h2>
            <p className="onboarding-body">{copy.body}</p>
            <div className="onboarding-art">
              <OnboardingArt step={step} />
            </div>

            {step < 4 ? (
              <ul className="onboarding-points">
                {(copy.points ?? []).map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
            ) : (
              <div className="onboarding-setup">
                <div className="onboarding-setup-row">
                  <div>
                    <strong>AI 接口</strong>
                    <p>用于智慧阅读、划词翻译与概念卡。</p>
                  </div>
                  <button
                    type="button"
                    className="onboarding-inline-button"
                    onClick={() => onOpenSettings('ai')}
                  >
                    配置 AI 接口
                  </button>
                </div>
                <div className="onboarding-setup-row">
                  <div>
                    <strong>翻译引擎</strong>
                    <p>用于保留排版的整篇翻译。</p>
                  </div>
                  <button
                    type="button"
                    className="onboarding-inline-button"
                    onClick={() => onOpenSettings('engine')}
                  >
                    安装翻译引擎
                  </button>
                </div>
                <p className="onboarding-setup-note">
                  导入第一篇论文：进入文献库后点击「＋ 导入 PDF」。之后可在「设置」底部重新打开这份引导。
                </p>
              </div>
            )}
          </div>

          <footer className="onboarding-footer">
            <span className="onboarding-dots" aria-hidden="true">
              {[1, 2, 3, 4].map((n) => (
                <span key={n} className={n === step ? 'active' : ''} />
              ))}
            </span>
            <div className="onboarding-actions">
              <button
                type="button"
                className="onboarding-button ghost"
                disabled={step === 1}
                onClick={goPrev}
              >
                上一步
              </button>
              {step < 4 ? (
                <button
                  type="button"
                  className="onboarding-button primary"
                  onClick={goNext}
                >
                  下一步 →
                </button>
              ) : (
                <button
                  type="button"
                  className="onboarding-button primary"
                  onClick={() => onFinish('done')}
                >
                  进入文献库
                </button>
              )}
            </div>
          </footer>
        </div>
      </main>
    </div>
  );
}
