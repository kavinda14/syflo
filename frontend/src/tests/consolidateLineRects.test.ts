/**
 * consolidateLineRects.test.ts
 *
 * Regression tests for the "ugly highlight" bug: Chrome's
 * range.getClientRects() returns near-duplicate rects for the same visual
 * line (element box + text box) and font boxes taller than the PDF's line
 * leading, so the multiply-blended overlay showed dark double-tinted bands
 * and stray tall blocks. consolidateLineRects must return exactly one
 * non-overlapping rect per visual line.
 */

import { describe, it, expect } from 'vitest';
import { consolidateLineRects, type ClientRectLike } from '../pdf/selection';

function rect(left: number, top: number, width: number, height: number): ClientRectLike {
  return { left, top, width, height, right: left + width, bottom: top + height };
}

describe('consolidateLineRects', () => {
  it('merges same-line duplicate rects (element box + text box)', () => {
    // Real data from the MobileNetV2 abstract highlight: line 2 appeared
    // twice with slightly different top/height.
    const out = consolidateLineRects([
      rect(88.04, 240.69, 334.55, 18.5), // line 1
      rect(71.97, 254.15, 357.84, 16), // line 2 (text box)
      rect(71.97, 252.65, 357.84, 18.5), // line 2 duplicate (element box)
      rect(71.97, 264.61, 61.73, 18.5), // line 3
    ]);
    expect(out).toHaveLength(3);
  });

  it('trims vertical overlap between consecutive lines (no dark bands)', () => {
    const out = consolidateLineRects([
      rect(88, 240, 334, 18.5), // bottom 258.5 …
      rect(72, 254, 358, 18.5), // … overlaps top 254
      rect(72, 268, 62, 18.5),
    ]);
    for (let i = 1; i < out.length; i += 1) {
      const prevBottom = out[i - 1].top + out[i - 1].height;
      expect(out[i].top).toBeGreaterThanOrEqual(prevBottom);
    }
    // Coverage is preserved: the union still spans first top to last bottom.
    expect(out[0].top).toBeCloseTo(240);
    expect(out[2].top + out[2].height).toBeCloseTo(286.5);
  });

  it('drops a container rect spanning multiple lines', () => {
    const out = consolidateLineRects([
      rect(70, 100, 300, 42), // container: covers both lines below
      rect(70, 100, 300, 14),
      rect(70, 118, 200, 14),
      rect(70, 136, 100, 14),
    ]);
    expect(out).toHaveLength(3);
    expect(Math.max(...out.map((r) => r.height))).toBeLessThan(20);
  });

  it('keeps a legitimately taller heading rect (no other rects inside)', () => {
    const out = consolidateLineRects([
      rect(70, 100, 300, 28), // heading line, larger font
      rect(70, 140, 300, 14),
    ]);
    expect(out).toHaveLength(2);
    expect(out[0].height).toBeCloseTo(28);
  });

  it('passes single-rect selections through untouched', () => {
    const [out] = consolidateLineRects([rect(147.13, 564.52, 120.07, 18.4)]);
    expect(out.left).toBeCloseTo(147.13);
    expect(out.top).toBeCloseTo(564.52);
    expect(out.width).toBeCloseTo(120.07);
    expect(out.height).toBeCloseTo(18.4);
  });

  it('returns [] for empty input', () => {
    expect(consolidateLineRects([])).toEqual([]);
  });
});
