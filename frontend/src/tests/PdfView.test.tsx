/**
 * PdfView.test.tsx
 *
 * Tests for the center-column PDF viewer (slice 03): loading a document from
 * its pdf_url, rendering one canvas per page, and the zoom controls.
 * pdf.js itself is mocked behind the loadPdfDocument wrapper module.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PdfView } from '../components/PdfView';

const renderPage = vi.fn().mockResolvedValue(undefined);
const renderTextLayer = vi.fn().mockResolvedValue(undefined);
const loadPdfDocument = vi.fn();

vi.mock('../pdf/pdfDocument', () => ({
  loadPdfDocument: (url: string) => loadPdfDocument(url),
}));

beforeEach(() => {
  renderPage.mockClear();
  renderTextLayer.mockClear();
  loadPdfDocument.mockReset();
  loadPdfDocument.mockResolvedValue({ numPages: 3, renderPage, renderTextLayer });
});

describe('PdfView', () => {
  it('loads the document from pdf_url and renders one canvas per page', async () => {
    render(<PdfView pdfUrl="/api/papers/p1/pdf" />);
    expect(loadPdfDocument).toHaveBeenCalledWith('/api/papers/p1/pdf');
    await waitFor(() => {
      expect(screen.getAllByTestId('pdf-page-canvas').length).toBe(3);
    });
    // Page indicator shows the total.
    expect(screen.getByTestId('pdf-page-indicator')).toHaveTextContent('1 / 3');
  });

  it('zooms in and out in 25% steps and re-renders pages at the new scale', async () => {
    render(<PdfView pdfUrl="/api/papers/p1/pdf" />);
    await waitFor(() => expect(screen.getAllByTestId('pdf-page-canvas').length).toBe(3));
    expect(screen.getByTestId('pdf-zoom-level')).toHaveTextContent('100%');

    renderPage.mockClear();
    fireEvent.click(screen.getByTestId('pdf-zoom-in'));
    expect(screen.getByTestId('pdf-zoom-level')).toHaveTextContent('125%');
    await waitFor(() => {
      expect(renderPage).toHaveBeenCalledWith(1, expect.anything(), 1.25);
    });

    fireEvent.click(screen.getByTestId('pdf-zoom-out'));
    fireEvent.click(screen.getByTestId('pdf-zoom-out'));
    expect(screen.getByTestId('pdf-zoom-level')).toHaveTextContent('75%');
  });

  it('does not zoom below 50% or above 300%', async () => {
    render(<PdfView pdfUrl="/api/papers/p1/pdf" />);
    await waitFor(() => expect(screen.getAllByTestId('pdf-page-canvas').length).toBe(3));
    for (let i = 0; i < 20; i++) fireEvent.click(screen.getByTestId('pdf-zoom-out'));
    expect(screen.getByTestId('pdf-zoom-level')).toHaveTextContent('50%');
    for (let i = 0; i < 20; i++) fireEvent.click(screen.getByTestId('pdf-zoom-in'));
    expect(screen.getByTestId('pdf-zoom-level')).toHaveTextContent('300%');
  });

  it('rendert den selektierbaren Text-Layer für jede Seite', async () => {
    render(<PdfView pdfUrl="/api/papers/p1/pdf" />);
    await waitFor(() => expect(screen.getAllByTestId('pdf-page-canvas').length).toBe(3));
    await waitFor(() => {
      expect(renderTextLayer).toHaveBeenCalledWith(1, expect.anything(), 1);
      expect(renderTextLayer).toHaveBeenCalledWith(3, expect.anything(), 1);
    });
    expect(screen.getByTestId('pdf-text-layer-2')).toBeInTheDocument();
  });

  describe('Highlight-Overlays (Slice 04 — zoom-sicher)', () => {
    const highlight = {
      id: 'h1',
      paperId: 'p1',
      color: 'yellow' as const,
      text: 'imitation learning',
      pageNumber: 2,
      rects: [
        { left: 50, top: 25, width: 200, height: 12 },
        { left: 50, top: 41, width: 120, height: 12 },
      ],
      chatId: null,
      createdAt: 'x',
      updatedAt: 'x',
    };

    it('zeichnet ein Multi-Rect-Overlay nur auf der eigenen Seite', async () => {
      render(<PdfView pdfUrl="/api/papers/p1/pdf" highlights={[highlight]} />);
      await waitFor(() => expect(screen.getAllByTestId('pdf-color-highlight-h1').length).toBe(2));
      const page2 = screen.getByTestId('pdf-page-2');
      for (const el of screen.getAllByTestId('pdf-color-highlight-h1')) {
        expect(page2).toContainElement(el);
        expect(el.getAttribute('data-color')).toBe('yellow');
      }
    });

    it('skaliert ALLE VIER Rect-Werte mit dem Zoom (Regression: Syflo-Zoom-Bug)', async () => {
      render(<PdfView pdfUrl="/api/papers/p1/pdf" highlights={[highlight]} />);
      await waitFor(() => expect(screen.getAllByTestId('pdf-color-highlight-h1').length).toBe(2));

      const at100 = screen.getAllByTestId('pdf-color-highlight-h1')[0];
      expect(at100.style.left).toBe('50px');
      expect(at100.style.top).toBe('25px');
      expect(at100.style.width).toBe('200px');
      expect(at100.style.height).toBe('12px');

      fireEvent.click(screen.getByTestId('pdf-zoom-in')); // 125%
      const at125 = screen.getAllByTestId('pdf-color-highlight-h1')[0];
      expect(at125.style.left).toBe('62.5px');
      expect(at125.style.top).toBe('31.25px');
      // Der eigentliche Bug: Breite/Höhe blieben in Syflo bei 200/12 hängen.
      expect(at125.style.width).toBe('250px');
      expect(at125.style.height).toBe('15px');
    });

    it('Klick auf ein Highlight ruft onColorHighlightClick auf', async () => {
      const onColorHighlightClick = vi.fn();
      render(
        <PdfView
          pdfUrl="/api/papers/p1/pdf"
          highlights={[highlight]}
          onColorHighlightClick={onColorHighlightClick}
        />,
      );
      await waitFor(() => expect(screen.getAllByTestId('pdf-color-highlight-h1').length).toBe(2));
      fireEvent.click(screen.getAllByTestId('pdf-color-highlight-h1')[0]);
      expect(onColorHighlightClick).toHaveBeenCalledWith(highlight, expect.anything());
    });
  });

  describe('Rechtsklick-Erfassung', () => {
    it('meldet null, wenn keine Selektion existiert, und lässt das Event zum Popup-Handler durch', async () => {
      const onCaptureHighlight = vi.fn();
      const onContextMenu = vi.fn();
      render(
        <PdfView
          pdfUrl="/api/papers/p1/pdf"
          onCaptureHighlight={onCaptureHighlight}
          onContextMenu={onContextMenu}
        />,
      );
      await waitFor(() => expect(screen.getAllByTestId('pdf-page-canvas').length).toBe(3));
      fireEvent.contextMenu(screen.getByTestId('pdf-page-1'));
      expect(onCaptureHighlight).toHaveBeenCalledWith(null);
      expect(onContextMenu).toHaveBeenCalled();
    });
  });
});
