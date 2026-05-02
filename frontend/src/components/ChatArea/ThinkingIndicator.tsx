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
    <div className="flex items-center gap-2 text-sm text-gray-400">
      <span className="inline-block w-1.5 h-1.5 rounded-full bg-gray-400 animate-pulse" />
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
