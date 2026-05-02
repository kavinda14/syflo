/**
 * components/FloatingPopup/index.tsx
 *
 * A small card that floats near the right-clicked word and shows:
 * 1. The word as a heading
 * 2. A short AI-generated definition (fetched by App.tsx)
 * 3. A button to open a new branched chat focused on that word
 *
 * Positioning: the popup tries to appear just to the right and below the click
 * point, but clamps to the viewport edges so it never gets cut off.
 *
 * Design: clean white card with a subtle shadow, no heavy gradients — consistent
 * with the overall Apple-inspired minimal aesthetic.
 */

import { useState, useEffect } from 'react';
import { X, GitBranch, Loader2 } from 'lucide-react';
import type { WordPopup } from '../../types';

interface Props {
  popup: WordPopup | null;
  explanation: string;
  loading: boolean;
  onClose: () => void;
  onOpenChildChat: (word: string, context: string) => void;
}

export function FloatingPopup({ popup, explanation, loading, onClose, onOpenChildChat }: Props) {
  const [pos, setPos] = useState({ x: 0, y: 0 });

  // Recalculate the popup position whenever a new word is right-clicked.
  // Offset by 12px from the click point and clamp so the card stays on screen.
  useEffect(() => {
    if (!popup) return;
    const w = 340;
    const h = 260;
    setPos({
      x: Math.min(popup.x + 12, window.innerWidth - w - 16),
      y: Math.min(popup.y + 12, window.innerHeight - h - 16),
    });
  }, [popup]);

  // Don't render anything when no word has been clicked.
  if (!popup) return null;

  // Trim long selections in the header so a whole-sentence right-click stays readable.
  const headerText = popup.word.length > 60 ? popup.word.slice(0, 60) + '…' : popup.word;

  return (
    <div
      style={{ left: pos.x, top: pos.y, width: 340 }}
      className="fixed z-50 bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden"
    >
      {/* Header: the selected word and a close button */}
      <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-3 border-b border-gray-100">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-medium uppercase tracking-wider text-gray-400 mb-0.5">Definition</p>
          <p className="font-semibold text-sm text-gray-900 break-words">"{headerText}"</p>
        </div>
        <button
          onClick={onClose}
          className="shrink-0 -mr-1 -mt-0.5 p-1 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
        >
          <X size={15} />
        </button>
      </div>

      {/* Body: shows a spinner while the explanation is loading, then the text */}
      <div className="px-5 py-4 max-h-52 overflow-y-auto">
        {loading ? (
          <div className="flex items-center gap-2 text-gray-400 text-sm">
            <Loader2 size={14} className="animate-spin" />
            <span>Loading definition…</span>
          </div>
        ) : (
          <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{explanation}</p>
        )}
      </div>

      {/* Footer: button to open a new chat branched from this word */}
      <div className="px-3 py-3 border-t border-gray-100 bg-gray-50">
        <button
          onClick={() => onOpenChildChat(popup.word, popup.context)}
          className="flex items-center justify-center gap-2 w-full px-3 py-2 rounded-lg text-sm font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 transition-colors"
        >
          <GitBranch size={14} />
          Open as new chat
        </button>
      </div>
    </div>
  );
}
