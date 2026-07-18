/**
 * highlightZoom.test.ts
 *
 * Regression test for Syflo's zoom bug (Slice 04): rect positions were
 * normalized by zoom on capture but width/height were NOT, so a highlight
 * was only correctly sized at its creation zoom. Syflo normalizes all
 * four values (normalizeRectsToZoom) and multiplies all four at render
 * time (PdfView overlay styles) — captured at zoom A, a highlight must
 * reproduce the exact client-space geometry at any zoom B.
 */

import { describe, it, expect } from 'vitest';
import { normalizeRectsToZoom, type ClientRectLike } from '../pdf/selection';

const pageRect: ClientRectLike = {
  left: 300, top: 100, right: 912, bottom: 892, width: 612, height: 792,
};

function clientRect(left: number, top: number, width: number, height: number): ClientRectLike {
  return { left, top, width, height, right: left + width, bottom: top + height };
}

// Render-side counterpart of the PdfView overlay styles.
function renderAtZoom(r: { left: number; top: number; width: number; height: number }, zoom: number) {
  return { left: r.left * zoom, top: r.top * zoom, width: r.width * zoom, height: r.height * zoom };
}

describe('zoom-safe highlight geometry (Slice-04 regression)', () => {
  it('normalizes all four rect values by the capture zoom', () => {
    const zoom = 2;
    // A line rect as the browser reports it at zoom=2.
    const line = clientRect(300 + 100, 100 + 50, 400, 24);
    const [rect] = normalizeRectsToZoom([line], pageRect, zoom);
    expect(rect).toEqual({ left: 50, top: 25, width: 200, height: 12 });
  });

  it('captured at zoom A, renders with correct geometry at zoom B', () => {
    // The same physical text span seen by the browser at two zoom levels:
    // at zoom=1 it occupies page-local (50, 25, 200×12).
    const capturedAt = (zoom: number) =>
      clientRect(pageRect.left + 50 * zoom, pageRect.top + 25 * zoom, 200 * zoom, 12 * zoom);

    const zoomA = 0.75;
    const zoomB = 2.5;
    const [stored] = normalizeRectsToZoom([capturedAt(zoomA)], pageRect, zoomA);
    const rendered = renderAtZoom(stored, zoomB);

    // Expected: exactly where the text sits at zoom B (page-local px).
    expect(rendered.left).toBeCloseTo(50 * zoomB, 6);
    expect(rendered.top).toBeCloseTo(25 * zoomB, 6);
    expect(rendered.width).toBeCloseTo(200 * zoomB, 6);
    expect(rendered.height).toBeCloseTo(12 * zoomB, 6);
  });

  it("Syflo's raw-pixel width/height would fail at a different zoom (documents the fixed bug)", () => {
    const zoomA = 2;
    const zoomB = 1;
    const line = clientRect(pageRect.left + 50 * zoomA, pageRect.top + 25 * zoomA, 200 * zoomA, 12 * zoomA);

    // Syflo's capture: width/height NOT divided by zoom.
    const syfloStored = {
      left: (line.left - pageRect.left) / zoomA,
      top: (line.top - pageRect.top) / zoomA,
      width: line.width,
      height: line.height,
    };
    // Syflo's render: width/height NOT multiplied by zoom.
    const syfloRendered = {
      left: syfloStored.left * zoomB,
      top: syfloStored.top * zoomB,
      width: syfloStored.width,
      height: syfloStored.height,
    };
    // At zoom B the text is 200px wide — Syflo would draw 400px (the size
    // frozen at creation zoom). Our normalize/render pair gets it right.
    expect(syfloRendered.width).not.toBeCloseTo(200 * zoomB, 6);
    const [fixed] = normalizeRectsToZoom([line], pageRect, zoomA);
    expect(renderAtZoom(fixed, zoomB).width).toBeCloseTo(200 * zoomB, 6);
  });

  it('drops rects that lie outside the page', () => {
    const inside = clientRect(400, 200, 100, 12);
    const outside = clientRect(2000, 2000, 100, 12);
    const rects = normalizeRectsToZoom([inside, outside], pageRect, 1);
    expect(rects).toHaveLength(1);
  });
});
