export type OnboardingStep = 1 | 2 | 3 | 4;

const SVG_PROPS = {
  className: 'onboarding-art-svg',
  viewBox: '0 0 360 200',
  'aria-hidden': true as const,
  focusable: false,
};

function LibraryArt(): React.JSX.Element {
  return (
    <svg {...SVG_PROPS}>
      <path
        d="M54 64h58l12 14h186a8 8 0 0 1 8 8v72a8 8 0 0 1-8 8H54a8 8 0 0 1-8-8V72a8 8 0 0 1 8-8Z"
        fill="var(--onb-accent-soft)"
        stroke="var(--onb-line)"
        strokeWidth="1.5"
      />
      <g transform="rotate(-3 120 110)">
        <rect
          x="86"
          y="52"
          width="70"
          height="96"
          rx="4"
          fill="var(--onb-panel)"
          stroke="var(--onb-line)"
          strokeWidth="1.5"
        />
        <rect x="96" y="64" width="34" height="4" rx="2" fill="var(--onb-ink)" opacity="0.7" />
        <path
          d="M96 80h50M96 90h44M96 100h48M96 110h30"
          stroke="var(--onb-line)"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </g>
      <g transform="rotate(2 180 108)">
        <rect
          x="142"
          y="44"
          width="78"
          height="108"
          rx="4"
          fill="var(--onb-panel)"
          stroke="var(--onb-line)"
          strokeWidth="1.5"
        />
        <rect x="154" y="58" width="42" height="5" rx="2.5" fill="var(--onb-ink)" opacity="0.75" />
        <path
          d="M154 76h52M154 87h44M154 98h50M154 109h38M154 120h46"
          stroke="var(--onb-line)"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <rect x="154" y="132" width="26" height="5" rx="2.5" fill="var(--onb-brass)" opacity="0.55" />
      </g>
      <g transform="rotate(-1 246 112)">
        <rect
          x="212"
          y="58"
          width="70"
          height="96"
          rx="4"
          fill="var(--onb-panel)"
          stroke="var(--onb-line)"
          strokeWidth="1.5"
        />
        <rect x="222" y="70" width="30" height="4" rx="2" fill="var(--onb-ink)" opacity="0.65" />
        <path
          d="M222 86h48M222 96h40M222 106h46"
          stroke="var(--onb-line)"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </g>
      <rect
        x="76"
        y="156"
        width="64"
        height="20"
        rx="10"
        fill="var(--onb-accent-soft)"
        stroke="var(--onb-accent-border)"
      />
      <text x="108" y="170" textAnchor="middle" fontSize="10" fill="var(--onb-muted)">
        文献库
      </text>
      <rect
        x="148"
        y="156"
        width="52"
        height="20"
        rx="10"
        fill="var(--onb-brass-soft)"
        stroke="var(--onb-brass)"
        strokeOpacity="0.35"
      />
      <text x="174" y="170" textAnchor="middle" fontSize="10" fill="var(--onb-muted)">
        标签
      </text>
      <rect
        x="268"
        y="148"
        width="18"
        height="18"
        rx="4"
        fill="var(--onb-brass)"
        transform="rotate(8 277 157)"
      />
    </svg>
  );
}

function TranslationArt(): React.JSX.Element {
  return (
    <svg {...SVG_PROPS}>
      <rect
        x="48"
        y="48"
        width="118"
        height="132"
        rx="4"
        fill="var(--onb-panel)"
        stroke="var(--onb-line)"
        strokeWidth="1.5"
      />
      <rect x="62" y="62" width="52" height="5" rx="2.5" fill="var(--onb-ink)" opacity="0.7" />
      <path
        d="M62 78h88M62 89h76M62 100h90M62 111h84M62 122h66M62 133h88M62 144h58M62 155h74"
        stroke="var(--onb-line)"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <rect
        x="194"
        y="48"
        width="118"
        height="132"
        rx="4"
        fill="var(--onb-panel)"
        stroke="var(--onb-line)"
        strokeWidth="1.5"
      />
      <rect x="208" y="62" width="44" height="5" rx="2.5" fill="var(--onb-brass)" opacity="0.65" />
      <path
        d="M208 78h88M208 89h70M208 100h80M208 111h58M208 122h86M208 133h52M208 144h74"
        stroke="var(--onb-line)"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M180 44v140"
        stroke="var(--onb-brass)"
        strokeWidth="1.5"
        strokeDasharray="4 5"
      />
      <rect
        x="128"
        y="20"
        width="104"
        height="26"
        rx="13"
        fill="var(--onb-panel)"
        stroke="var(--onb-accent-border)"
      />
      <text x="151" y="37" textAnchor="middle" fontSize="10" fill="var(--onb-muted)">
        原文
      </text>
      <path d="M180 27v12" stroke="var(--onb-line)" strokeWidth="1" />
      <text x="203" y="37" textAnchor="middle" fontSize="10" fill="var(--onb-muted)">
        译文
      </text>
    </svg>
  );
}

function ReadingArt(): React.JSX.Element {
  return (
    <svg {...SVG_PROPS}>
      <rect
        x="40"
        y="34"
        width="164"
        height="140"
        rx="4"
        fill="var(--onb-panel)"
        stroke="var(--onb-line)"
        strokeWidth="1.5"
      />
      <rect x="56" y="48" width="54" height="5" rx="2.5" fill="var(--onb-ink)" opacity="0.7" />
      <path
        d="M56 66h132M56 78h118M56 90h128M56 102h92M56 114h124M56 126h110"
        stroke="var(--onb-line)"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path d="M56 83h90" stroke="var(--onb-brass)" strokeWidth="3" strokeLinecap="round" />
      <path d="M56 107h70" stroke="var(--onb-muted)" strokeWidth="1.5" />
      <g transform="rotate(4 190 120)">
        <rect
          x="168"
          y="108"
          width="52"
          height="44"
          rx="3"
          fill="var(--onb-brass-soft)"
          stroke="var(--onb-brass)"
          strokeOpacity="0.4"
        />
        <path
          d="M178 124h32M178 134h24"
          stroke="var(--onb-brass)"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </g>
      <rect
        x="222"
        y="38"
        width="106"
        height="72"
        rx="10"
        fill="var(--onb-panel)"
        stroke="var(--onb-accent-border)"
      />
      <path
        d="M244 109l-5 14 17-13"
        fill="var(--onb-panel)"
        stroke="var(--onb-accent-border)"
        strokeLinejoin="round"
      />
      <path
        d="M238 58h74M238 72h58M238 86h66"
        stroke="var(--onb-line)"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <circle cx="318" cy="46" r="10" fill="var(--onb-brass)" />
      <path
        d="M314 46h8M318 42v8"
        stroke="var(--onb-panel)"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M228 154c12-10 22 6 34-2s14-14 26-8"
        fill="none"
        stroke="var(--onb-brass)"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function SetupArt(): React.JSX.Element {
  const rows = [78, 106, 134];
  return (
    <svg {...SVG_PROPS}>
      <rect
        x="46"
        y="32"
        width="178"
        height="140"
        rx="10"
        fill="var(--onb-panel)"
        stroke="var(--onb-line)"
        strokeWidth="1.5"
      />
      <rect x="62" y="48" width="68" height="6" rx="3" fill="var(--onb-ink)" opacity="0.7" />
      {rows.map((y, index) => (
        <g key={y}>
          <circle
            cx="76"
            cy={y}
            r="8"
            fill={index === 0 ? 'var(--onb-brass)' : 'var(--onb-accent-soft)'}
            stroke={index === 0 ? 'var(--onb-brass)' : 'var(--onb-accent-border)'}
          />
          <path
            d={`M72 ${y}l3 3 5-6`}
            fill="none"
            stroke={index === 0 ? 'var(--onb-brass-soft)' : 'var(--onb-line)'}
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <rect
            x="94"
            y={y - 7}
            width={index === 1 ? 96 : 82}
            height="5"
            rx="2.5"
            fill="var(--onb-line)"
          />
          <rect x="94" y={y + 2} width="58" height="4" rx="2" fill="var(--onb-line)" opacity="0.6" />
        </g>
      ))}
      <path d="M232 100h24" stroke="var(--onb-brass)" strokeWidth="2" strokeLinecap="round" />
      <path
        d="M250 92l10 8-10 8"
        fill="none"
        stroke="var(--onb-brass)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M276 92h18l6 8h28a6 6 0 0 1 6 6v34a6 6 0 0 1-6 6h-52a6 6 0 0 1-6-6v-42a6 6 0 0 1 6-6Z"
        fill="var(--onb-accent-soft)"
        stroke="var(--onb-line)"
        strokeWidth="1.5"
      />
      <path
        d="M292 118h30M292 128h22"
        stroke="var(--onb-brass)"
        strokeWidth="2"
        strokeLinecap="round"
        opacity="0.7"
      />
    </svg>
  );
}

export function OnboardingArt({ step }: { step: OnboardingStep }): React.JSX.Element {
  if (step === 1) {
    return <LibraryArt />;
  }
  if (step === 2) {
    return <TranslationArt />;
  }
  if (step === 3) {
    return <ReadingArt />;
  }
  return <SetupArt />;
}
