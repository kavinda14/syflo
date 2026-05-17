interface LogoProps {
  width?: number;
  textColor?: string;
  className?: string;
  animate?: boolean;
}

export function Logo({
  width = 128,
  textColor = '#1a1a1a',
  className,
  animate = true,
}: LogoProps) {
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
          <stop offset="0%" stopColor="#3B82F6">
            {animate && (
              <animate
                attributeName="stop-color"
                values="#3B82F6;#1FB6A6;#34D399;#3B82F6"
                dur="6s"
                repeatCount="indefinite"
              />
            )}
          </stop>
          <stop offset="50%" stopColor="#1FB6A6">
            {animate && (
              <animate
                attributeName="stop-color"
                values="#1FB6A6;#34D399;#3B82F6;#1FB6A6"
                dur="6s"
                repeatCount="indefinite"
              />
            )}
          </stop>
          <stop offset="100%" stopColor="#34D399">
            {animate && (
              <animate
                attributeName="stop-color"
                values="#34D399;#3B82F6;#1FB6A6;#34D399"
                dur="6s"
                repeatCount="indefinite"
              />
            )}
          </stop>
        </linearGradient>
      </defs>
      {animate && (
        <style>{`
          @keyframes flowtalk-draw {
            from { stroke-dashoffset: 600; }
            to   { stroke-dashoffset: 0; }
          }
          @keyframes flowtalk-wave-top {
            0%, 100% { transform: translateY(0); }
            50%      { transform: translateY(-2px); }
          }
          @keyframes flowtalk-wave-bot {
            0%, 100% { transform: translateY(0); }
            50%      { transform: translateY(2px); }
          }
          @keyframes flowtalk-text-in {
            from { opacity: 0; transform: translateY(4px); }
            to   { opacity: 1; transform: translateY(0); }
          }
          .ft-wave {
            stroke-dasharray: 600;
            stroke-dashoffset: 600;
            transform-origin: center;
            transform-box: fill-box;
            animation:
              flowtalk-draw 1.2s ease-out forwards,
              flowtalk-wave-top 3.2s ease-in-out 1.2s infinite;
          }
          .ft-wave--bot {
            animation:
              flowtalk-draw 1.2s ease-out 0.25s forwards,
              flowtalk-wave-bot 3.2s ease-in-out 1.45s infinite;
          }
          .ft-text {
            transform-origin: center;
            transform-box: fill-box;
            opacity: 0;
            animation: flowtalk-text-in 0.6s ease-out 0.6s forwards;
          }
          @media (prefers-reduced-motion: reduce) {
            .ft-wave, .ft-wave--bot {
              stroke-dasharray: none;
              stroke-dashoffset: 0;
              animation: none;
            }
            .ft-text { opacity: 1; animation: none; }
          }
        `}</style>
      )}
      <path
        className={animate ? 'ft-wave' : undefined}
        d="M 38 30 Q 90 14, 140 28 T 240 26 T 322 30"
        stroke="url(#flowtalk-logo-grad)"
        strokeWidth="4"
        strokeLinecap="round"
        fill="none"
      />
      <text
        className={animate ? 'ft-text' : undefined}
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
        className={animate ? 'ft-wave ft-wave--bot' : undefined}
        d="M 38 110 Q 90 124, 140 112 T 240 114 T 322 110"
        stroke="url(#flowtalk-logo-grad)"
        strokeWidth="4"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}
