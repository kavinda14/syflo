/**
 * components/FloatingPopup/index.tsx
 *
 * A small card that floats near the right-clicked word and shows:
 * 1. The word as a heading
 * 2. A short AI-generated definition (fetched by App.tsx)
 * 3. When the right-click captured a PDF selection (onPickColor set): a row
 *    of 5 color swatches with labels — clicking one persists a highlight on
 *    the selection (parent owns the save), plus a pencil icon that swaps the
 *    row into an inline edit mode for renaming each color's label.
 * 4. A button to open a new branched chat focused on the word.
 *
 * Positioning: the popup tries to appear just to the right and below the
 * click point, but clamps to the viewport edges so it never gets cut off.
 *
 * Design: 1:1 port of Syflo's FloatingPopup — the color row mirrors
 * design/mockup-popup-edit-labels.html; both states use the same blue-50
 * primary button so switching modes feels like a transformation, not a
 * separate dialog.
 */

import { useState, useEffect } from 'react';
import { X, GitBranch, Loader2, Copy, Check, Pencil, RotateCcw } from 'lucide-react';
import type { HighlightColor, WordPopup } from '../../types';
import { HIGHLIGHT_COLORS } from '../../types';
import { useLabels } from '../../hooks/useLabels';

interface Props {
  popup: WordPopup | null;
  explanation: string;
  loading: boolean;
  onClose: () => void;
  onOpenChildChat: (word: string, context: string) => void;
  // When the user picks a color, the parent saves the highlight against the
  // captured PDF selection. Absent for chat-message right-clicks — the color
  // section doesn't render then (nothing to highlight).
  onPickColor?: (color: HighlightColor) => void;
  // The color a highlight created via "Open as new chat" would get, and the
  // swatch that shows the ring + checkmark. Defaults to yellow.
  activeColor?: HighlightColor;
}

// Tailwind doesn't pick up dynamic class names, so we keep an explicit map.
// Pastel-saturated tones that match the design mockups and play nicely with
// black body text in the rendered PDF.
const SWATCH_BG: Record<HighlightColor, string> = {
  yellow: 'bg-[#FEF08A]',
  green: 'bg-[#BBF7D0]',
  blue: 'bg-[#BFDBFE]',
  pink: 'bg-[#FBCFE8]',
  orange: 'bg-[#FED7AA]',
};

export function FloatingPopup({
  popup,
  explanation,
  loading,
  onClose,
  onOpenChildChat,
  onPickColor,
  activeColor = 'yellow',
}: Props) {
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [copied, setCopied] = useState(false);
  // Long-phrase header truncation/expand state.
  const [expanded, setExpanded] = useState(false);
  // Edit-labels mode replaces the color row with a list of editable inputs.
  const [editingLabels, setEditingLabels] = useState(false);
  // Local copy of the labels while in edit mode so the user can type freely;
  // commits happen on Save into the global `useLabels` store.
  const { labels, renameLabel } = useLabels();
  const [labelDraft, setLabelDraft] = useState(labels);

  // Re-sync the draft whenever the canonical labels change or we re-enter
  // edit mode — the popup re-uses the same instance across multiple right-
  // clicks, so without this the draft would carry over stale state.
  useEffect(() => {
    setLabelDraft(labels);
  }, [labels]);
  useEffect(() => {
    if (editingLabels) setLabelDraft(labels);
  }, [editingLabels, labels]);

  // Recalculate the popup position whenever a new word is right-clicked.
  // The height estimate is generous to leave room for the color row; edit
  // mode grows further — the clamp handles overflow.
  useEffect(() => {
    if (!popup) return;
    const w = 340;
    const h = 380;
    setPos({
      x: Math.min(popup.x + 12, window.innerWidth - w - 16),
      y: Math.min(popup.y + 12, window.innerHeight - h - 16),
    });
    setCopied(false);
    setExpanded(false);
    setEditingLabels(false);
  }, [popup]);

  const handleCopy = async () => {
    if (!popup) return;
    try {
      await navigator.clipboard.writeText(popup.word);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.error('Failed to copy to clipboard:', err);
    }
  };

  // Commit every changed label in the draft, then leave edit mode. We don't
  // bail on the first failure — each rename is independent, so we keep going
  // and let the optimistic-update layer in useLabels handle rollback.
  const handleSaveLabels = async () => {
    const renames: Array<Promise<void>> = [];
    for (const color of HIGHLIGHT_COLORS) {
      if (labelDraft[color] !== labels[color]) {
        renames.push(renameLabel(color, labelDraft[color]));
      }
    }
    await Promise.all(renames);
    setEditingLabels(false);
  };

  if (!popup) return null;

  const showColors = !!onPickColor;
  const wordCount = popup.word.trim().split(/\s+/).length;
  const isPhrase = wordCount > 3 || popup.word.length > 60;
  const collapsed = isPhrase && !expanded;
  const headerText =
    collapsed && popup.word.length > 60 ? popup.word.slice(0, 60) + '…' : popup.word;

  return (
    <div
      style={{ left: pos.x, top: pos.y, width: 340 }}
      className="fixed z-50 bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-3 border-b border-gray-100">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-medium uppercase tracking-wider text-gray-400 mb-0.5">
            Definition
            {isPhrase && (
              <span className="ml-1 normal-case text-gray-300">· {wordCount} words</span>
            )}
          </p>
          {isPhrase ? (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              title={expanded ? 'Collapse' : popup.word}
              aria-expanded={expanded}
              className={`font-semibold text-sm text-gray-900 text-left w-full hover:text-blue-600 transition-colors ${
                collapsed ? 'truncate' : 'break-words'
              }`}
            >
              "{headerText}"
            </button>
          ) : (
            <p className="font-semibold text-sm text-gray-900 break-words">"{headerText}"</p>
          )}
        </div>
        <div className="shrink-0 flex items-center gap-0.5 -mr-1 -mt-0.5">
          <button
            onClick={handleCopy}
            aria-label={copied ? 'Copied' : 'Copy text'}
            title={copied ? 'Copied!' : 'Copy text'}
            className="p-1 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          >
            {copied ? <Check size={15} className="text-green-600" /> : <Copy size={15} />}
          </button>
          <button
            onClick={onClose}
            aria-label="Close"
            className="p-1 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          >
            <X size={15} />
          </button>
        </div>
      </div>

      {/* Body */}
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

      {/* Color section — section header + row of swatches OR edit list.
          Only rendered when the parent captured a PDF selection. */}
      {showColors && (
        <div className="border-t border-gray-100 px-5 pt-3 pb-2" data-testid="popup-color-section">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
              {editingLabels ? 'Rename colors' : 'Highlight color'}
            </p>
            {editingLabels ? (
              <button
                type="button"
                onClick={() => setEditingLabels(false)}
                className="text-xs text-gray-500 hover:text-gray-700 hover:underline"
              >
                Cancel
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setEditingLabels(true)}
                aria-label="Rename labels"
                title="Rename labels"
                className="p-1 rounded-md text-gray-400 hover:text-blue-600 hover:bg-gray-100 transition-colors"
              >
                <Pencil size={13} />
              </button>
            )}
          </div>

          {editingLabels ? (
            // Edit mode — vertical list, one row per color with input + reset.
            <div className="flex flex-col gap-2 pb-1">
              {HIGHLIGHT_COLORS.map((color) => (
                <div key={color} className="flex items-center gap-2.5">
                  <span
                    className={`w-6 h-6 rounded-full ring-1 ring-gray-200/60 flex-shrink-0 ${SWATCH_BG[color]}`}
                    aria-hidden="true"
                  />
                  <input
                    type="text"
                    value={labelDraft[color]}
                    onChange={(e) =>
                      setLabelDraft({ ...labelDraft, [color]: e.target.value })
                    }
                    maxLength={24}
                    placeholder={labels[color]}
                    aria-label={`Label for ${color}`}
                    className="flex-1 px-2.5 py-1.5 text-sm text-gray-900 border border-gray-200 rounded-md focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15"
                  />
                  <button
                    type="button"
                    onClick={() => setLabelDraft({ ...labelDraft, [color]: '' })}
                    disabled={labelDraft[color] === ''}
                    aria-label="Reset to default"
                    title="Reset to default"
                    className="p-1 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <RotateCcw size={12} />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            // Picker mode — horizontal row of 5 swatches with labels under each.
            <div className="flex justify-between items-start gap-1 pb-1">
              {HIGHLIGHT_COLORS.map((color) => {
                const isActive = color === activeColor;
                return (
                  <button
                    key={color}
                    type="button"
                    onClick={() => onPickColor?.(color)}
                    className="flex flex-col items-center gap-1 px-1 py-1 rounded-md hover:bg-gray-50 transition-colors flex-1 min-w-0"
                    aria-label={`Highlight as ${labels[color]}`}
                    title={labels[color]}
                  >
                    <span
                      className={`w-6 h-6 rounded-full flex items-center justify-center transition-transform ${SWATCH_BG[color]} ${
                        isActive ? 'ring-2 ring-gray-900' : 'ring-1 ring-gray-200/60'
                      }`}
                    >
                      {isActive && <Check size={11} className="text-gray-900" strokeWidth={3.5} />}
                    </span>
                    <span
                      className={`text-[10px] leading-tight text-center truncate w-full ${
                        isActive ? 'font-semibold text-gray-900' : 'font-medium text-gray-500'
                      }`}
                    >
                      {labels[color]}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Footer — same blue style for both states, only icon + label changes */}
      <div className="px-3 py-3 border-t border-gray-100 bg-gray-50">
        <button
          onClick={
            editingLabels
              ? () => void handleSaveLabels()
              : () => onOpenChildChat(popup.word, popup.context)
          }
          className="flex items-center justify-center gap-2 w-full px-3 py-2 rounded-lg text-sm font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 transition-colors"
        >
          {editingLabels ? <Check size={14} /> : <GitBranch size={14} />}
          {editingLabels ? 'Save labels' : 'Open as new chat'}
        </button>
      </div>
    </div>
  );
}
