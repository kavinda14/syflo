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
const loadPdfDocument = vi.fn();

vi.mock('../pdf/pdfDocument', () => ({
  loadPdfDocument: (url: string) => loadPdfDocument(url),
}));

beforeEach(() => {
  renderPage.mockClear();
  loadPdfDocument.mockReset();
  loadPdfDocument.mockResolvedValue({ numPages: 3, renderPage });
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
});
