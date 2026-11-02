/**
 * src/sourcery/text-source.mjs
 * The `TextSource` contract and an in-memory implementation.
 *
 * A TextSource is anything with `pages(): AsyncIterable<{ page, items, height? }>`:
 *   - `page`   1-based page number, in ascending order.
 *   - `items`  text items in content order (pdf.js order, not PDFKit), each
 *              `{ str, font, size, x, y, w, eol?, rotated? }`. `font` is any per-document font id; `size` is the
 *              vertical text scale in points; `x`, `y` are the baseline origin (PDF space, y grows upward); `w` is the
 *              advance width.
 *   - `height` page height in points (default 792) for the furniture margin test.
 * The pdf.js adapter (`pdfjs-source.mjs`) and the fixture tests both implement it. Everything downstream is pure.
 */

export const DEFAULT_PAGE_HEIGHT = 792;

const num = (v, fallback = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

/**
 * Coerce a raw item to the engine's shape. Never trusts the source: strings only, finite numbers only. Returns null for
 * an item with no string. Font ids are coerced to strings.
 */
export function sanitizeItem(raw) {
  if (!raw || typeof raw.str !== 'string') return null;
  return {
    str: raw.str,
    font: String(raw.font ?? ''),
    size: Math.round(num(raw.size) * 100) / 100,
    x: Math.round(num(raw.x) * 10) / 10,
    y: Math.round(num(raw.y) * 10) / 10,
    w: Math.round(num(raw.w) * 10) / 10,
    eol: !!raw.eol,
    rotated: !!raw.rotated
  };
}

/** Sanitise a page record yielded by a source. */
export function sanitizePage(raw, fallbackPage) {
  const items = Array.isArray(raw?.items) ? raw.items.map(sanitizeItem).filter(Boolean) : [];
  const page = Number.isInteger(raw?.page) && raw.page > 0 ? raw.page : fallbackPage;
  const height = num(raw?.height) > 0 ? num(raw.height) : DEFAULT_PAGE_HEIGHT;
  return { page, items, height };
}

/** In-memory TextSource over `[{ page?, items, height? }]` (or a bare array of item arrays). */
export class MemoryTextSource {
  constructor(pages) {
    this.list = (Array.isArray(pages) ? pages : []).map((p, i) => (Array.isArray(p) ? { page: i + 1, items: p } : { page: i + 1, ...p }));
  }

  get numPages() { return this.list.length; }

  async* pages() {
    for (const p of this.list) yield p;
  }
}
