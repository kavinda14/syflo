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
        width={24}
        height={24}
        viewBox="0 0 32 32"
        aria-hidden="true"
        style={{ overflow: 'visible' }}
      >
        <style>{`
          @keyframes ft-thinking-draw {
            0%   { stroke-dashoffset: 30; }
            50%  { stroke-dashoffset: 0; }
            100% { stroke-dashoffset: -30; }
          }
          .ft-thinking-wave {
            fill: none;
            stroke: url(#ft-thinking-grad);
            stroke-width: 2;
            stroke-linecap: round;
            stroke-dasharray: 30;
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
        <path className="ft-thinking-wave" d="M 5 11 Q 11 7, 16 11 T 27 11" />
        <path
          className="ft-thinking-wave ft-thinking-wave--bot"
          d="M 5 21 Q 11 25, 16 21 T 27 21"
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
