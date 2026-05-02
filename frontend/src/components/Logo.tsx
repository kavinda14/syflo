interface LogoProps {
  width?: number;
  textColor?: string;
  className?: string;
}

export function Logo({ width = 128, textColor = '#1a1a1a', className }: LogoProps) {
  const height = Math.round((width * 140) / 360);
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 360 140"
      className={className}
      aria-label="FlowTalk"
      role="img"
    >
      <defs>
        <linearGradient id="flowtalk-logo-grad" x1="0" x2="1">
          <stop offset="0%" stopColor="#3B82F6" />
          <stop offset="50%" stopColor="#1FB6A6" />
          <stop offset="100%" stopColor="#34D399" />
        </linearGradient>
      </defs>
      <path
        d="M 38 30 Q 90 14, 140 28 T 240 26 T 322 30"
        stroke="url(#flowtalk-logo-grad)"
        strokeWidth="4"
        strokeLinecap="round"
        fill="none"
      />
      <text
        x="180"
        y="88"
        textAnchor="middle"
        style={{
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
          fontWeight: 600,
          fontSize: 56,
          letterSpacing: '-1.5px',
          fill: textColor,
        }}
      >
        FlowTalk
      </text>
      <path
        d="M 38 110 Q 90 124, 140 112 T 240 114 T 322 110"
        stroke="url(#flowtalk-logo-grad)"
        strokeWidth="4"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}
