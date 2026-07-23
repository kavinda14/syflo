/**
 * highlightAnchors.test.ts
 *
 * Pure offset math behind chat-text highlights: mapping character offsets in
 * a root's concatenated text to live DOM Ranges and back. The paint layer
 * (CSS Custom Highlight API) is feature-guarded and untestable in jsdom —
 * these tests pin down the anchor arithmetic it feeds on.
 */

import { describe, it, expect } from 'vitest';
import { rangeFromOffsets, textOffsetInRoot } from '../chat/highlightAnchors';
import { splitLeadingQuote } from '../chat/messageQuote';

function makeRoot(html: string): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = html;
  document.body.appendChild(root);
  return root;
}

describe('rangeFromOffsets', () => {
  it('resolves offsets within a single text node', () => {
    const root = makeRoot('<p>Hello bold world</p>');
    const range = rangeFromOffsets(root, 6, 10);
    expect(range?.toString()).toBe('bold');
  });

  it('resolves offsets across element boundaries', () => {
    // Text: "Hello bold world" split over three nodes by <strong>.
    const root = makeRoot('<p>Hello <strong>bold</strong> world</p>');
    expect(rangeFromOffsets(root, 6, 10)?.toString()).toBe('bold');
    expect(rangeFromOffsets(root, 3, 14)?.toString()).toBe('lo bold wor');
  });

  it('resolves an offset landing exactly on a node boundary', () => {
    const root = makeRoot('<p>Hello <strong>bold</strong> world</p>');
    // start 6 is exactly the end of "Hello " — the range must start in the
    // <strong> text node, not dangle at the end of the previous one.
    const range = rangeFromOffsets(root, 6, 16);
    expect(range?.toString()).toBe('bold world');
  });

  it('returns null when offsets exceed the text (content changed)', () => {
    const root = makeRoot('<p>short</p>');
    expect(rangeFromOffsets(root, 2, 99)).toBeNull();
  });

  it('returns null for degenerate offsets', () => {
    const root = makeRoot('<p>text</p>');
    expect(rangeFromOffsets(root, -1, 2)).toBeNull();
    expect(rangeFromOffsets(root, 3, 3)).toBeNull();
  });
});

describe('textOffsetInRoot', () => {
  it('round-trips with rangeFromOffsets across nested markup', () => {
    const root = makeRoot('<p>One <em>two</em> three</p><p>four</p>');
    const range = rangeFromOffsets(root, 4, 13)!; // "two three" + boundary into 2nd <p>
    const start = textOffsetInRoot(root, range.startContainer, range.startOffset);
    const end = textOffsetInRoot(root, range.endContainer, range.endOffset);
    expect(start).toBe(4);
    expect(end).toBe(13);
  });
});

describe('splitLeadingQuote', () => {
  it('splits a leading blockquote from the question', () => {
    const { quote, rest } = splitLeadingQuote('> line one\n> line two\n\nWhy is that?');
    expect(quote).toBe('line one\nline two');
    expect(rest).toBe('Why is that?');
  });

  it('returns null quote when the message has no leading quote', () => {
    const { quote, rest } = splitLeadingQuote('Just a question\n> not leading');
    expect(quote).toBeNull();
    expect(rest).toBe('Just a question\n> not leading');
  });

  it('handles a quote-only message', () => {
    const { quote, rest } = splitLeadingQuote('> only quote');
    expect(quote).toBe('only quote');
    expect(rest).toBe('');
  });
});
