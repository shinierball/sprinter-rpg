/**
 * src/sourcery/slicer.mjs
 * Slice one block from a resolved heading with a kind's grammar. Pure.
 *
 *   1. Block = runs after the heading, in pdf.js content order, until a terminator: a heading candidate with the same
 *      style as the anchor, or a non-body heading larger than both the anchor and the body size. A heading with the
 *      anchor's own hash does not end the block; it opens the next segment. For inline anchors (table first cell,
 *      bold lead-in label) the terminator must also start at the anchor's x. A `TABLE n:` label in the book's label
 *      style ends the block too. Furniture (a furniture style in the top or bottom margin) is skipped; the
 *      block continues across pages (max 3).
 *   2. Paragraphs: a new paragraph on a baseline drop over 1.45 em, a jump up (next column or page), or a line that opens
 *      in another style (except after a lone `Label:` and for fragments of 3 characters or fewer). Reflow: a line that
 *      opens with a lowercase letter continues a paragraph that has no terminal punctuation, across
 *      a column jump, a page change or a style change (an emphasised word starting a line), so a sentence is never split.
 *      A decorative tab numeral (a lone number set at 3 times the body size, the chapter tab) is not text.
 *   3. Table-row anchors: the grammar's `cells` maps columns to fields; columns are the x positions of the runs on the
 *      anchor's baseline.
 *   4. A paragraph whose first run is a grammar label in a style other than the block's dominant style opens that field.
 *      Mechanic labels are sliced and discarded (rule 6).
 *   5. The first paragraph is the quote when it opens with a quotation mark; the next short paragraph is the type line.
 *   6. Lines: the block also lists its heading and every paragraph, unwrapped, with a leading bullet mark
 *      removed, whatever the grammar made of them. Line selectors (`pick` in an anchors entry) choose among them.
 *   7. Name: the heading text without a leading bullet or a trailing colon (a bold lead-in such as
 *      `* Name:`); a hit found under the alias of its heading yields the text before the parenthesis.
 *   8. Stat block: a paragraph shaped like a stat block's type line (`Tier; Size (n), Kind`)
 *      starts a stat block, together with the short name line right before it. From there on no unlabelled paragraph is
 *      text (body, sidebar or line), so a sidebar slice stops at a stat block whatever heading it was found under.
 *   9. Empty upgrades: an `UPGRADES` label with `None` under it is dropped, both paragraphs.
 *  10. Table rows: a hit on a `TABLE n:` label that carries a row's hash (a `row` anchor, anchors.mjs) is cut from the table
 *      reader's rows (`table-slicer.mjs`), not from the runs after the label: the cell whose heading hash is the row's is the
 *      name, and the cells after it fill the grammar's `cells` in order (with no `cells`, the body). The reader keeps apart
 *      cells that the block runs merge (a name set less than a cell gutter before its effect, the next row's roll number).
 */
import { inMargin, inEdge, MAX_HEADING_CHARS, MAX_HEADING_LINES, runOf, isTableLabel } from './indexer.mjs';
import { styleOf } from './runs.mjs';
import { headingKeys, normalizeHeading, unwrap } from './normalize.mjs';
import { sha256 } from './hash.mjs';
import { resolveRun, endVerdict, EMPTY_VOCABULARY } from './hyphens.mjs';
import { tableRowCells } from './table-slicer.mjs';

const MAX_PAGES = 3;
const LABEL_MAX = 40;

/** The chapter tab on a page edge: a number of up to 3 digits set at 3 times the body size or more. */
const TAB_NUMERAL = /^\d{1,3}$/;
const TAB_NUMERAL_EM = 3;

const isCandidate = (index, r) => styleOf(r) !== index.body && r.text.length <= MAX_HEADING_CHARS && r.lines <= MAX_HEADING_LINES;

/**
 * The runs of the block that follows a hit, with page and segment. `hit.hash` is the anchor hash it was found under.
 * `pieces.openers` lists the same-hash headings that opened later segments (a stat block after a narrative).
 */
export function collectBlock(index, hit, options = {}) {
  const gathered = gatherPieces(index, hit, options);
  const pieces = options.reflow === false ? gathered : dropFigureNumerals(gathered);
  pieces.openers = gathered.openers;
  // A piece that ends on a hyphen or dash is joined to the line that follows it by the verdict of hyphens.mjs.
  const vocab = index.vocab ?? EMPTY_VOCABULARY;
  pieces.forEach((p, i) => {
    const verdict = endVerdict({ text: p.raw, endBreak: p.endBreak }, pieces[i + 1] && { text: pieces[i + 1].raw }, vocab);
    if (verdict) p.endJoin = verdict;
  });
  return pieces;
}

/** Consecutive lone numerals this many or more are a figure's labels (a compass, a dial), not text. */
const FIGURE_NUMERALS = 3;
const NUMERAL = /^\d{1,3}$/;
/** A figure's caption, set as a line of its own in the middle of the text that refers to it. */
const FIGURE_CAPTION = /^figure \d{1,3}$/i;

/** The pieces without any run of `FIGURE_NUMERALS` or more lone numerals in a row, and without a figure's lone caption. */
function dropFigureNumerals(pieces) {
  const out = [];
  for (let i = 0; i < pieces.length;) {
    if (FIGURE_CAPTION.test(pieces[i].text.trim())) { i++; continue; }
    let j = i;
    while (j < pieces.length && NUMERAL.test(pieces[j].text)) j++;
    if (j - i >= FIGURE_NUMERALS) i = j;
    else { out.push(pieces[i]); i++; }
  }
  return out;
}

/**
 * Whether a run is part of a sentence an emphasised word cut up, though its style and length look like a heading's: the next
 * run carries on along its last line, or it opens in lowercase. A heading does neither.
 */
const runsOnInLine = (r, next) => /^\p{Ll}/u.test(r.text) || (!!next && Math.abs(next.y - r.y2) < r.size * 0.4 && next.x >= r.x2 - 1);

function gatherPieces(index, hit, { reflow = true } = {}) {
  const vocab = index.vocab ?? EMPTY_VOCABULARY;
  const pieces = [];
  pieces.openers = [];
  const anchor = runOf(index, hit);
  if (!anchor) return pieces;
  let segment = 0;
  for (let page = hit.page; page < hit.page + MAX_PAGES; page++) {
    const rec = index.byNumber.get(page);
    if (!rec) continue;
    const { runs, height } = rec;
    for (let j = page === hit.page ? hit.j + 1 : 0; j < runs.length; j++) {
      const r = runs[j];
      // Furniture: a furniture style in the margin, or anything at all in the page's edge band (the watermark and the
      // imprint line are not always in the furniture style).
      if ((index.furniture.has(styleOf(r)) && inMargin(r, height)) || inEdge(r, height)) continue;
      if (reflow && TAB_NUMERAL.test(r.text) && r.size >= index.bodySize * TAB_NUMERAL_EM) continue;
      // A numbered table's label ends the block; a table is never part of an entry's text.
      if (isTableLabel(index, r)) return pieces;
      const sameStyle = styleOf(r) === styleOf(anchor);
      const bigger = isCandidate(index, r) && r.size > Math.max(anchor.size, index.bodySize) + 0.4 && !/^\d+$/.test(r.text);
      if (!hit.inline && isCandidate(index, r) && hit.hash) {
        const h = headingKeys(r.text);
        if (sha256(h.key) === hit.hash || (h.alias && sha256(h.alias) === hit.hash)) { segment++; pieces.openers.push({ page, j }); continue; }
      }
      if (hit.inline) {
        const prev = runs[j - 1];
        const startsLine = !prev || Math.abs(prev.y2 - r.y) > r.size * 0.3;
        if ((sameStyle && startsLine && Math.abs(r.x - anchor.x) < 3) || bigger) return pieces;
      } else if ((sameStyle && isCandidate(index, r) && !runsOnInLine(r, runs[j + 1])) || bigger) {
        return pieces;
      }
      pieces.push({ ...r, raw: r.text, text: resolveRun(r, vocab), page, segment });
    }
  }
  return pieces;
}

/** A stat block's type line: `Tier; Size (n), Kind`. Layout shape of the book, read while slicing, never from system data. */
export const STAT_TYPE_LINE = /^[^;\n]{1,60};\s*[^;\n(]{1,40}\(\d+\),\s/;
const STAT_NAME_MAX = 90;

/** Index of the first paragraph of a stat block (its name line, else the type line), or -1. */
export function statBlockStart(paras) {
  const i = paras.findIndex(p => STAT_TYPE_LINE.test(unwrap(p.text)));
  if (i < 0) return -1;
  const prev = paras[i - 1];
  return prev && prev.segment === paras[i].segment && unwrap(prev.text).length <= STAT_NAME_MAX && !/[.!?]\s*$/.test(prev.text) ? i - 1 : i;
}

/** The `UPGRADES` label alone, or the `None` under it (an entry with no upgrades). */
function emptyUpgrades(paras, i) {
  const t = j => unwrap(paras[j]?.text ?? '').trim();
  return (/^upgrades$/i.test(t(i)) && /^none\.?$/i.test(t(i + 1))) || (/^none\.?$/i.test(t(i)) && /^upgrades$/i.test(t(i - 1)));
}

/**
 * A quote set without quotation marks: the first paragraph, in a larger size than the short paragraph after it (the type
 * line), both before any body text. The books set a quote larger than the type line under it.
 */
function unmarkedQuote(paras) {
  const [a, b] = paras;
  return !!a && !!b && a.segment === b.segment && a.pieces[0].size >= b.pieces[0].size + 0.4 && unwrap(b.text).length < 100 && !loneLabel(b);
}

const loneLabel =para => !!para && para.pieces.length === 1 && /:\s*$/.test(para.pieces[0].text);

/**
 * Whether a paragraph that ends a page without terminal punctuation continues on the next page. 5.3 left this off
 * because recall cannot change; 5.3a turns it on under the stricter reflow test (the next line opens in lowercase),
 * which the compiler report measures. `options.joinPageBreaks` overrides.
 */
const DEFAULT_JOIN_PAGE_BREAKS = true;

const TERMINAL = /[.!?:;)\]"'\u201D\u2019]\s*$/;
const LOWER_START = /^\p{Ll}/u;
/** A run that is a label (`Rank 5:`, `Example:`): it opens a paragraph even when the text before it is unfinished. */
const LABEL_SHAPE = /:\s*$/;
/** A line that ends on one of these has not finished its sentence, whatever the next line opens with (a column or page break). */
const OPEN_END = /\b(?:a|an|the|and|or|of|to|vs|with|for|in|on|at|by|from)\s*$/;

/** The style with the most characters among the pieces: the block's body style. */
function dominantStyle(pieces) {
  const chars = new Map();
  for (const p of pieces) chars.set(styleOf(p), (chars.get(styleOf(p)) ?? 0) + p.text.length);
  return [...chars.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}

/**
 * Group block runs into paragraphs.
 * `options.reflow` (default on) is the 5.3a rule set; off gives the 5.3 behaviour, kept so the compiler can measure
 * the difference.
 */
export function paragraphs(pieces, { joinPageBreaks = DEFAULT_JOIN_PAGE_BREAKS, reflow = true } = {}) {
  const paras = [];
  let cur = null;
  let prev = null;
  const dominant = dominantStyle(pieces);
  for (const p of pieces) {
    const sameLine = prev && prev.page === p.page && Math.abs(prev.y2 - p.y) < p.size * 0.4;
    // A line that opens in lowercase after a paragraph with no terminal punctuation is the same sentence, and so is any
    // line after a paragraph that stops on a word no sentence ends on.
    const continues = reflow && !!prev && prev.segment === p.segment && !TERMINAL.test(cur.text) && (LOWER_START.test(p.text) || (OPEN_END.test(cur.text) && !LABEL_SHAPE.test(p.text)));
    // A line that opens in another style (a cross-reference set as a link, an emphasised lead-in) is the same sentence
    // while the text so far is unfinished: only a label, or a finished paragraph, lets a new style open a paragraph.
    // A heading (one run, short, in a style the block does not mostly use) is unfinished by nature: it never joins what follows.
    const heading = !!prev && cur.pieces.length === 1 && styleOf(prev) !== dominant && cur.text.length <= MAX_HEADING_CHARS;
    const unfinished = reflow && !!prev && prev.segment === p.segment && !heading && !TERMINAL.test(cur.text) && !LABEL_SHAPE.test(p.text);
    // A lead-in label ending the line before (`Example:`) stays with the text that follows it, whatever its style.
    const leadIn = !!prev && reflow && LABEL_SHAPE.test(prev.text) && prev.text.length <= LABEL_MAX && prev.segment === p.segment;
    const styleBreak = prev && !sameLine && !continues && !unfinished && styleOf(p) !== styleOf(prev) && p.text.length > 3 && !loneLabel(cur) && !leadIn;
    const pageBreak = !!prev && prev.page !== p.page;
    const joins = pageBreak && joinPageBreaks && prev.segment === p.segment && !styleBreak
      && (reflow ? continues : !TERMINAL.test(cur.text) && !loneLabel(cur));
    const newPara = !prev || (pageBreak && !joins) || prev.segment !== p.segment || styleBreak
      || (!sameLine && !pageBreak && (prev.y2 - p.y > Math.max(prev.size, p.size) * 1.45 || (p.y > prev.y2 + 2 && !continues)));
    if (newPara) {
      cur = { pieces: [p], text: p.text, segment: p.segment };
      paras.push(cur);
    } else {
      cur.pieces.push(p);
      // a line that ended on a hyphen or dash is one word or phrase with the line below it
      if (!sameLine && prev.endJoin) cur.text = (prev.endJoin === 'join' ? cur.text.slice(0, -1) : cur.text) + p.text;
      else cur.text += (sameLine ? (p.x - prev.x2 > p.size * 0.15 ? ' ' : '') : '\n') + p.text;
    }
    prev = p;
  }
  return paras;
}

/**
 * A run on the anchor's baseline opens a column only after a gutter: a run that abuts the previous one (a word set in
 * small capitals or italics inside a cell) continues its cell.
 */
const GUTTER_EM = 0.6;

/** Table row: columns at the x of the runs on the anchor's baseline that follow a gutter; each piece joins the column it starts in. */
function sliceCells(anchor, hit, pieces, names, options) {
  const cols = [anchor.x];
  let right = anchor.x2 ?? anchor.x;
  const baseline = pieces.filter(p => p.page === hit.page && Math.abs(p.y - anchor.y) < p.size * 0.3).sort((a, b) => a.x - b.x);
  for (const p of baseline) {
    if (p.x - right > p.size * GUTTER_EM) cols.push(p.x);
    right = Math.max(right, p.x2 ?? p.x);
  }
  const parts = names.map(() => []);
  for (const p of pieces) {
    let c = 0;
    for (let i = 0; i < cols.length; i++) if (p.x + 2 >= cols[i]) c = i;
    if (c >= 1 && c <= names.length) parts[c - 1].push(p);
  }
  const out = {};
  names.forEach((n, i) => { out[n] = unwrap(paragraphs(parts[i], options).map(pa => pa.text).join('\n')); });
  return out;
}

const hasOwn = (o, k) => Object.hasOwn(o, k);

/** Bullet marks that open a list line (not hyphens or minus signs: those are text). */
const BULLET = /^[\u2022\u25CF\u25AA\u25E6\u2023\u2043\u25A0\u25B8\u25BA]\s*/u;

/** A line as a selector sees it: unwrapped, without a leading bullet mark. */
const cleanLine = text => unwrap(text).replace(BULLET, '').trim();

/** The display text of a heading run: no leading bullet, no trailing colon; an alias hit keeps the text before `(`. */
function headingName(run, hit, vocab) {
  let text = resolveRun(run, vocab);
  const open = text.indexOf('(');
  if (open > 0 && (hit.via === 'alias' || (hit.hash && sha256(headingKeys(text).key) !== hit.hash))) text = text.slice(0, open);
  return unwrap(text).replace(BULLET, '').replace(/\s*:\s*$/, '').trim();
}

/** Rule 10: the block of a table row (see the module comment). An absent row leaves the block empty. */
function sliceRow(index, hit, grammar, out) {
  const cells = tableRowCells(index, hit, hit.hash);
  if (!cells) return out;
  const [name, ...rest] = cells.map(cleanLine);
  out.name = name.replace(/\s*:\s*$/, '');
  if (grammar.cells) {
    out.fields = Object.fromEntries(grammar.cells.map((key, i) => [key, rest[i] ?? '']));
    out.labels = grammar.cells.map(c => `cell:${c}`);
  } else out.body = rest.filter(Boolean).join('\n\n');
  out.lines = [out.name, ...rest].filter(Boolean);
  return out;
}

/**
 * Slice a block.
 * @returns {{ name, quote, typeLine, body, fields, labels, mechanics, page, pages, lines, labelLines, statLines }}
 *   `name` is the heading text (an alias heading yields the text before its parenthesis); `fields` holds only
 *   book-sourced text, keyed by the grammar's field names; unknown labelled lead-ins appear as `other:<label>`.
 *   `lines` is the heading and every paragraph the grammar keeps (not the mechanic labels, the type line or
 *   the stat-block segments: rule 6 holds for selected lines too), for line selectors. `labelLines`
 *   are the paragraphs opened by a grammar mechanic label (a spell's `Base Damage:` line), whole: never hydrated by
 *   the grammar, only by a selector with `label` (anchors.mjs), and only into a text key.
 */
export function sliceBlock(index, hit, grammar, options = {}) {
  const anchor = runOf(index, hit);
  const out = { name: '', quote: '', typeLine: '', body: '', fields: {}, labels: [], mechanics: 0, page: hit.page, pages: [hit.page], lines: [], labelLines: [], statLines: [] };
  if (!anchor || !grammar) return out;
  if (hit.via === 'table' && hit.hash) return sliceRow(index, hit, grammar, out);
  out.name = headingName(anchor, hit, index.vocab);
  const pieces = collectBlock(index, hit, options);
  out.pages = [...new Set([hit.page, ...pieces.map(p => p.page)])];
  const paras = paragraphs(pieces, options);
  const line = (text) => {
    const l = cleanLine(text);
    if (l) out.lines.push(l);
  };
  // the stat block's paragraph labels (the text up to and including the first colon), for locating an
  // embedded item's printed name (`items` of an anchors entry). Rule 6: the block carries no number from a stat block,
  // so `statLines` holds the label alone. The compiler (authoring time) reads whole paragraphs from `statText`, which is
  // not enumerable, so it never reaches a spec, a flag or a serialised block.
  const statText = [];
  Object.defineProperty(out, 'statText', { value: statText, enumerable: false });
  // The whole text (label included) of each paragraph opened by a label the grammar has no key for (`3 Mana: -4 damage`),
  // for a selector with `other` (anchors.mjs). Not enumerable, so a block still compares as data.
  const otherLines = [];
  Object.defineProperty(out, 'otherLines', { value: otherLines, enumerable: false });
  const statLine = (text) => {
    const l = cleanLine(text);
    const at = l.indexOf(':');
    if (!l) return;
    out.statLines.push(at > 0 && at <= 80 ? l.slice(0, at + 1) : '');
    statText.push(l);
  };
  line(resolveRun(anchor, index.vocab));
  if (grammar.cells) {
    out.fields = sliceCells(anchor, hit, pieces, grammar.cells, options);
    out.labels = grammar.cells.map(c => `cell:${c}`);
    for (const p of paras) line(p.text);
    return out;
  }
  const chars = new Map();
  for (const p of pieces) chars.set(styleOf(p), (chars.get(styleOf(p)) ?? 0) + p.text.length);
  const dominant = [...chars.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const body = [];
  const statFrom = statBlockStart(paras);
  let open = null;
  // The styles the open field's own text is set in: a `continues` field takes on only paragraphs that share one.
  let openStyles = new Set();
  paras.forEach((para, i) => {
    // A rank-1-only entry prints an `UPGRADES` label with `None` under it: neither is text.
    if (emptyUpgrades(paras, i)) { out.mechanics++; return; }
    const first = para.pieces[0];
    const key = normalizeHeading(first.text.replace(/^upgrades\s+/i, '').replace(/:\s*$/, ''));
    const shaped = styleOf(first) !== dominant && first.text.length <= LABEL_MAX;
    // A body label (`Example:`) is text with its label word, never a field of its own; under a labelled field it is that field's tail.
    const bodyLabel = shaped && !!grammar.bodyLabels?.includes(key);
    const labelled = shaped && !bodyLabel;
    const value = () => unwrap(para.text.slice(para.text.indexOf(first.text) + first.text.length).replace(/^\s*:\s*/, ''));
    if (labelled && hasOwn(grammar.labels, key)) {
      out.labels.push(key);
      open = grammar.labels[key];
      openStyles = new Set(para.pieces.slice(1).map(styleOf));
      if (open) {
        out.fields[open] = value();
        line(value()); // the value only: the label word is not part of a picked line (5.3c leftover)
      } else {
        out.mechanics++;
        const l = cleanLine(para.text);
        if (l) out.labelLines.push(l);
      }
      return;
    }
    if (labelled && (/:$/.test(first.text) || /^\s*:/.test(para.pieces[1]?.text ?? ''))) {
      open = null;
      if ((grammar.mechanicSegment !== undefined && para.segment >= grammar.mechanicSegment) || (statFrom >= 0 && i >= statFrom)) { out.mechanics++; out.labels.push('attack'); statLine(para.text); return; }
      out.labels.push(`other:${key}`);
      out.fields[`other:${key}`] = value();
      const whole = cleanLine(para.text);
      if (whole) otherLines.push(whole);
      line(value());
      return;
    }
    // A continuation is set in the same styles as the field's text (the stat block's). Narrative in another style,
    // typically the next creature's description in the book's body style, is not part of it.
    // With `listLabels`, a field whose label stands alone on its line takes on the styles of the paragraph after it (the first
    // bullet of a list printed under the label).
    const listStart = !!grammar.listLabels && !!open && openStyles.size === 0 && !out.fields[open];
    const sameText = listStart || para.pieces.some(p => openStyles.has(styleOf(p)));
    if (open && (bodyLabel || (grammar.continues?.includes(open) && sameText))) {
      for (const p of para.pieces) openStyles.add(styleOf(p));
      out.fields[open] = listStart ? unwrap(para.text) : `${out.fields[open]}\n\n${unwrap(para.text)}`;
      line(para.text);
      return;
    }
    open = null;
    if (grammar.mechanicSegment !== undefined && para.segment >= grammar.mechanicSegment) { out.mechanics++; statLine(para.text); return; }
    if (statFrom >= 0 && i >= statFrom) { out.mechanics++; statLine(para.text); return; }
    if (grammar.quote && i === 0 && (/^[\u201C"]/.test(para.text) || (grammar.typeLine && unmarkedQuote(paras)))) {
      out.quote = unwrap(para.text);
      line(para.text);
      return;
    }
    if (grammar.typeLine && !out.typeLine && !body.length && para.text.length < 100) { out.typeLine = unwrap(para.text); return; }
    line(para.text);
    if (grammar.sidebar && styleOf(first) !== index.body) {
      out.fields[grammar.sidebar] = [out.fields[grammar.sidebar], unwrap(para.text)].filter(Boolean).join('\n\n');
      return;
    }
    body.push(unwrap(para.text));
  });
  out.body = body.join('\n\n');
  return out;
}
