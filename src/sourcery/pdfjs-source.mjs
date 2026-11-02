/**
 * src/sourcery/pdfjs-source.mjs
 * The pdf.js adapter behind `TextSource`. The only module that knows pdf.js exists, and it never imports it: the caller
 * hands over the loaded library (Foundry serves `@foundryvtt/pdfjs`; tests and the archive compiler use `pdfjs-dist`).
 * Not exercised against real books by `npm test`; the fixture tests drive it with PDFs generated from `lib/pdf-lib.mjs`.
 */
import { DEFAULT_PAGE_HEIGHT } from './text-source.mjs';

/**
 * Hardened load options. `isEvalSupported: false` closes CVE-2024-4367 (font-matrix eval) in pdf.js before 4.2.67,
 * including the 4.0.379 Foundry ships. Text extraction never needs eval, font faces or scripting. Not a security
 * boundary on its own: extracted strings are still escaped by the hydrator.
 */
export const PDFJS_OPTIONS = Object.freeze({
  isEvalSupported: false,
  disableFontFace: true,
  useSystemFonts: false,
  enableXfa: false,
  stopAtErrors: false,
  verbosity: 0
});

/** Open a PDF (Uint8Array / ArrayBuffer) with a loaded pdf.js namespace and the hardened options. */
export async function openPdfJsDocument(pdfjs, data, extraOptions = {}) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  return pdfjs.getDocument({ data: bytes, ...extraOptions, ...PDFJS_OPTIONS }).promise;
}

/** One text item, flattened. `size` is the vertical scale of the text matrix (the column hypot for rotated text). */
export function flattenTextItem(it, styles = {}) {
  if (typeof it?.str !== 'string' || !Array.isArray(it.transform)) return null;
  const [a, b, c, d, e, f] = it.transform;
  const size = Math.abs(d) > 0.01 ? Math.abs(d) : Math.hypot(c, d) || Math.hypot(a, b);
  return {
    str: it.str,
    font: it.fontName,
    fontFamily: styles[it.fontName]?.fontFamily ?? '',
    size,
    x: e,
    y: f,
    w: it.width ?? 0,
    eol: !!it.hasEOL,
    rotated: Math.abs(b) > 0.01 || Math.abs(c) > 0.01
  };
}

/** TextSource over a pdf.js document (a `PDFDocumentProxy`). */
export class PdfJsTextSource {
  constructor(doc, { onProgress } = {}) {
    this.doc = doc;
    this.onProgress = onProgress;
  }

  get numPages() { return this.doc.numPages; }

  async* pages() {
    for (let n = 1; n <= this.doc.numPages; n++) {
      const page = await this.doc.getPage(n);
      const content = await page.getTextContent({ includeMarkedContent: false, disableNormalization: false });
      const items = content.items.map(it => flattenTextItem(it, content.styles)).filter(Boolean);
      const height = page.view?.[3] - page.view?.[1] || DEFAULT_PAGE_HEIGHT;
      page.cleanup();
      this.onProgress?.(n, this.doc.numPages);
      yield { page: n, items, height };
    }
  }
}
