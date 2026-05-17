import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const phrases = [
  'Liest deine Frage',
  'Denkt nach',
  'Sammelt Gedanken',
  'Formuliert Antwort',
];

export function ThinkingIndicator() {
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setIdx(i => (i + 1) % phrases.length), 2200);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="flex items-center gap-2.5 text-sm text-gray-400">
      <svg
        width={44}
        height={22}
        viewBox="0 0 60 28"
        aria-hidden="true"
        style={{ overflow: 'visible' }}
      >
        <style>{`
          @keyframes ft-thinking-draw {
            0%   { stroke-dashoffset: 70; }
            50%  { stroke-dashoffset: 0; }
            100% { stroke-dashoffset: -70; }
          }
          .ft-thinking-wave {
            fill: none;
            stroke: url(#ft-thinking-grad);
            stroke-width: 2.5;
            stroke-linecap: round;
            stroke-dasharray: 70;
            animation: ft-thinking-draw 1.8s ease-in-out infinite;
          }
          .ft-thinking-wave--bot { animation-delay: 0.3s; }
          @media (prefers-reduced-motion: reduce) {
            .ft-thinking-wave {
              stroke-dasharray: none;
              stroke-dashoffset: 0;
              animation: none;
            }
          }
        `}</style>
        <defs>
          <linearGradient id="ft-thinking-grad" x1="0" x2="1">
            <stop offset="0%"   stopColor="#3B82F6" />
            <stop offset="50%"  stopColor="#1FB6A6" />
            <stop offset="100%" stopColor="#34D399" />
          </linearGradient>
        </defs>
        <path className="ft-thinking-wave" d="M 4 10 Q 15 4, 26 10 T 56 10" />
        <path
          className="ft-thinking-wave ft-thinking-wave--bot"
          d="M 4 20 Q 15 26, 26 20 T 56 20"
        />
      </svg>
      <AnimatePresence mode="wait">
        <motion.span
          key={idx}
          initial={{ opacity: 0, y: 3 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -3 }}
          transition={{ duration: 0.25 }}
          className="italic"
        >
          {phrases[idx]} …
        </motion.span>
      </AnimatePresence>
    </div>
  );
}
