/**
 * pdf/pdfDocument.ts
 *
 * Thin wrapper around pdf.js so components depend on a two-method handle
 * (numPages + renderPage) instead of the pdf.js API surface. Tests mock this
 * module; the real implementation is the only place that touches pdfjs-dist.
 */

import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

export interface PdfDocumentHandle {
  numPages: number;
  /** Render a 1-based page into the canvas at the given zoom scale. */
  renderPage: (pageNumber: number, canvas: HTMLCanvasElement, scale: number) => Promise<void>;
  destroy?: () => void;
}

export async function loadPdfDocument(url: string): Promise<PdfDocumentHandle> {
  // pdf.js v6 nimmt keinen nackten String mehr an — getDocument liest nur
  // noch src.url (relative URLs werden gegen window.location aufgelöst).
  const loadingTask = pdfjsLib.getDocument({ url });
  const doc = await loadingTask.promise;
  return {
    numPages: doc.numPages,
    async renderPage(pageNumber, canvas, scale) {
      const page = await doc.getPage(pageNumber);
      // Render at device resolution so text stays crisp on retina displays;
      // the CSS size stays at the zoom-scaled viewport size.
      const dpr = window.devicePixelRatio || 1;
      const viewport = page.getViewport({ scale });
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;
      const canvasContext = canvas.getContext('2d');
      if (!canvasContext) return;
      await page.render({
        canvasContext,
        viewport,
        transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
      }).promise;
    },
    // v6: destroy() liegt auf dem LoadingTask, nicht mehr auf dem Dokument.
    destroy: () => { void loadingTask.destroy(); },
  };
}
