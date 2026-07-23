/**
 * chat/highlightAnchors.ts
 *
 * Anchor math + paint registry for chat-text highlights
 * (design/mockup-chat-highlights-ask-in-chat.html).
 *
 * Chat highlights anchor to character offsets in a message's rendered plain
 * text (the concatenated text nodes under the bubble's content root). That
 * makes them reflow-safe: unlike the PDF's geometric rects, offsets survive
 * window resizes, column drags, and theme changes.
 *
 * Painting uses the CSS Custom Highlight API (CSS.highlights +
 * ::highlight() rules in index.css) instead of wrapping <mark> elements —
 * the markdown DOM stays untouched, so React reconciliation never fights
 * imperative wrappers. One registry entry per color; each message
 * contributes its ranges and withdraws them on unmount.
 *
 * jsdom (vitest) has no Custom Highlight API — every paint call no-ops
 * behind `supportsCustomHighlights`, while the pure offset math stays
 * testable.
 */

import type { HighlightColor, MessageHighlight } from '../types';
import { HIGHLIGHT_COLORS } from '../types';

// Style names referenced by ::highlight() rules in index.css.
const styleName = (color: HighlightColor) => `syflo-chat-hl-${color}`;

export const supportsCustomHighlights =
  typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight !== 'undefined';

// ─── Offset math (pure, testable) ───────────────────────────────────────────

// Character offset of (node, nodeOffset) within root's concatenated text.
// Range.toString() concatenates exactly the text-node data inside the range,
// which matches the TreeWalker accumulation used by rangeFromOffsets below.
export function textOffsetInRoot(root: Node, node: Node, nodeOffset: number): number {
  const r = document.createRange();
  r.selectNodeContents(root);
  r.setEnd(node, nodeOffset);
  return r.toString().length;
}

// Build a live Range spanning [startOffset, endOffset) of root's text.
// Returns null when the offsets exceed the current text (message content
// changed since the highlight was saved) — the caller simply skips painting.
export function rangeFromOffsets(root: Node, startOffset: number, endOffset: number): Range | null {
  if (startOffset < 0 || endOffset <= startOffset) return null;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let pos = 0;
  let startNode: Text | null = null;
  let startInNode = 0;
  let node = walker.nextNode() as Text | null;
  while (node) {
    const next = pos + node.data.length;
    if (startNode === null && startOffset < next) {
      startNode = node;
      startInNode = startOffset - pos;
    }
    if (startNode !== null && endOffset <= next) {
      const range = document.createRange();
      range.setStart(startNode, startInNode);
      range.setEnd(node, endOffset - pos);
      return range;
    }
    pos = next;
    node = walker.nextNode() as Text | null;
  }
  return null;
}

// Find the highlight under a screen point (for right-click on an existing
// mark). Uses the caret position API to translate the point into a text
// offset, then scans the message's highlights for one covering it.
export function highlightAtPoint(
  root: Node,
  highlights: MessageHighlight[],
  x: number,
  y: number,
): MessageHighlight | null {
  const caret = document.caretRangeFromPoint?.(x, y);
  if (!caret || !root.contains(caret.startContainer)) return null;
  const offset = textOffsetInRoot(root, caret.startContainer, caret.startOffset);
  return (
    highlights.find((h) => h.startOffset <= offset && offset < h.endOffset) ?? null
  );
}

// ─── Paint registry (Custom Highlight API) ──────────────────────────────────

// message id → color → live ranges currently painted for that message.
const rangesByMessage = new Map<string, Map<HighlightColor, Range[]>>();

function repaint(color: HighlightColor) {
  if (!supportsCustomHighlights) return;
  const all: Range[] = [];
  for (const perColor of rangesByMessage.values()) {
    const ranges = perColor.get(color);
    if (ranges) all.push(...ranges);
  }
  if (all.length === 0) {
    CSS.highlights.delete(styleName(color));
  } else {
    CSS.highlights.set(styleName(color), new Highlight(...all));
  }
}

// (Re)paint one message's highlights against its current content root.
// Called from a layout effect after every content change, so ranges never
// point at detached text nodes.
export function paintMessageHighlights(
  messageId: string,
  root: Node,
  highlights: MessageHighlight[],
): void {
  if (!supportsCustomHighlights) return;
  const perColor = new Map<HighlightColor, Range[]>();
  for (const h of highlights) {
    if (h.messageId !== messageId) continue;
    const range = rangeFromOffsets(root, h.startOffset, h.endOffset);
    if (!range) continue;
    const list = perColor.get(h.color);
    if (list) list.push(range);
    else perColor.set(h.color, [range]);
  }
  rangesByMessage.set(messageId, perColor);
  for (const color of HIGHLIGHT_COLORS) repaint(color);
}

export function clearMessageHighlights(messageId: string): void {
  if (!supportsCustomHighlights) return;
  if (!rangesByMessage.delete(messageId)) return;
  for (const color of HIGHLIGHT_COLORS) repaint(color);
}

// ─── Pending selection (popup open) ─────────────────────────────────────────
// Solange das Auswahl-Popup offen ist, soll die Textstelle exakt wie die
// native Browser-Selektion aussehen (Chromium malt ::highlight() nur über
// die Inline-Box — mit Lücken zwischen den Zeilen und ohne das Leading —,
// die Selektion dagegen über die volle Zeilenhöhe). Deshalb zweistufig:
//
//   1. Bevorzugt wird die NATIVE Selektion wiederhergestellt — das Öffnen
//      des Popups rendert die Bubble neu, der Markdown-DOM wird ersetzt und
//      die Selektion des Nutzers stirbt dabei. Der Paint-Effekt baut sie aus
//      den Offsets gegen den frischen DOM wieder auf → pixelgleicher Look.
//   2. Kollabiert die Selektion wirklich (Klick/Tippen im Popup), springt
//      ::highlight(syflo-chat-hl-pending) als Fallback ein, damit das Zitat
//      sichtbar bleibt, bis eine Aktion erfolgt oder das Popup schließt.
//
// Es gibt höchstens EINE pending Selektion app-weit; der Besitzer ist die
// Nachricht, in der sie erfasst wurde.

const PENDING_STYLE = 'syflo-chat-hl-pending';
let pendingOwner: string | null = null;
let pendingRange: Range | null = null;

// Links-Drag-Tracking: während der Nutzer eine NEUE Auswahl aufzieht, darf
// die Wiederherstellung nicht dazwischenfunken.
let leftMouseDown = false;
let listenersInstalled = false;
function installPendingListeners(): void {
  if (listenersInstalled || typeof document === 'undefined') return;
  listenersInstalled = true;
  document.addEventListener('mousedown', (e) => {
    if (e.button === 0) leftMouseDown = true;
  });
  document.addEventListener('mouseup', (e) => {
    if (e.button === 0) {
      leftMouseDown = false;
      // Klick fertig (Nutzer-Report 2026-07-22, 2. Runde): ein Klick in den
      // Text kollabiert die Selektion und ließ das Zitat dauerhaft auf den
      // ::highlight-Fallback (Inline-Box-Look) degradieren — außerhalb der
      // React-Commits malt niemand neu. Jetzt wird die native Selektion
      // direkt nach dem Klick wiederhergestellt.
      tryShowPending();
    }
  });
  // Kollabiert die Selektion zwischen zwei React-Commits (mousedown im
  // Popup), sofort reagieren — sonst wäre das Zitat für die Dauer der
  // Popup-Interaktion unmarkiert.
  document.addEventListener('selectionchange', tryShowPending);
}

// Steht der Fokus in einem Eingabefeld, würde removeAllRanges/addRange dem
// Nutzer den Caret klauen (z. B. beim Tippen der Frage im Popup).
function isTextEntryFocused(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
}

// Überschneidet sich die live Selektion mit der pending Range? Dann zeigt
// die native Selektion das Zitat bereits an.
function liveSelectionShowsPending(range: Range): boolean {
  const live = window.getSelection?.();
  if (!live || live.rangeCount === 0 || live.isCollapsed) return false;
  try {
    const lr = live.getRangeAt(0);
    return (
      lr.compareBoundaryPoints(Range.END_TO_START, range) < 0 &&
      lr.compareBoundaryPoints(Range.START_TO_END, range) > 0
    );
  } catch (_err) {
    return false;
  }
}

// Kern der Zweistufigkeit: native Selektion zeigen, wo immer möglich —
// ::highlight-Fallback nur, wenn das Wiederherstellen gerade stören würde
// (Maus-Drag, Fokus im Eingabefeld, fremde Selektion). Läuft aus den
// Paint-Effekten UND aus den globalen Listenern (mouseup/selectionchange),
// damit auch Klicks ZWISCHEN React-Commits den Image-1-Look zurückholen.
function tryShowPending(): void {
  if (!pendingRange) return;
  const live = window.getSelection?.();
  if (live && liveSelectionShowsPending(pendingRange)) {
    // Die Selektion zeigt das Zitat bereits — nichts doppelt malen (der
    // Fallback-Stil unter der halbtransparenten Selektion verdunkelt sie).
    CSS.highlights.delete(PENDING_STYLE);
    return;
  }
  const collapsed = !live || live.rangeCount === 0 || live.isCollapsed;
  if (live && collapsed && !leftMouseDown && !isTextEntryFocused()) {
    try {
      live.removeAllRanges();
      live.addRange(pendingRange);
      CSS.highlights.delete(PENDING_STYLE);
      return;
    } catch (_err) {
      // Range zwischen Aufbau und addRange detached (Re-Render-Rennen) —
      // unten greift der Fallback-Stil.
    }
  }
  // Nutzer hat woanders selektiert, tippt gerade oder zieht mit der Maus:
  // Selektion nicht klauen, Fallback-Stil zeigt das Zitat weiter an.
  CSS.highlights.set(PENDING_STYLE, new Highlight(pendingRange));
}

// Pending-Zustand komplett fallen lassen (Popup zu / Aktion erfolgt /
// Unmount). WICHTIG: die programmatisch wiederhergestellte native Selektion
// mit abräumen — bleibt sie liegen, erfasst der nächste Rechtsklick den
// ALTEN Text (Nutzer-Report 2026-07-22, 2. Runde). Fremde Selektionen
// (kein Überlappen mit der Pending-Range) bleiben unangetastet.
function dropPending(): void {
  const live = window.getSelection?.();
  if (pendingRange && live && liveSelectionShowsPending(pendingRange)) {
    live.removeAllRanges();
  }
  pendingOwner = null;
  pendingRange = null;
  CSS.highlights.delete(PENDING_STYLE);
}

// Jede Bubble ruft das in ihrem Paint-Effekt auf: der Besitzer malt seine
// Range (jedes Commit neu, gegen den aktuellen DOM), alle anderen räumen nur
// dann auf, wenn sie zuvor Besitzer waren.
export function paintPendingChatSelection(
  messageId: string,
  root: Node,
  sel: { startOffset: number; endOffset: number } | null,
): void {
  if (!supportsCustomHighlights) return;
  if (!sel) {
    if (pendingOwner === messageId) dropPending();
    return;
  }
  installPendingListeners();
  pendingOwner = messageId;
  pendingRange = rangeFromOffsets(root, sel.startOffset, sel.endOffset);
  if (!pendingRange) {
    CSS.highlights.delete(PENDING_STYLE);
    return;
  }
  tryShowPending();
}

export function clearPendingChatSelection(messageId: string): void {
  if (!supportsCustomHighlights) return;
  if (pendingOwner !== messageId) return;
  dropPending();
}

// ─── Sprung-Flash (Highlights-Drawer) ────────────────────────────────────────
// Nach einem Drawer-Sprung blinkt die MARKIERUNG selbst auf, nicht die ganze
// Bubble (Nutzerkorrektur 2026-07-22) — und zwar in IHRER Farbe, wie beim
// PDF (Nutzerkorrektur 2026-07-22, 2. Runde): pro Farbe ein eigener Stil
// ::highlight(syflo-chat-hl-flash-<farbe>) in index.css. Das Blinken taktet
// ChatArea per State-Toggle, weil ::highlight()-Pseudoelemente nicht
// animierbar sind. priority hebt den Flash über die Farb-Stile, egal in
// welcher Reihenfolge registriert wurde.

const flashStyleName = (color: HighlightColor) => `syflo-chat-hl-flash-${color}`;
let flashOwner: string | null = null;
let flashStyle: string | null = null;

export function paintFlashChatRange(
  messageId: string,
  root: Node,
  sel: { startOffset: number; endOffset: number; color: HighlightColor } | null,
): void {
  if (!supportsCustomHighlights) return;
  if (!sel) {
    if (flashOwner === messageId) {
      flashOwner = null;
      if (flashStyle) CSS.highlights.delete(flashStyle);
      flashStyle = null;
    }
    return;
  }
  flashOwner = messageId;
  const style = flashStyleName(sel.color);
  if (flashStyle && flashStyle !== style) CSS.highlights.delete(flashStyle);
  const range = rangeFromOffsets(root, sel.startOffset, sel.endOffset);
  if (range) {
    const highlight = new Highlight(range);
    highlight.priority = 2;
    CSS.highlights.set(style, highlight);
    flashStyle = style;
  } else {
    CSS.highlights.delete(style);
    flashStyle = null;
  }
}

export function clearFlashChatRange(messageId: string): void {
  if (!supportsCustomHighlights) return;
  if (flashOwner !== messageId) return;
  flashOwner = null;
  if (flashStyle) CSS.highlights.delete(flashStyle);
  flashStyle = null;
}
