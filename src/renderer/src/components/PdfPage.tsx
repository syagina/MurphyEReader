import { useEffect, useMemo, useRef, useState } from 'react';
import { TextLayer } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { pdfRenderScale } from '../lib/pdf';
import { DrawingCaptureLayer, DrawingLayer } from './DrawingLayer';
import type { PdfDrawingConfig } from './DrawingLayer';

interface PdfPageProps {
  pdf: PDFDocumentProxy;
  pageNo: number;
  zoom: number;
  /** Rendered above the canvas and below the selectable text layer. */
  overlay?: React.ReactNode;
  /** Rendered above the text layer (page-margin pin icons stay clickable). */
  pinOverlay?: React.ReactNode;
  /** Stored ink/shape records plus the drawing-mode capture surface. */
  drawing?: PdfDrawingConfig;
}

/**
 * One rendered PDF page: a device-pixel-ratio aware canvas plus a selectable
 * text layer. Only mounted for pages inside the scroll window; the parent
 * keeps placeholders for the rest.
 */
export function PdfPage({
  pdf,
  pageNo,
  zoom,
  overlay,
  pinOverlay,
  drawing,
}: PdfPageProps): React.JSX.Element {
  const [page, setPage] = useState<PDFPageProxy | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textLayerRef = useRef<HTMLDivElement | null>(null);

  // CSS-pixel viewport shared by the drawing layers. The canvas effect below
  // keeps its own device-pixel viewport.
  const viewport = useMemo(
    () => (page === null ? null : page.getViewport({ scale: zoom })),
    [page, zoom],
  );

  useEffect(() => {
    let cancelled = false;
    setPage(null);
    void pdf
      .getPage(pageNo)
      .then((loaded) => {
        if (!cancelled) {
          setPage(loaded);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          console.error(`第 ${pageNo} 页加载失败`, error);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [pdf, pageNo]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (page === null || canvas === null) {
      return;
    }
    let cancelled = false;
    const dpr = window.devicePixelRatio || 1;
    // Rasterize above the display resolution when the page is small on
    // screen; the browser downsamples the canvas, which keeps thin Chinese
    // strokes crisp instead of letting them fade into the background.
    const viewport = page.getViewport({ scale: pdfRenderScale(zoom, dpr) });
    const cssViewport = page.getViewport({ scale: zoom });
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    canvas.style.width = `${cssViewport.width}px`;
    canvas.style.height = `${cssViewport.height}px`;
    const task = page.render({ canvas, viewport });
    task.promise.catch((error: unknown) => {
      if (!cancelled) {
        console.error(`第 ${pageNo} 页渲染失败`, error);
      }
    });
    return () => {
      cancelled = true;
      task.cancel();
    };
  }, [page, pageNo, zoom]);

  useEffect(() => {
    const container = textLayerRef.current;
    if (page === null || container === null) {
      return;
    }
    container.replaceChildren();
    let cancelled = false;
    const viewport = page.getViewport({ scale: zoom });
    const textLayer = new TextLayer({
      textContentSource: page.streamTextContent(),
      container,
      viewport,
    });
    textLayer.render().catch((error: unknown) => {
      if (!cancelled) {
        console.error(`第 ${pageNo} 页文本层渲染失败`, error);
      }
    });
    return () => {
      cancelled = true;
      textLayer.cancel();
    };
  }, [page, pageNo, zoom]);

  // pdf_viewer.css computes text layer sizes from `--scale-factor` and
  // `--total-scale-factor`; outside the stock `.pdfViewer .page` markup we must
  // provide the whole chain, including the rounding units used by pdfjs's
  // inline `round(...)` widths.
  const textLayerStyle = useMemo(
    () =>
      ({
        '--scale-factor': String(zoom),
        '--total-scale-factor': String(zoom),
        '--user-unit': '1',
        '--scale-round-x': '1px',
        '--scale-round-y': '1px',
      }) as React.CSSProperties,
    [zoom],
  );

  return (
    <>
      <canvas ref={canvasRef} className="pdf-canvas" aria-label={`第 ${pageNo} 页`} />
      {overlay}
      <div ref={textLayerRef} className="textLayer" style={textLayerStyle} />
      {page !== null && viewport !== null && drawing !== undefined && (
        <DrawingLayer
          notes={drawing.notes}
          pageWidth={viewport.width}
          pageHeight={viewport.height}
          rotation={page.rotate}
          zoom={zoom}
        />
      )}
      {pinOverlay}
      {page !== null &&
        viewport !== null &&
        drawing !== undefined &&
        drawing.enabled && (
          <DrawingCaptureLayer page={page} zoom={zoom} {...drawing} />
        )}
    </>
  );
}
