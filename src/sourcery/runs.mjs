/**
 * src/sourcery/runs.mjs
 * Group text items into runs. Pure.
 *
 * A run is consecutive items in one style (font id + size) on one baseline, or wrapped onto the next line of the same
 * style directly below. Styles are per document: the engine never reads a font name.
 *
 * A run also records where its lines wrapped after a hyphen or dash (`breaks`) and whether it ends on one (`endBreak`),
 * so the slicer can tell a typesetter's break from a compound (see hyphens.mjs). The text itself is as printed.
 */
import { MARK_BREAK, MARK_LONE, endsOnBreakChar, extractBreaks } from './hyphens.mjs';

/** Style key of an item or run: font id and size. */
export const styleOf = r => `${r.font}@${r.size}`;

/** A U+2011 set as an item of its own (a real compound's hyphen) rather than glued to the end of a word. */
const isLoneNb = str => String(str ?? '').trim() === '\u2011';

/**
 * Group items into runs. Each run keeps its first item's position (x, y), its last line's baseline `y2` and right
 * edge `x2`, the `lines` it spans, and the index range [start, end] of its items in content order.
 * `wrapEm` is how far (in em) a wrapped line may start from the run's x: 4 em lets centred headings wrap; tables pass
 * a small value so a roll number on the next line does not join the previous row's result cell. `gapEm` is the widest
 * gap (in em) between two items on one baseline that still joins them.
 */
export function buildRuns(rawItems, { wrapEm = 4, gapEm = 1.5 } = {}) {
  // the two private-use marks below are this function's own: a source that already carries them loses them
  const items = rawItems.some(it => /[\uF8F1\uF8F2]/.test(it.str)) ? rawItems.map(it => ({ ...it, str: it.str.replace(/[\uF8F1\uF8F2]/g, '') })) : rawItems;
  const runs = [];
  let cur = null;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.rotated) { cur = null; continue; }
    if (!it.str.trim() && !cur) continue;
    const sameStyle = cur && cur.font === it.font && Math.abs(cur.size - it.size) < 0.2;
    const sameLine = sameStyle && Math.abs(cur.lastY - it.y) < it.size * 0.3 && it.x - cur.endX < it.size * gapEm;
    const nextLine = sameStyle && cur.lastY - it.y > 0 && cur.lastY - it.y < it.size * 1.6 && Math.abs(cur.x - it.x) < it.size * wrapEm;
    // pdf.js pads a gap between separate text operations with a whitespace item as wide as the gap. It must not move
    // the run's right edge, or two table cells on one baseline would join.
    if (cur && !it.str.trim() && (sameLine || nextLine)) {
      if (sameLine) cur.text += it.str;
      continue;
    }
    if (cur && (sameLine || nextLine)) {
      if (!sameLine && endsOnBreakChar(cur.text)) cur.text = cur.text.replace(/\s+$/, '') + (isLoneNb(cur.lastStr) ? MARK_LONE : MARK_BREAK);
      cur.text += (sameLine ? '' : ' ') + it.str;
      cur.lastStr = it.str;
      cur.lastY = it.y;
      cur.endX = it.x + it.w;
      cur.end = i;
      cur.lines += sameLine ? 0 : 1;
      continue;
    }
    if (!it.str.trim()) { cur = null; continue; }
    cur = { text: it.str, lastStr: it.str, font: it.font, size: it.size, x: it.x, y: it.y, lastY: it.y, endX: it.x + it.w, lines: 1, start: i, end: i };
    runs.push(cur);
  }
  for (const r of runs) {
    const { text, breaks } = extractBreaks(r.text.replace(/\s+/g, ' ').trim());
    r.text = text;
    if (breaks.length) r.breaks = breaks;
    if (endsOnBreakChar(text)) r.endBreak = { lone: isLoneNb(r.lastStr) };
    delete r.lastStr;
    r.y2 = r.lastY; r.x2 = r.endX; delete r.lastY; delete r.endX;
  }
  return runs.filter(r => r.text);
}

/**
 * Plain text of items [from, to) in content order: a newline at each pdf.js end-of-line or baseline change, a space
 * where items on one line are separated by a visible gap.
 */
export function itemsToText(items, from = 0, to = items.length) {
  let out = '';
  let prev = null;
  for (let i = from; i < to; i++) {
    const it = items[i];
    if (it.rotated) continue;
    if (prev) {
      const sameLine = Math.abs(prev.y - it.y) < Math.max(prev.size, it.size) * 0.4;
      if (prev.eol || !sameLine) out += '\n';
      else if (it.x - (prev.x + prev.w) > Math.min(prev.size, it.size) * 0.15 && !/\s$/.test(out) && !/^\s/.test(it.str)) out += ' ';
    }
    out += it.str;
    prev = it;
  }
  return out;
}
