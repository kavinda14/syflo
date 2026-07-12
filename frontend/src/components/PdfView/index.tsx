/**
 * components/PdfView/index.tsx
 *
 * Center column of the three-column view (design/mockup-pdf-layout.html):
 * a toolbar with zoom controls and a page indicator, above a gray scroll
 * area with one white page card per PDF page. Each page renders a canvas
 * plus the selectable pdf.js text layer, with persistent colored highlight
 * overlays on top (design/mockup-paper-pdf-highlights-v2.html).
 *
 * Highlight geometry (the zoom-safe fix, Slice 04): rects are stored in
 * zoom=1 page-local coordinates with ALL FOUR values normalized by the
 * capture zoom, and all four multiplied by the live zoom at render time.
 * Syflo only normalized left/top (its comments claimed pdf.js keeps span
 * sizes constant across zoom — wrong for modern pdf.js), so highlights were
 * only correctly sized at their creation zoom. Rendering goes through the
 * pdfDocument wrapper so pdf.js stays out of component tests.
 */

import { useEffect, useRef, useState } from 'react';
import { Minus, Plus, ChevronLeft, ChevronRight, FileText } from 'lucide-react';
import { loadPdfDocument, type PdfDocumentHandle } from '../../pdf/pdfDocument';
import {
  computeTightLineRects,
  constrainSelectionToColumn,
  extractColumnAwareSelectionText,
  normalizeRectsToZoom,
} from '../../pdf/selection';
import type { Highlight, HighlightColor, HighlightRect } from '../../types';

// Captured at right-click time so the FloatingPopup can save a colored
// highlight against the actual user selection (multi-line, column-aware).
export interface PdfHighlightSelection {
  pageNumber: number;
  text: string;
  rects: HighlightRect[];
}

interface Props {
  pdfUrl: string;
  title?: string;
  // Persistent colored highlights, drawn as multi-rect overlays per page.
  highlights?: Highlight[];
  // Right-click over a page: receives the captured selection (or null when
  // there's no live selection), then the event bubbles to onContextMenu so
  // the parent can open the FloatingPopup.
  onCaptureHighlight?: (sel: PdfHighlightSelection | null) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  // Click an existing highlight → the parent opens the actions menu.
  onColorHighlightClick?: (highlight: Highlight, e: React.MouseEvent) => void;
}

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3;
const ZOOM_STEP = 0.25;

// Tailwind class per highlight color — same pastel palette as the
// FloatingPopup swatches (mockup-popup-edit-labels.html).
const HIGHLIGHT_BG_CLASS: Record<HighlightColor, string> = {
  yellow: 'bg-[#FEF08A]',
  green: 'bg-[#BBF7D0]',
  blue: 'bg-[#BFDBFE]',
  pink: 'bg-[#FBCFE8]',
  orange: 'bg-[#FED7AA]',
};

// Find the page wrapper that owns a DOM node (selection anchor or event
// target). Pages carry data-testid="pdf-page-N".
function findPageWrapper(node: Node | HTMLElement | null): HTMLElement | null {
  let el: HTMLElement | null = null;
  if (node && node.nodeType === Node.ELEMENT_NODE) {
    el = node as HTMLElement;
  } else if (node && node.parentElement) {
    el = node.parentElement;
  }
  return el?.closest?.('[data-testid^="pdf-page-"]') as HTMLElement | null;
}

function pageNumberOf(wrapper: HTMLElement): number | null {
  const tid = wrapper.getAttribute('data-testid') ?? '';
  const n = Number(tid.slice('pdf-page-'.length));
  return n && !Number.isNaN(n) ? n : null;
}

export function PdfView({
  pdfUrl,
  title,
  highlights,
  onCaptureHighlight,
  onContextMenu,
  onColorHighlightClick,
}: Props) {
  const [doc, setDoc] = useState<PdfDocumentHandle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [currentPage, setCurrentPage] = useState(1);
  const containerRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  // Re-entrancy guard for the column-aware selection rewrite (see the
  // mouseup effect below) — addRange() can synthesise a selectionchange.
  const isConstrainingRef = useRef(false);
  // Transient selection overlay: one tight rect per visible line while the
  // user has live text selected. Replaces the native blocky selection paint.
  const [transientSelection, setTransientSelection] = useState<{
    pageNumber: number;
    rects: HighlightRect[];
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    let handle: PdfDocumentHandle | null = null;
    setDoc(null);
    setError(null);
    setCurrentPage(1);
    setTransientSelection(null);
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

  // After a drag-select inside a PDF text layer, rewrite the live Selection
  // to hug one column (two-column papers interleave columns in DOM order),
  // then capture tight per-line rects into the transient overlay. Ported
  // from Syflo's PdfView — with width/height normalized by zoom too.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onMouseUp = (e: MouseEvent) => {
      if (isConstrainingRef.current) return;
      const target = e.target as HTMLElement | null;
      if (!target?.closest?.('.textLayer')) return;
      const sel = window.getSelection?.();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;

      isConstrainingRef.current = true;
      try {
        constrainSelectionToColumn();
      } finally {
        queueMicrotask(() => {
          isConstrainingRef.current = false;
        });
      }

      const tight = computeTightLineRects();
      const wrapper = findPageWrapper(e.target as HTMLElement);
      if (!wrapper || !tight) {
        setTransientSelection(null);
        return;
      }
      const pageNumber = pageNumberOf(wrapper);
      if (!pageNumber) return;
      const pageRect = wrapper.getBoundingClientRect();
      const rects: HighlightRect[] = normalizeRectsToZoom(tight.lines, pageRect, zoom);
      setTransientSelection(rects.length > 0 ? { pageNumber, rects } : null);
    };
    container.addEventListener('mouseup', onMouseUp);
    return () => container.removeEventListener('mouseup', onMouseUp);
  }, [doc, zoom]);

  // Clear the transient overlay when the user collapses the selection.
  useEffect(() => {
    const onSelChange = () => {
      if (isConstrainingRef.current) return;
      const sel = window.getSelection?.();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
        setTransientSelection(null);
      }
    };
    document.addEventListener('selectionchange', onSelChange);
    return () => document.removeEventListener('selectionchange', onSelChange);
  }, []);

  // Multi-rect highlight capture at right-click time. Positions AND sizes
  // are normalized to zoom=1 (the zoom-safe fix) so the highlight renders
  // with correct geometry at every zoom level.
  const captureHighlightFromEvent = (e: React.MouseEvent): PdfHighlightSelection | null => {
    const sel = window.getSelection?.();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;

    const text = extractColumnAwareSelectionText() ?? sel.toString();
    if (!text || !text.trim()) return null;

    const pageWrapper =
      findPageWrapper(sel.anchorNode) ??
      findPageWrapper(sel.focusNode) ??
      findPageWrapper(e.target as HTMLElement);
    if (!pageWrapper) return null;
    const pageNumber = pageNumberOf(pageWrapper);
    if (!pageNumber) return null;

    const pageRect = pageWrapper.getBoundingClientRect();
    const tight = computeTightLineRects();
    const sourceLines: DOMRect[] = tight
      ? tight.lines
      : Array.from(sel.getRangeAt(0).getClientRects()).filter(
          (r) => r.width > 0 && r.height > 0,
        );
    const rects: HighlightRect[] = normalizeRectsToZoom(sourceLines, pageRect, zoom);
    if (rects.length === 0) return null;

    return { pageNumber, text: text.trim(), rects };
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    if (onCaptureHighlight) {
      onCaptureHighlight(captureHighlightFromEvent(e));
    }
    onContextMenu?.(e);
  };

  const goToPage = (page: number) => {
    if (!doc) return;
    const clamped = Math.min(Math.max(page, 1), doc.numPages);
    setCurrentPage(clamped);
    pageRefs.current.get(clamped)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const pages = doc ? Array.from({ length: doc.numPages }, (_, i) => i + 1) : [];

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
      <div
        ref={containerRef}
        className="flex-1 overflow-auto p-6"
        onContextMenu={handleContextMenu}
      >
        {error && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3 max-w-md mx-auto">
            Could not load PDF: {error}
          </div>
        )}
        {doc && (
          <div className="flex flex-col items-center gap-4">
            {pages.map(n => (
              <PdfPageView
                key={n}
                doc={doc}
                pageNumber={n}
                zoom={zoom}
                highlights={(highlights ?? []).filter(h => h.pageNumber === n)}
                transientRects={
                  transientSelection && transientSelection.pageNumber === n
                    ? transientSelection.rects
                    : null
                }
                onColorHighlightClick={onColorHighlightClick}
                registerPage={(el) => {
                  if (el) pageRefs.current.set(n, el);
                  else pageRefs.current.delete(n);
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// One page card: canvas + selectable text layer + highlight overlays, all in
// a relative wrapper so the absolute overlays align with the canvas.
function PdfPageView({
  doc,
  pageNumber,
  zoom,
  highlights,
  transientRects,
  onColorHighlightClick,
  registerPage,
}: {
  doc: PdfDocumentHandle;
  pageNumber: number;
  zoom: number;
  highlights: Highlight[];
  transientRects: HighlightRect[] | null;
  onColorHighlightClick?: (highlight: Highlight, e: React.MouseEvent) => void;
  registerPage: (el: HTMLDivElement | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);

  // Canvas first, then the text layer on top. Re-runs on zoom change so both
  // stay in sync with the viewport scale.
  useEffect(() => {
    const canvas = canvasRef.current;
    const layer = textLayerRef.current;
    if (!canvas) return;
    let cancelled = false;
    (async () => {
      await doc.renderPage(pageNumber, canvas, zoom);
      if (cancelled || !layer) return;
      await doc.renderTextLayer?.(pageNumber, layer, zoom);
    })();
    return () => { cancelled = true; };
  }, [doc, pageNumber, zoom]);

  return (
    <div
      ref={registerPage}
      data-testid={`pdf-page-${pageNumber}`}
      className="relative bg-white rounded shadow-md w-fit"
    >
      <canvas ref={canvasRef} className="block rounded" data-testid="pdf-page-canvas" />
      {/* `textLayer` class triggers pdf.js's positioning CSS (imported in
          pdfDocument.ts). Without it the spans aren't absolutely positioned
          and the selection appears offset from the visible text. */}
      <div
        ref={textLayerRef}
        className="textLayer"
        data-testid={`pdf-text-layer-${pageNumber}`}
      />
      {/* Transient drag-selection overlay — one semi-transparent blue rect
          per visible line, exactly hugging the text. Pointer-events none so
          the rects don't intercept the user's drag. */}
      {transientRects?.map((r, idx) => (
        <div
          key={`sel-${idx}`}
          aria-hidden="true"
          className="absolute pointer-events-none"
          style={{
            left: r.left * zoom,
            top: r.top * zoom,
            width: r.width * zoom,
            height: r.height * zoom,
            background: 'rgba(59, 130, 246, 0.30)',
            mixBlendMode: 'multiply',
            zIndex: 3,
          }}
        />
      ))}
      {/* Colored highlights — multi-rect (one element per line) so the
          stripe hugs the text. All four rect values scale with zoom (the
          zoom-safe fix). Clicks open the actions menu; right-click bubbles
          up so the FloatingPopup still opens over an existing highlight. */}
      {highlights.map((h) =>
        h.rects.map((r, idx) => (
          <button
            key={`${h.id}-${idx}`}
            type="button"
            data-testid={`pdf-color-highlight-${h.id}`}
            data-color={h.color}
            title={h.text}
            onClick={(e) => {
              e.stopPropagation();
              onColorHighlightClick?.(h, e);
            }}
            onContextMenu={(e) => {
              // Prevent the OS-native menu but let the event bubble to the
              // page container so the selection popup still opens.
              e.preventDefault();
            }}
            className={`absolute border-0 p-0 cursor-pointer rounded-[2px] ${HIGHLIGHT_BG_CLASS[h.color]}`}
            style={{
              left: r.left * zoom,
              top: r.top * zoom,
              width: r.width * zoom,
              height: r.height * zoom,
              // Multiply blend keeps black text readable through the pastel
              // highlight instead of producing washed-out grey.
              mixBlendMode: 'multiply',
              zIndex: 4,
            }}
          />
        )),
      )}
    </div>
  );
}
