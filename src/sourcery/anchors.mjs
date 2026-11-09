/**
 * src/sourcery/anchors.mjs
 * The anchors-entry shape (`src/content/sourcery/<book>.anchors.json`) and a defensive reader. The 5.3 compiler writes
 * these files; the resolver reads them. Nothing in an entry is book text: ids, hashes, numbers, source keys.
 *
 * File:
 *   { "book": "<slug>", "entries": [ Entry, ... ] }
 *
 * Entry (every field except `id` and `anchor` is optional):
 *   id          the frozen document `_id` (1-64 of A-Z a-z 0-9 _ -)
 *   anchor      { kind: 'heading', hash, via? }  64 hex characters, SHA-256 of the normalised heading; `via`
 *               ('heading' | 'alias' | 'inline') restricts the candidates to that class of hit, for an
 *               entity printed as a table row or a lead-in under a name that is also a heading elsewhere
 *               { kind: 'table', number }  the literal `TABLE n:` label
 *   pageHint    1-based page in the compiling edition; the resolver corrects it by a per-book shift
 *   prefixHash  advisory SHA-256 of the first 80 normalised characters of the block's body (rule 5); never a gate.
 *               Among same-name candidates it breaks the tie first (191 a)
 *   prefixFrom  source key the prefix hash is taken from instead of the body (a tie whose bodies are equal but whose
 *               notes differ is pinned by the notes)
 *   casing      per-letter casing mask of the display name, `1` upper / `0` lower
 *   nameEdits   [[at, del, ins], ...] edits from the title-cased heading to the display name: `ins` holds
 *               punctuation and spaces only, so an edit drops a subtitle or swaps an apostrophe, never adds words
 *   map         per-entity re-sourcing of known field-map targets: { "<target path>": "<source key>" }
 *   fields      the source keys the primary block provides (default all). An anchor at a heading that is not
 *               the entity's own (a class entry holding a perk, a related skill holding the rank text) lists only the
 *               keys it lends, never `name`
 *   pick        line selectors: [{ hash, words?, into, append?, label? }]. Each picks the line of
 *               the block whose first `words` (default 8) normalised words hash to `hash` (`lineHash`, 16 hex) and
 *               writes it to the source key `into`; several picks into one key join as paragraphs. With `append` the
 *               picked lines follow the key's existing value instead of replacing it. A block's lines are its heading
 *               and its paragraphs, so a line is a bullet, a labelled line or a paragraph. With `label` the selector
 *               picks among the block's mechanic-label lines instead (a spell's `Base Damage:` line
 *               that carries a sentence of its description), and only into a key of LABEL_PICK_KEYS (`body`): the
 *               line becomes description text, never a mechanics value. With `lead` (only into `name`) the selector
 *               takes the line's printed label, the text before its first colon, as the name: a document whose name the
 *               book prints as a lead-in under another entry's heading. With `other` the selector picks among the
 *               whole paragraphs, label word included, of labels the grammar has no key for (a rank line's mini table,
 *               `3 Mana: -4 damage`), so a picked line reads as printed; never into `name`
 *               With `stat` (and `after: n`) the selector picks a paragraph of the stat block instead and keeps only the text
 *               after its nth colon (with `last: k` and `skip: j`, the k words before that colon, leaving out the j nearest it: a name): a debuff the book defines in a mob's attack (`... gains the X Debuff: text`). The entry
 *               slices its anchor as that mob (`as`)
 *   as          the kind whose grammar slices this entry's anchor, when it is not the document's own (a debuff anchored at a
 *               mob's heading)
 *   items       embedded items of an actor (a mob's attacks and spells): [{ id, hash, words? } | { id, none: true }]. `id` is the
 *               embedded item's `_id`; `hash`/`words` select the stat-block paragraph that names it (`lineHash` of its first
 *               `words`, the label's own words), and the import takes the label before the colon as the item's name.
 *               `none` marks an item the book does not print: it keeps its text and carries a flag
 *   check       verification hashes of the reviewed text of each book-sourced field: { "<target path>": "<16 hex>" }
 *               (`textCheck`, hash.mjs). The importer compares the text it hydrated and marks the field verified or
 *               unverified; an unverified field still imports, flagged, and never falls back to public wording
 *   more        extra anchors: [{ anchor, as?, pageHint?, fields: [<source key>, ...], pick? }]; each extra
 *               block owns the named source keys and overrides the primary block's value for them (or appends, for a
 *               key it picks with `append`)
 *
 * Source keys: `name`, `quote`, `body`, or `fields.<name>` (a grammar field such as `fields.rank5`).
 */

import { LINE_WORDS, MAX_LINE_WORDS } from './normalize.mjs';
import { NAME_EDIT_INSERT } from './text.mjs';
import { KINDS } from './grammars.mjs';
import { firstScalar } from '../utils/first-scalar.mjs';

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const HASH = /^[0-9a-f]{64}$/;
const SOURCE_KEY = /^(name|quote|body|fields\.[A-Za-z0-9_:-]{1,40})$/;
const TARGET_PATH = /^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+){0,6}$/;
const FORBIDDEN_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_MORE = 8;
const MAX_CASING = 200;
const MAX_PAGE = 100000;
const MAX_TABLE = 9999;
const MAX_PICKS = 16;
const MAX_ITEMS = 48;
const MAX_NAME_EDITS = 12;
const MAX_NAME_POS = 200;
const VIAS = new Set(['heading', 'alias', 'inline']);
const LINE_HASH = /^[0-9a-f]{16}$/;
/**
 * The source keys a `label` selector may write. `body` feeds a description; no source key feeds a
 * structured (mechanics) field, and the hydrator writes only mapped text paths.
 */
export const LABEL_PICK_KEYS = Object.freeze(new Set(['body']));

const isRecord = v => !!v && typeof v === 'object' && !Array.isArray(v);

/** First element of an array, first part of a comma list (CONTRIBUTING §4), trimmed string. */
function scalarString(raw) {
  const v = firstScalar(raw);
  return typeof v === 'string' ? v.trim() : '';
}

function readInt(raw, max) {
  const n = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
  return Number.isInteger(n) && n >= 0 && n <= max ? n : null;
}

/** Sanitise an anchor `{ kind, hash | number }`. Returns null when malformed. */
export function readAnchor(raw) {
  if (!isRecord(raw)) return null;
  const kind = scalarString(raw.kind);
  if (kind === 'heading') {
    const hash = scalarString(raw.hash).toLowerCase();
    if (!HASH.test(hash)) return null;
    const via = raw.via === undefined ? '' : scalarString(raw.via);
    return VIAS.has(via) ? { kind, hash, via } : { kind, hash };
  }
  if (kind === 'table') {
    const number = readInt(raw.number, MAX_TABLE);
    return number ? { kind, number } : null;
  }
  return null;
}

/** True for a source key the hydrator understands. */
export const isSourceKey = key => typeof key === 'string' && SOURCE_KEY.test(key);

/** Sanitise a target path (no prototype segments). Returns null when malformed. */
export function readTargetPath(raw) {
  const p = typeof raw === 'string' ? raw.trim() : '';
  if (!TARGET_PATH.test(p)) return null;
  return p.split('.').some(seg => FORBIDDEN_SEGMENTS.has(seg)) ? null : p;
}

/**
 * Sanitise a line-selector list (`pick`). Returns `{ picks, bad }`; a malformed selector is dropped and counted.
 */
export function readPicks(raw) {
  const picks = [];
  let bad = 0;
  const list = Array.isArray(raw) ? raw : [];
  if (!Array.isArray(raw)) bad++;
  for (const p of list.slice(0, MAX_PICKS)) {
    const hash = isRecord(p) ? scalarString(p.hash).toLowerCase() : '';
    const into = isRecord(p) ? scalarString(p.into) : '';
    const words = isRecord(p) && p.words !== undefined ? readInt(p.words, MAX_LINE_WORDS) : LINE_WORDS;
    if (!LINE_HASH.test(hash) || !isSourceKey(into) || !words) { bad++; continue; }
    const pick = { hash, into };
    if (words !== LINE_WORDS) pick.words = words;
    if (p.append === true) pick.append = true;
    if (p.lead === true) {
      if (into !== 'name' || p.label === true) { bad++; continue; }
      pick.lead = true;
    }
    if (p.label === true) {
      if (!LABEL_PICK_KEYS.has(into) || p.other === true || p.stat === true) { bad++; continue; }
      pick.label = true;
    }
    // `other`: the whole paragraph (label included) of a label the grammar has no key for, kept as printed in a text key.
    if (p.other === true) {
      if (into === 'name' || p.lead === true || p.stat === true) { bad++; continue; }
      pick.other = true;
    }
    // `stat`: a paragraph of the stat block, of which only the text after its `after`th colon is kept (a debuff the book
    // defines inside a mob's attack). Never into `name`.
    // With `last` (and optional `skip`) it keeps instead the `last` words just before that colon, leaving out the `skip` words
    // nearest it (the label word `Debuff`): the name the book prints in front of the colon. Only `last` may feed `name`.
    if (p.stat === true) {
      const after = readInt(p.after, 9);
      const last = p.last === undefined ? 0 : readInt(p.last, 8);
      const skip = p.skip === undefined ? 0 : readInt(p.skip, 4);
      if ((into === 'name') !== (last > 0) || p.lead === true || !after || last === null || skip === null) { bad++; continue; }
      pick.stat = true;
      pick.after = after;
      if (last) { pick.last = last; if (skip) pick.skip = skip; }
    }
    picks.push(pick);
  }
  if (list.length > MAX_PICKS) bad += list.length - MAX_PICKS;
  return { picks, bad };
}

/** Sanitise embedded-item selectors. Returns `{ items, bad }`. */
export function readItems(raw) {
  const items = [];
  let bad = 0;
  const list = Array.isArray(raw) ? raw : [];
  if (!Array.isArray(raw)) bad++;
  const seen = new Set();
  for (const r of list.slice(0, MAX_ITEMS)) {
    const id = isRecord(r) ? scalarString(r.id) : '';
    if (!ID.test(id) || seen.has(id)) { bad++; continue; }
    seen.add(id);
    if (r.none === true) { items.push({ id, none: true }); continue; }
    const hash = scalarString(r.hash).toLowerCase();
    const words = r.words !== undefined ? readInt(r.words, MAX_LINE_WORDS) : LINE_WORDS;
    if (!LINE_HASH.test(hash) || !words) { bad++; continue; }
    items.push(words === LINE_WORDS ? { id, hash } : { id, hash, words });
  }
  if (list.length > MAX_ITEMS) bad += list.length - MAX_ITEMS;
  return { items, bad };
}

/** Sanitise name edits `[[at, del, ins], ...]`. Returns null when any edit is malformed or they overlap. */
export function readNameEdits(raw) {
  if (!Array.isArray(raw) || !raw.length || raw.length > MAX_NAME_EDITS) return null;
  const edits = [];
  for (const e of raw) {
    if (!Array.isArray(e) || e.length !== 3) return null;
    const at = readInt(e[0], MAX_NAME_POS);
    const del = readInt(e[1], MAX_NAME_POS);
    if (at === null || del === null || typeof e[2] !== 'string' || !NAME_EDIT_INSERT.test(e[2]) || (del === 0 && !e[2])) return null;
    edits.push([at, del, e[2]]);
  }
  edits.sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < edits.length; i++) if (edits[i][0] < edits[i - 1][0] + edits[i - 1][1] || edits[i][0] === edits[i - 1][0]) return null;
  return edits;
}

const readKeys = raw => (Array.isArray(raw) ? [...new Set(raw.filter(isSourceKey))] : []);

/**
 * Sanitise one anchors entry.
 * @returns {{ entry: object|null, problems: string[] }} `entry` is null when `id` or `anchor` is unusable; other
 *   malformed optional parts are dropped and reported in `problems`.
 */
export function readAnchorsEntry(raw) {
  const problems = [];
  if (!isRecord(raw)) return { entry: null, problems: ['entry is not an object'] };
  const id = scalarString(raw.id);
  if (!ID.test(id)) return { entry: null, problems: ['entry has no valid id'] };
  const anchor = readAnchor(raw.anchor);
  if (!anchor) return { entry: null, problems: [`${id}: anchor is missing or malformed`] };
  const entry = { id, anchor, pageHint: readInt(raw.pageHint, MAX_PAGE) ?? 0 };
  if (raw.pageHint !== undefined && readInt(raw.pageHint, MAX_PAGE) === null) problems.push(`${id}: pageHint ignored`);
  if (raw.as !== undefined) {
    const as = scalarString(raw.as);
    if (KINDS.includes(as) && as !== 'space') entry.as = as; else problems.push(`${id}: as ignored`);
  }

  if (raw.prefixHash !== undefined) {
    const h = scalarString(raw.prefixHash).toLowerCase();
    if (HASH.test(h)) entry.prefixHash = h; else problems.push(`${id}: prefixHash ignored`);
  }
  if (raw.prefixFrom !== undefined) {
    const k = scalarString(raw.prefixFrom);
    if (isSourceKey(k) && k !== 'name') entry.prefixFrom = k; else problems.push(`${id}: prefixFrom ignored`);
  }
  if (raw.casing !== undefined) {
    const c = scalarString(raw.casing);
    if (/^[01]+$/.test(c) && c.length <= MAX_CASING) entry.casing = c; else problems.push(`${id}: casing ignored`);
  }
  if (raw.nameEdits !== undefined) {
    const edits = readNameEdits(raw.nameEdits);
    if (edits) entry.nameEdits = edits; else problems.push(`${id}: nameEdits ignored`);
  }
  if (raw.fields !== undefined) {
    const fields = readKeys(raw.fields);
    if (fields.length) entry.fields = fields; else problems.push(`${id}: fields ignored`);
  }
  if (raw.pick !== undefined) {
    const { picks, bad } = readPicks(raw.pick);
    if (bad) problems.push(`${id}: ${bad} pick entr${bad === 1 ? 'y' : 'ies'} ignored`);
    if (picks.length) entry.pick = picks;
  }
  if (raw.items !== undefined) {
    const { items, bad } = readItems(raw.items);
    if (bad) problems.push(`${id}: ${bad} item entr${bad === 1 ? 'y' : 'ies'} ignored`);
    if (items.length) entry.items = items;
  }
  if (raw.map !== undefined) {
    const map = {};
    if (isRecord(raw.map)) {
      for (const [target, source] of Object.entries(raw.map)) {
        const path = readTargetPath(target);
        if (path && isSourceKey(source)) map[path] = source; else problems.push(`${id}: map entry ${String(target).slice(0, 40)} ignored`);
      }
    } else problems.push(`${id}: map ignored`);
    if (Object.keys(map).length) entry.map = map;
  }
  if (raw.check !== undefined) {
    const check = {};
    if (isRecord(raw.check)) {
      for (const [target, h] of Object.entries(raw.check)) {
        const path = readTargetPath(target);
        const hash = typeof h === 'string' ? h.toLowerCase() : '';
        if (path && LINE_HASH.test(hash)) check[path] = hash; else problems.push(`${id}: check entry ${String(target).slice(0, 40)} ignored`);
      }
    } else problems.push(`${id}: check ignored`);
    if (Object.keys(check).length) entry.check = check;
  }
  if (raw.more !== undefined) {
    const more = [];
    const list = Array.isArray(raw.more) ? raw.more : [];
    if (!Array.isArray(raw.more)) problems.push(`${id}: more ignored`);
    for (const m of list.slice(0, MAX_MORE)) {
      const a = readAnchor(m?.anchor);
      const fields = readKeys(m?.fields);
      if (a && a.kind === 'heading' && fields.length) {
        const extra = { anchor: a, pageHint: readInt(m.pageHint, MAX_PAGE) ?? 0, fields };
        if (m.as !== undefined) {
          const as = scalarString(m.as);
          if (KINDS.includes(as) && as !== 'space') extra.as = as; else problems.push(`${id}: more as ignored`);
        }
        if (m.prefixHash !== undefined) {
          const h = scalarString(m.prefixHash).toLowerCase();
          if (HASH.test(h)) extra.prefixHash = h; else problems.push(`${id}: more prefixHash ignored`);
        }
        if (m.prefixFrom !== undefined) {
          const k = scalarString(m.prefixFrom);
          if (isSourceKey(k) && k !== 'name') extra.prefixFrom = k; else problems.push(`${id}: more prefixFrom ignored`);
        }
        if (m.pick !== undefined) {
          const { picks, bad } = readPicks(m.pick);
          if (bad) problems.push(`${id}: ${bad} more pick entr${bad === 1 ? 'y' : 'ies'} ignored`);
          if (picks.length) extra.pick = picks;
        }
        more.push(extra);
      } else problems.push(`${id}: more entry ignored`);
    }
    if (list.length > MAX_MORE) problems.push(`${id}: more truncated to ${MAX_MORE}`);
    if (more.length) entry.more = more;
  }
  return { entry, problems };
}

/**
 * Sanitise an anchors file. Duplicate ids keep the first entry.
 * @returns {{ book: string, entries: object[], problems: string[] }}
 */
export function readAnchorsFile(raw) {
  const problems = [];
  const book = isRecord(raw) ? scalarString(raw.book).slice(0, 64) : '';
  const list = isRecord(raw) && Array.isArray(raw.entries) ? raw.entries : [];
  if (!isRecord(raw) || !Array.isArray(raw.entries)) problems.push('anchors file has no entries array');
  const entries = [];
  const seen = new Set();
  for (const r of list) {
    const res = readAnchorsEntry(r);
    problems.push(...res.problems);
    if (!res.entry) continue;
    if (seen.has(res.entry.id)) { problems.push(`${res.entry.id}: duplicate id ignored`); continue; }
    seen.add(res.entry.id);
    entries.push(res.entry);
  }
  return { book, entries, problems };
}
