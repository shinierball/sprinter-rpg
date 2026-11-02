/**
 * src/sourcery/indexer.mjs
 * One pass over a TextSource: runs, the body style, page furniture, a heading-hash index and a table-label index.
 * Pure.
 *
 * No font band table. Styles are (font id, size) per document; the body style is the one with the most characters,
 * and any other run of 100 characters or fewer and 3 lines or fewer is a heading candidate. Anchors never store font data.
 */
import { sanitizePage } from './text-source.mjs';
import { buildRuns, styleOf } from './runs.mjs';
import { headingKeys } from './normalize.mjs';
import { sha256 } from './hash.mjs';
import { buildVocabulary } from './hyphens.mjs';

export const MAX_HEADING_CHARS = 100;
export const MAX_HEADING_LINES = 3;

/** Folios, running heads and the watermark sit in the outer ~6% of the page height. */
export const MARGIN_FRACTION = 0.057;

/**
 * The outer 3% of the page height: nothing but page furniture is set there, in any style (folios, running heads, the
 * watermark and the imprint line). Body text runs as low as 4% on a dense page, so this band is narrower than the margin.
 */
export const EDGE_FRACTION = 0.03;

/** `TABLE 76:`; the number is navigation data only, never table content. */
export const TABLE_LABEL = /^table\s+(\d{1,4})\s*:/i;
/** `TABLE 101 GRINDING COMPLICATIONS`: a label printed without its colon; only a run set in capitals. */
const TABLE_LABEL_BARE = /^table\s+(\d{1,4})\s+\S/i;

/** The table number of a label-shaped run text (`TABLE n:`, or `TABLE n TITLE` all in capitals), else null. */
export function tableLabelNumber(text) {
  const s = typeof text === 'string' ? text : '';
  const m = TABLE_LABEL.exec(s) ?? (s === s.toUpperCase() ? TABLE_LABEL_BARE.exec(s) : null);
  return m ? Number(m[1]) : null;
}

/** The title of a table label run: its text after `TABLE n:` / `TABLE n`. */
export const tableLabelTitle = text => String(text ?? '').replace(/^table\s+\d{1,4}\s*:?\s*/i, '').trim();

/**
 * Whether a run is one of the index's table labels: label-shaped text in the label style's font at any size (a book
 * sets some labels a point smaller than the rest). A cross-reference in the body font is never a label.
 */
export function isTableLabel(index, run) {
  const style = index?.labelStyle;
  if (!style || !run) return false;
  return run.font === style.slice(0, style.lastIndexOf('@')) && tableLabelNumber(run.text) !== null;
}

/** True when a run lies in the outer edge band of its page (see `EDGE_FRACTION`), whatever its style. */
export function inEdge(run, pageHeight) {
  return run.y < pageHeight * EDGE_FRACTION || run.y > pageHeight * (1 - EDGE_FRACTION);
}

/** True when a run lies in the top or bottom margin of its page. */
export function inMargin(run, pageHeight) {
  const m = pageHeight * MARGIN_FRACTION;
  return run.y < m || run.y > pageHeight - m;
}

/**
 * Build the book index.
 * @param {{ pages(): AsyncIterable<object> }} source a TextSource
 * @param {{ keepItems?: boolean, onProgress?: (page:number)=>void }} [options] `keepItems` retains each page's items (for 5.4's tables)
 * @returns {Promise<BookIndex>}
 */
export async function buildIndex(source, { keepItems = false, onProgress } = {}) {
  const pages = [];
  const byNumber = new Map();
  let ordinal = 0;
  for await (const raw of source.pages()) {
    const p = sanitizePage(raw, ++ordinal);
    const runs = buildRuns(p.items);
    const rec = { page: p.page, height: p.height, runs, items: keepItems ? p.items : undefined };
    pages.push(rec);
    byNumber.set(p.page, rec);
    onProgress?.(p.page);
  }
  return finishIndex(pages, byNumber);
}

function finishIndex(pages, byNumber) {
  // Style statistics: characters per style, and how many pages carry the style at most twice.
  const chars = new Map();
  const perPage = new Map();
  for (const { runs } of pages) {
    const seen = new Map();
    for (const r of runs) {
      const k = styleOf(r);
      chars.set(k, (chars.get(k) ?? 0) + r.text.length);
      seen.set(k, (seen.get(k) ?? 0) + 1);
    }
    for (const [k, n] of seen) {
      const e = perPage.get(k) ?? { pages: 0, few: 0 };
      e.pages++;
      if (n <= 2) e.few++;
      perPage.set(k, e);
    }
  }
  const body = [...chars.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const bodySize = body ? Number(body.split('@')[1]) : 0;
  // A furniture style occurs at most twice per page on 25% or more of pages. It only counts in the margin (see slicer).
  const furniture = new Set([...perPage.entries()].filter(([, e]) => e.few >= pages.length * 0.25 && e.few / e.pages > 0.9).map(([k]) => k));

  const index = { pages, byNumber, body, bodySize, furniture, vocab: buildVocabulary(pages), hashes: new Map(), tables: new Map(), numPages: pages.length };
  const add = (hash, hit) => { if (!index.hashes.has(hash)) index.hashes.set(hash, []); index.hashes.get(hash).push(hit); };
  const labels = [];

  for (const { page, height, runs } of pages) {
    runs.forEach((r, j) => {
      const style = styleOf(r);
      const next = runs[j + 1];
      const inline = !!next && Math.abs(next.y - r.y) < r.size * 0.3 && next.x > r.x;
      const number = tableLabelNumber(r.text);
      if (number !== null) labels.push({ page, j, style, run: r, number, colon: TABLE_LABEL.test(r.text) });
      if (style === body && !inline) return;
      if (r.text.length > MAX_HEADING_CHARS || r.lines > MAX_HEADING_LINES) return;
      if (index.furniture.has(style) && inMargin(r, height)) return;
      const { key, alias } = headingKeys(r.text);
      if (!key) return;
      const base = { page, j, style, size: r.size, inline };
      add(sha256(key), { ...base, via: inline ? 'inline' : 'heading' });
      if (alias) add(sha256(alias), { ...base, via: inline ? 'inline' : 'alias' });
    });
  }

  // The label style is the style most `TABLE n:` runs share; cross-reference cells in other styles are not labels.
  // A label in that style's font at another size, or without its colon (in capitals), is a label too.
  const styleVotes = new Map();
  for (const l of labels) if (l.colon) styleVotes.set(l.style, (styleVotes.get(l.style) ?? 0) + 1);
  index.labelStyle = [...styleVotes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  for (const l of labels) {
    if (!isTableLabel(index, l.run)) continue;
    if (!index.tables.has(l.number)) index.tables.set(l.number, []);
    index.tables.get(l.number).push({ page: l.page, j: l.j, style: l.style, via: 'table', inline: false });
  }
  return index;
}

/** The run a hit points at. */
export function runOf(index, hit) {
  return index.byNumber.get(hit.page)?.runs[hit.j] ?? null;
}
