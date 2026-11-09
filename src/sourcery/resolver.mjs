/**
 * src/sourcery/resolver.mjs
 * Resolve anchors against a book index, with a tie-break between equal matches. Pure.
 *
 * Candidates for a heading anchor, in order: block headings with the hash; else alias headings (the text before a
 * parenthesis); else inline hits (table first cell, bold lead-in label). A table anchor looks up the `TABLE n:` label.
 * Among several candidates the choice is made by `pickCandidate`, one small replaceable function (191 a): the prefix
 * hash first, then the page nearest the hint corrected by the per-book shift, then the earliest in content order.
 * Nothing here ever blocks: no matching prefix means the nearest candidate hydrates and is marked.
 *
 * (per-book rules): an anchor may name its class of hit (`via`); an entry may take its
 * prefix hash from another source key (`prefixFrom`), select lines of its block (`pick`, which also narrows the
 * candidates to the blocks that hold every picked line) and lend only some source keys (`fields`).
 */
import { grammarFor } from './grammars.mjs';
import { collectBlock, sliceBlock } from './slicer.mjs';
import { bodyPrefixHash, lineHash, LINE_WORDS } from './normalize.mjs';

const median = values => {
  const s = [...values].sort((a, b) => a - b);
  return s.length ? s[Math.floor((s.length - 1) / 2)] : 0;
};

/** The text a prefix hash is taken from: the body, or for a table row the first filled cell. */
export function prefixSource(block) {
  if (block.body) return block.body;
  return Object.values(block.fields).find(v => typeof v === 'string' && v) ?? '';
}

/** The value of a source key in a block (`name`, `quote`, `body`, `fields.<name>`); '' when absent. */
export function sourceText(block, key) {
  if (!block || typeof key !== 'string') return '';
  if (key === 'name' || key === 'quote' || key === 'body') return typeof block[key] === 'string' ? block[key] : '';
  if (!key.startsWith('fields.')) return '';
  const field = key.slice(7);
  const v = block.fields && Object.hasOwn(block.fields, field) ? block.fields[field] : '';
  return typeof v === 'string' ? v : '';
}

function setSourceText(block, key, value) {
  if (key === 'name' || key === 'quote' || key === 'body') block[key] = value;
  else if (key.startsWith('fields.')) block.fields[key.slice(7)] = value;
}

/** The prefix hash of a block for an entry: from `prefixFrom` when the entry names one, else from `prefixSource`. */
export function blockPrefixHash(block, prefixFrom) {
  return bodyPrefixHash(prefixFrom ? sourceText(block, prefixFrom) : prefixSource(block));
}

/**
 * Index of the stat-block paragraph (`block.statLines`) an embedded-item selector `{ hash, words? }` names, or -1.
 * Same hashing as `findLine`, over the stat block's paragraphs.
 */
function findStatLine(block, sel) {
  const key = `S${sel.words ?? LINE_WORDS}`;
  if (!Object.hasOwn(block, 'lineHashCache')) Object.defineProperty(block, 'lineHashCache', { value: new Map() });
  if (!block.lineHashCache.has(key)) block.lineHashCache.set(key, (block.statLines ?? []).map(l => lineHash(l, sel.words ?? LINE_WORDS)));
  return block.lineHashCache.get(key).indexOf(sel.hash);
}

/**
 * Resolve an entry's embedded-item selectors against a block: `block.items[id] = { name, missed }`. `name` is the printed
 * label of the selected stat-block paragraph (the text before its colon); `missed` is true when the line was not found
 * (another printing) and `none` entries are the ones the compiler found the book does not print. Mutates the block.
 */
export function applyItems(block, items = []) {
  block.items = {};
  for (const it of items) {
    if (it.none) { block.items[it.id] = { name: '', none: true }; continue; }
    const i = findStatLine(block, it);
    block.items[it.id] = i >= 0 ? { name: leadLabel(block.statLines[i]), missed: false } : { name: '', missed: true };
  }
  return block;
}

/** Which list a selector reads: `label` (the mechanic-label lines), `other` (the whole paragraphs of labels the grammar has no key for), `stat` (the stat block's paragraphs), else the lines. */
const listOf = p => (p?.label ? 'label' : p?.other ? 'other' : p?.stat ? 'stat' : '');

/** The lines a selector searches: `labelLines` for a `label` selector, `otherLines` for an `other` one, else `lines`. `which` may also be `true` (label). */
const linesFor = (block, which) => (which === 'other' ? block.otherLines : which === 'stat' ? block.statText : which ? block.labelLines : block.lines) ?? [];

/**
 * The `last` words that end just before the `n`th colon of a line, leaving out the `skip` words nearest the colon (the printed
 * label word `Debuff`); '' when the line has too few colons or words. What a `stat` selector with `last` keeps: a name the book
 * prints in front of a colon.
 */
export const wordsBeforeColon = (line, n, last, skip = 0) => {
  const parts = String(line ?? '').split(':');
  if (parts.length <= n) return '';
  const words = parts.slice(0, n).join(':').trim().split(/\s+/).filter(Boolean);
  const end = words.length - skip;
  return end >= last ? words.slice(end - last, end).join(' ') : '';
};

/** The text after the `n`th colon of a line (the part a `stat` selector with `after` keeps), trimmed; '' when the line has fewer colons. */
export const afterColon = (line, n) => String(line ?? '').split(':').slice(n).join(':').trim();

/** Line hashes of a block for one word count, cached on the block (non-enumerable, so blocks still compare as data). */
function lineHashesOf(block, words, label) {
  if (!Object.hasOwn(block, 'lineHashCache')) Object.defineProperty(block, 'lineHashCache', { value: new Map() });
  const cache = block.lineHashCache;
  const key = `${label ? ({ other: 'O', stat: 'S' }[label] ?? 'L') : ''}${words}`;
  if (!cache.has(key)) cache.set(key, linesFor(block, label).map(l => lineHash(l, words)));
  return cache.get(key);
}

/** The printed label of a line: the text before its first colon (at most 80 characters), or '' when it has none. */
export function leadLabel(line) {
  const at = String(line ?? '').indexOf(':');
  return at > 0 && at <= 80 ? line.slice(0, at).trim() : '';
}

/** Index of the line a selector picks in a block (in `linesFor(block, pick.label)`), or -1. */
export function findLine(block, pick) {
  return lineHashesOf(block, pick.words ?? LINE_WORDS, listOf(pick)).indexOf(pick.hash);
}

/** Picked lines join as paragraphs, except a lead-in (a line that ends with a colon) stays with the line it leads. */
const joinPicked = lines => lines.reduce((out, l, i) => (i === 0 ? l : `${out}${/:\s*$/.test(lines[i - 1]) ? ' ' : '\n\n'}${l}`), '');

/**
 * Apply line selectors to a block (mutates and returns it). Per target key, the picked lines join as paragraphs and
 * replace the key's value, or follow it when a selector for that key has `append`. A key none of whose selectors match
 * is emptied (replace) or left as it was (append): a missed line never lets the whole block through.
 * Works on any block with `lines`: a sliced block. A `label` selector picks from the
 * block's mechanic-label lines (`labelLines`); `readPicks` admits it only into a text key.
 * @returns {{ block: object, picks: { hash: string, into: string, matched: boolean }[] }}
 */
export function applyPicks(block, picks = []) {
  const report = [];
  const byKey = new Map();
  for (const p of picks) {
    const i = findLine(block, p);
    report.push({ hash: p.hash, into: p.into, matched: i >= 0 });
    const k = byKey.get(p.into) ?? { lines: [], append: false };
    if (i >= 0) {
      const line = linesFor(block, listOf(p))[i];
      const text = p.lead ? leadLabel(line) : p.last ? wordsBeforeColon(line, p.after, p.last, p.skip) : p.after ? afterColon(line, p.after) : line;
      // A `stat` line whose colon is missing yields nothing: the field stays empty and flagged, never the whole stat line.
      if (text) k.lines.push(text); else report[report.length - 1].matched = false;
    }
    if (p.append) k.append = true;
    byKey.set(p.into, k);
  }
  block.fields = { ...block.fields };
  for (const [key, { lines, append }] of byKey) {
    const picked = joinPicked(lines);
    setSourceText(block, key, append ? [sourceText(block, key), picked].filter(Boolean).join('\n\n') : picked);
  }
  return { block, picks: report };
}

/** Keep only the named source keys of a block: an anchor that lends some keys of another entry's heading. */
export function keepOnly(block, keys) {
  const keep = new Set(keys);
  for (const k of ['name', 'quote', 'body']) if (!keep.has(k)) block[k] = '';
  block.fields = Object.fromEntries(Object.entries(block.fields ?? {}).filter(([k]) => keep.has(`fields.${k}`)));
  return block;
}

/**
 * A same-hash heading inside an earlier hit's block opens the next segment (narrative, sidebar, stat block); it is not
 * a second candidate. Hits are in content order.
 */
function withoutSegmentOpeners(index, hits, hash) {
  const skip = new Set();
  const kept = [];
  for (const h of hits) {
    if (skip.has(`${h.page}:${h.j}`)) continue;
    kept.push(h);
    for (const o of collectBlock(index, { ...h, hash }).openers) skip.add(`${o.page}:${o.j}`);
  }
  return kept;
}

/** Candidate hits for an anchor, best class first (or only the class the anchor names with `via`). */
export function candidatesFor(index, anchor) {
  if (anchor.kind === 'table') return index.tables.get(anchor.number) ?? [];
  const hits = index.hashes.get(anchor.hash) ?? [];
  for (const via of anchor.via ? [anchor.via] : ['heading', 'alias', 'inline']) {
    const pool = hits.filter(h => h.via === via);
    if (pool.length) return via === 'inline' ? pool : withoutSegmentOpeners(index, pool, anchor.hash);
  }
  return [];
}

/**
 * Choose among candidates (replace this function to change the policy).
 * @param {object[]} candidates hits, in index order
 * @param {{ pageHint:number, shift:number, prefixHash?:string, prefixOf:(hit)=>string|null, holdsPicks?:(hit)=>boolean }} ctx
 *   `holdsPicks`: true when the hit's block holds every line the entry picks; it narrows first.
 * @returns {{ hit: object, brokenBy: null|'pick'|'prefix'|'page'|'order', prefixMatch: boolean|null }}
 *   `prefixMatch` is null when the entry carries no prefix hash.
 */
export function pickCandidate(candidates, ctx) {
  let pool = candidates;
  let prefixMatch = null;
  let by = null;
  if (ctx.holdsPicks && pool.length > 1) {
    const holding = pool.filter(h => ctx.holdsPicks(h));
    if (holding.length && holding.length < pool.length) { pool = holding; by = 'pick'; }
  }
  if (ctx.prefixHash) {
    const same = pool.filter(h => ctx.prefixOf(h) === ctx.prefixHash);
    prefixMatch = same.length > 0;
    if (same.length && same.length < pool.length) by = 'prefix';
    if (same.length) pool = same;
  }
  if (pool.length === 1) return { hit: pool[0], brokenBy: candidates.length > 1 ? by : null, prefixMatch };
  const want = ctx.pageHint + ctx.shift;
  const sorted = [...pool].sort((a, b) => Math.abs(a.page - want) - Math.abs(b.page - want) || a.page - b.page || a.j - b.j);
  const d0 = Math.abs(sorted[0].page - want);
  const d1 = Math.abs(sorted[1].page - want);
  return { hit: sorted[0], brokenBy: d0 < d1 ? 'page' : 'order', prefixMatch };
}

/**
 * Estimate the per-book page shift (merged books shift every page by a constant) from uniquely resolved anchors:
 * the median of `page - pageHint`. Zero when nothing resolves uniquely.
 */
export function estimateShift(index, entries) {
  const deltas = [];
  for (const e of entries) {
    if (!e.pageHint) continue;
    const c = candidatesFor(index, e.anchor);
    if (c.length === 1) deltas.push(c[0].page - e.pageHint);
  }
  return { shift: median(deltas), support: deltas.length };
}

/**
 * Resolve one anchor.
 * @param {object} index  from `buildIndex`
 * @param {{ anchor, pageHint?, prefixHash?, prefixFrom?, pick? }} entry (or an extra anchor from `more[]`); `entry.pick`
 *   holds line selectors, unrelated to the `pick` option below
 * @param {{ kind?: string, shift?: number }} [options] `kind` selects the grammar used to slice candidates
 * @returns {{ status, via, hit, candidates, tie, prefixMatch, shift }}
 */
export function resolveAnchor(index, entry, { kind, shift = 0 } = {}) {
  const candidates = candidatesFor(index, entry.anchor);
  if (!candidates.length) return { status: 'unresolved', via: null, hit: null, candidates: 0, tie: null, prefixMatch: null, shift };
  const grammar = grammarFor(entry.as ?? kind);
  const withHash = h => (entry.anchor.hash ? { ...h, hash: entry.anchor.hash } : h);
  const blocks = new Map();
  const blockOf = (hit) => {
    if (!blocks.has(hit)) blocks.set(hit, sliceBlock(index, withHash(hit), grammar));
    return blocks.get(hit);
  };
  const prefixOf = hit => (grammar ? blockPrefixHash(blockOf(hit), entry.prefixFrom) : null);
  // A candidate must hold the lines the entry selects: its picks, and the stat-block lines of its embedded items (the same heading
  // printed twice on a page, once as a banner with no stat block under it).
  const selectedItems = (entry.items ?? []).filter(it => !it.none);
  const holdsPicks = (entry.pick?.length || selectedItems.length) && grammar
    ? hit => (entry.pick ?? []).every(p => findLine(blockOf(hit), p) >= 0) && selectedItems.every(it => findStatLine(blockOf(hit), it) >= 0)
    : undefined;
  const auto = pickCandidate(candidates, { pageHint: entry.pageHint ?? 0, shift, prefixHash: entry.prefixHash, prefixOf, holdsPicks });
  const { hit, brokenBy, prefixMatch } = auto;
  // A lone candidate still gets the advisory check when the entry carries a prefix hash.
  const advisory = prefixMatch ?? (entry.prefixHash && grammar ? prefixOf(hit) === entry.prefixHash : null);
  return {
    status: 'resolved',
    via: hit.via,
    hit: withHash(hit),
    candidates: candidates.length,
    tie: candidates.length > 1 ? { count: candidates.length, brokenBy, pages: candidates.map(h => h.page) } : null,
    prefixMatch: advisory,
    shift
  };
}

/**
 * Resolve a whole recipe. `kindOf(entry)` returns the entry's kind (anchors do not carry it; the recipe knows it).
 * @returns {{ shift, support, results: Map<string, object>, summary: { total, resolved, unresolved, differs, ties, fraction } }}
 *   `fraction` is "what fraction of this recipe's anchors resolved", the book-recognition figure (never a gate).
 */
export function resolveRecipe(index, entries, kindOf = () => undefined) {
  const { shift, support } = estimateShift(index, entries);
  const results = new Map();
  const summary = { total: entries.length, resolved: 0, unresolved: 0, differs: 0, ties: 0, fraction: 0 };
  for (const e of entries) {
    const r = resolveAnchor(index, e, { kind: kindOf(e), shift });
    results.set(e.id, r);
    if (r.status === 'resolved') {
      summary.resolved++;
      if (r.prefixMatch === false) summary.differs++;
      if (r.tie) summary.ties++;
    } else summary.unresolved++;
  }
  summary.fraction = summary.total ? summary.resolved / summary.total : 0;
  return { shift, support, results, summary };
}

/**
 * Resolve an entry and slice its block, merging `more[]` extras: each extra block owns the source keys
 * it names and overrides the primary block's value for them. The entry's and each extra's line selectors
 * (`pick`) are applied to their own block first; an entry with `fields` lends only those keys; an extra key picked with
 * `append` follows the merged value instead of replacing it.
 * @returns {{ resolution, block: object|null, extras: object[], picks: { hash, into, matched, source }[] }}
 *   `picks` lists every selector and whether its line was found (`source`: 'entry' or 'more:<i>'), so a preview can
 *   mark an entry whose line moved in another edition.
 */
export function fetchBlock(index, entry, kind, { shift = 0, slice = {} } = {}) {
  const resolution = resolveAnchor(index, entry, { kind, shift });
  if (resolution.status !== 'resolved' || !grammarFor(kind)) return { resolution, block: null, extras: [], picks: [] };
  return { resolution, ...blockForHit(index, resolution.hit, entry, kind, { shift, slice }) };
}

/**
 * The block of one candidate hit with every rule of the entry applied (picks, `fields`, `more[]` extras): what
 * `fetchBlock` returns after resolving. `hit` must carry the anchor hash (`resolveAnchor(...).hit` does).
 * @returns {{ block: object|null, extras: object[], picks: object[] }}
 */
export function blockForHit(index, hit, entry, kind, { shift = 0, slice = {} } = {}) {
  // An entry may slice its anchor as another kind (`as`): a debuff whose text a mob's stat block prints.
  const grammar = grammarFor(entry.as ?? kind);
  if (!grammar || !hit) return { block: null, extras: [], picks: [] };
  const block = sliceBlock(index, entry.anchor?.hash && !hit.hash ? { ...hit, hash: entry.anchor.hash } : hit, grammar, slice);
  block.fields = { ...block.fields };
  const picks = [];
  if (entry.pick?.length) picks.push(...applyPicks(block, entry.pick).picks.map(p => ({ ...p, source: 'entry' })));
  if (entry.fields?.length) keepOnly(block, entry.fields);
  if (entry.items?.length) applyItems(block, entry.items);
  const extras = [];
  (entry.more ?? []).forEach((more, i) => {
    const r = resolveAnchor(index, more, { kind: entry.as ?? kind, shift });
    extras.push(r);
    if (r.status !== 'resolved') return;
    const extra = sliceBlock(index, r.hit, grammarFor(more.as ?? entry.as ?? kind), slice);
    const appendKeys = new Set((more.pick ?? []).filter(p => p.append).map(p => p.into));
    // The extra block holds only its picked lines for an appending key; they follow the merged value below.
    if (more.pick?.length) picks.push(...applyPicks(extra, more.pick.map(p => ({ ...p, append: false }))).picks.map(p => ({ ...p, source: `more:${i}` })));
    for (const key of more.fields) {
      const value = sourceText(extra, key);
      setSourceText(block, key, appendKeys.has(key) ? [sourceText(block, key), value].filter(Boolean).join('\n\n') : value);
    }
  });
  return { block, extras, picks };
}
