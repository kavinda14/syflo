/**
 * tests/flashChatColor.test.ts
 *
 * Der Drawer-Sprung-Flash blinkt die Chat-Markierung in IHRER Farbe an —
 * wie bei den PDF-Highlights (Nutzerkorrektur 2026-07-22, 2. Runde).
 * Pro Farbe ein eigener ::highlight-Stil `syflo-chat-hl-flash-<farbe>`
 * (index.css); jsdom hat keine Custom Highlight API, darum werden CSS.highlights
 * und Highlight VOR dem Modul-Import gestubbt (supportsCustomHighlights wird
 * beim Import ausgewertet).
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

const { paintFlashChatRange, clearFlashChatRange } = await import('../chat/highlightAnchors');

const registry = () => (CSS as unknown as { highlights: Map<string, unknown> }).highlights;

const mkRoot = () => {
  const div = document.createElement('div');
  div.textContent = 'The marked passage lives here.';
  return div;
};

describe('drawer jump flash in highlight color', () => {
  beforeEach(() => registry().clear());

  it('paints the flash with the style of the highlight color', () => {
    paintFlashChatRange('m1', mkRoot(), { startOffset: 4, endOffset: 10, color: 'green' });

    expect(registry().has('syflo-chat-hl-flash-green')).toBe(true);
  });

  it('replaces the previous style when a different color flashes', () => {
    const root = mkRoot();
    paintFlashChatRange('m1', root, { startOffset: 0, endOffset: 3, color: 'green' });
    paintFlashChatRange('m1', root, { startOffset: 0, endOffset: 3, color: 'pink' });

    expect(registry().has('syflo-chat-hl-flash-green')).toBe(false);
    expect(registry().has('syflo-chat-hl-flash-pink')).toBe(true);
  });

  it('clearFlashChatRange removes the painted color style', () => {
    paintFlashChatRange('m1', mkRoot(), { startOffset: 0, endOffset: 3, color: 'orange' });
    clearFlashChatRange('m1');

    expect(registry().has('syflo-chat-hl-flash-orange')).toBe(false);
  });

  it('painting null clears the owner’s flash (blink-off phase)', () => {
    const root = mkRoot();
    paintFlashChatRange('m1', root, { startOffset: 0, endOffset: 3, color: 'yellow' });
    paintFlashChatRange('m1', root, null);

    expect(registry().has('syflo-chat-hl-flash-yellow')).toBe(false);
  });
});
