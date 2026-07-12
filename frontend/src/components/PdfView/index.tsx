/**
 * components/PdfView/index.tsx
 *
 * Center column of the three-column view (design/mockup-pdf-layout.html):
 * a toolbar with zoom controls and a page indicator, above a gray scroll
 * area with one white page card (canvas) per PDF page. Rendering goes
 * through the pdfDocument wrapper so pdf.js stays out of component tests.
 */

import { useEffect, useRef, useState } from 'react';
import { Minus, Plus, ChevronLeft, ChevronRight, FileText } from 'lucide-react';
import { loadPdfDocument, type PdfDocumentHandle } from '../../pdf/pdfDocument';

interface Props {
  pdfUrl: string;
  title?: string;
}

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3;
const ZOOM_STEP = 0.25;

export function PdfView({ pdfUrl, title }: Props) {
  const [doc, setDoc] = useState<PdfDocumentHandle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [currentPage, setCurrentPage] = useState(1);
  const canvasRefs = useRef<(HTMLCanvasElement | null)[]>([]);

  useEffect(() => {
    let cancelled = false;
    let handle: PdfDocumentHandle | null = null;
    setDoc(null);
    setError(null);
    setCurrentPage(1);
    loadPdfDocument(pdfUrl)
      .then(h => {
        if (cancelled) { h.destroy?.(); return; }
        handle = h;
        setDoc(h);
      })
      .catch(err => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load PDF');
      });
    return () => {
      cancelled = true;
      handle?.destroy?.();
    };
  }, [pdfUrl]);

  // (Re-)render every page whenever the document or the zoom changes.
  useEffect(() => {
    if (!doc) return;
    for (let p = 1; p <= doc.numPages; p++) {
      const canvas = canvasRefs.current[p - 1];
      if (canvas) void doc.renderPage(p, canvas, zoom);
    }
  }, [doc, zoom]);

  const goToPage = (page: number) => {
    if (!doc) return;
    const clamped = Math.min(Math.max(page, 1), doc.numPages);
    setCurrentPage(clamped);
    canvasRefs.current[clamped - 1]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-gray-100">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-4 py-2 bg-white border-b border-gray-200 shrink-0">
        <div className="flex items-center gap-2 min-w-0 flex-1 text-sm text-gray-700">
          <FileText size={15} className="text-gray-400 shrink-0" />
          <span className="truncate">{title || 'PDF'}</span>
        </div>
        <div className="flex items-center gap-1 bg-gray-50 border border-gray-200 rounded-lg px-1 py-0.5">
          <button
            onClick={() => setZoom(z => Math.max(ZOOM_MIN, z - ZOOM_STEP))}
            className="w-7 h-7 flex items-center justify-center rounded-md text-gray-500 hover:text-gray-900 hover:bg-gray-100"
            title="Zoom out"
            data-testid="pdf-zoom-out"
          >
            <Minus size={14} />
          </button>
          <span className="text-xs text-gray-700 w-12 text-center tabular-nums" data-testid="pdf-zoom-level">
            {Math.round(zoom * 100)}%
          </span>
          <button
            onClick={() => setZoom(z => Math.min(ZOOM_MAX, z + ZOOM_STEP))}
            className="w-7 h-7 flex items-center justify-center rounded-md text-gray-500 hover:text-gray-900 hover:bg-gray-100"
            title="Zoom in"
            data-testid="pdf-zoom-in"
          >
            <Plus size={14} />
          </button>
        </div>
        <div className="flex items-center gap-1 text-xs text-gray-700">
          <button
            onClick={() => goToPage(currentPage - 1)}
            className="w-7 h-7 flex items-center justify-center rounded-md text-gray-500 hover:text-gray-900 hover:bg-gray-100"
            title="Previous page"
            data-testid="pdf-prev-page"
          >
            <ChevronLeft size={14} />
          </button>
          <span className="tabular-nums" data-testid="pdf-page-indicator">
            {currentPage} / {doc?.numPages ?? '–'}
          </span>
          <button
            onClick={() => goToPage(currentPage + 1)}
            className="w-7 h-7 flex items-center justify-center rounded-md text-gray-500 hover:text-gray-900 hover:bg-gray-100"
            title="Next page"
            data-testid="pdf-next-page"
          >
            <ChevronRight size={14} />
          </button>
        </div>
      </div>

      {/* Pages */}
      <div className="flex-1 overflow-auto p-6">
        {error && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3 max-w-md mx-auto">
            Could not load PDF: {error}
          </div>
        )}
        {doc && (
          <div className="flex flex-col items-center gap-4">
            {Array.from({ length: doc.numPages }, (_, i) => (
              <canvas
                key={i}
                ref={el => { canvasRefs.current[i] = el; }}
                className="bg-white rounded shadow-md"
                data-testid="pdf-page-canvas"
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
