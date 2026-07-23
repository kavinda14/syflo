/**
 * tests/pendingSelectionRestore.test.ts
 *
 * Nutzer-Report 2026-07-22 (2. Runde): Die Pending-Selektion (Popup offen)
 * darf nach einem Klick irgendwo im Text NICHT dauerhaft auf den
 * ::highlight-Fallback (Inline-Box, Lücken zwischen Zeilen) degradieren —
 * nach dem Klick wird die native Selektion wiederhergestellt. Und beim
 * Schließen des Popups darf die programmatisch wiederhergestellte Selektion
 * nicht liegen bleiben — sonst markiert der nächste Rechtsklick den alten
 * Text.
 *
 * jsdom hat keine Custom Highlight API — CSS.highlights und Highlight werden
 * vor dem Modul-Import gestubbt (Muster aus flashChatColor.test.ts).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.stubGlobal(
  'Highlight',
  class {
    priority = 0;
    ranges: unknown[];
    constructor(...ranges: unknown[]) {
      this.ranges = ranges;
    }
  },
);
vi.stubGlobal('CSS', { highlights: new Map<string, unknown>() });

const { paintPendingChatSelection, clearPendingChatSelection } = await import(
  '../chat/highlightAnchors'
);

const registry = () => (CSS as unknown as { highlights: Map<string, unknown> }).highlights;
const PENDING = 'syflo-chat-hl-pending';

const mkRoot = () => {
  const div = document.createElement('div');
  div.textContent = 'The marked passage lives in this bubble.';
  document.body.appendChild(div);
  return div;
};

const selectionText = () => window.getSelection()?.toString() ?? '';

describe('pending selection: native restore + cleanup', () => {
  beforeEach(() => {
    registry().clear();
    window.getSelection()?.removeAllRanges();
    document.body.innerHTML = '';
  });

  it('stellt bei kollabierter Selektion die native Selektion wieder her (kein Fallback-Stil)', () => {
    const root = mkRoot();
    paintPendingChatSelection('m1', root, { startOffset: 4, endOffset: 18 });

    expect(selectionText()).toBe('marked passage');
    expect(registry().has(PENDING)).toBe(false);
  });

  it('nach einem Klick (collapse → mouseup) kommt die native Selektion zurück', () => {
    const root = mkRoot();
    paintPendingChatSelection('m1', root, { startOffset: 4, endOffset: 18 });

    // Klick woanders: mousedown kollabiert die Selektion …
    document.dispatchEvent(new MouseEvent('mousedown', { button: 0 }));
    window.getSelection()?.removeAllRanges();
    document.dispatchEvent(new Event('selectionchange'));
    // … während der Maus-Taste zeigt der Fallback-Stil das Zitat …
    expect(registry().has(PENDING)).toBe(true);

    // … und nach mouseup wird die native Selektion wiederhergestellt.
    document.dispatchEvent(new MouseEvent('mouseup', { button: 0 }));
    expect(selectionText()).toBe('marked passage');
    expect(registry().has(PENDING)).toBe(false);
  });

  it('Schließen räumt die programmatisch wiederhergestellte Selektion ab', () => {
    const root = mkRoot();
    paintPendingChatSelection('m1', root, { startOffset: 4, endOffset: 18 });
    expect(selectionText()).toBe('marked passage');

    // Popup schließt → App übergibt sel: null.
    paintPendingChatSelection('m1', root, null);
    expect(selectionText()).toBe('');
    expect(registry().has(PENDING)).toBe(false);
  });

  it('clearPendingChatSelection (Unmount) räumt ebenfalls ab', () => {
    const root = mkRoot();
    paintPendingChatSelection('m1', root, { startOffset: 4, endOffset: 18 });
    clearPendingChatSelection('m1');
    expect(selectionText()).toBe('');
    expect(registry().has(PENDING)).toBe(false);
  });

  it('eine eigene, fremde Selektion des Nutzers wird beim Schließen NICHT angefasst', () => {
    const root = mkRoot();
    paintPendingChatSelection('m1', root, { startOffset: 4, endOffset: 18 });

    // Nutzer selektiert etwas ganz anderes (kein Überlappen mit der Pending-Range).
    const other = document.createElement('div');
    other.textContent = 'completely different text';
    document.body.appendChild(other);
    const r = document.createRange();
    r.selectNodeContents(other);
    const live = window.getSelection()!;
    live.removeAllRanges();
    live.addRange(r);

    paintPendingChatSelection('m1', root, null);
    expect(selectionText()).toBe('completely different text');
  });
});
