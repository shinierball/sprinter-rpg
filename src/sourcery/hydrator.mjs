/**
 * src/sourcery/hydrator.mjs
 * `hydrate(redactedSpec, block, options) -> spec`. Pure; never reads a number from a block.
 *
 * Rules:
 *  - Only paths in the kind's field map are written, and only when the path already exists in the spec. The
 *    book wins. A mapped path whose block has text takes the book's text, whatever the spec held. When the book was
 *    provided (a block) and a path the entry provides found no text, a non-empty value is emptied and listed in
 *    `emptied`: the public wording is never a fallback. A path the entry does not provide (`options.provided`) and a
 *    join that has only generated parts keep what they hold. The name never empties.
 *  - Every extracted string is stripped of control characters and escaped (`text`: angle brackets neutralised; `html`:
 *    fully escaped, wrapped in `<p>` by the system). Rule 6.
 *  - The name is the heading, title-cased when set in capitals, then the anchors entry's name edits and
 *    casing mask.
 *  - A path in `generatedPaths(spec)` holds the generated stand-in of a join: it counts as empty. A join with
 *    `{ gen }` parts writes the generators' text from the spec's own numbers (`options.generators` may override a
 *    generator by id) and fills only when a book part has text, so the stand-in stays otherwise.
 *  - `options.check` (the entry's `check`, `{}` for an entry with none: target path -> `textCheck` of the reviewed text): each
 *    path the book filled is `verified` when the book's text before rendering (`checkOf`) hashes to the recipe's hash, else `unverified` (the text is
 *    still imported, flagged, and never falls back to public wording). The result lists both; the flag lists the unverified
 *    paths. Left out, nothing is checked.
 *  - The result records `flags['sprinter-rpg'].sourcery = { resolved, source }` (rule 4), plus `redacted` and the
 *    `generated` and `emptied` paths it did not fill.
 *  - `generators`: `{ [path]: (spec) => string }` fills mechanics-in-disguise text from the spec's own numbers (rule 3).
 */
import { fieldMapFor, fieldClass, askedPaths, FIELD_CLASS } from './field-maps.mjs';
import { isSourceKey, readTargetPath } from './anchors.mjs';
import { displayName, paragraphsHtml, stripControls, titleCaseHeading } from './text.mjs';
import { schemaFieldKind } from './schema-kind.mjs';
import { isRedacted, generatedPaths, emptiedPaths } from './redacted.mjs';
import { GENERATORS } from './generators.mjs';
import { textCheck } from './hash.mjs';

/** System id used as the flags scope (`sprinter-rpg`, the system id in system.json). */
export const FLAG_SCOPE = 'sprinter-rpg';

const isEmpty = v => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

/** Own-property walk to the parent of `path`; returns null when any segment is missing. */
function locate(doc, path) {
  const parts = path.split('.');
  let cur = doc;
  for (const p of parts.slice(0, -1)) {
    if (!cur || typeof cur !== 'object' || !Object.hasOwn(cur, p)) return null;
    cur = cur[p];
  }
  const last = parts[parts.length - 1];
  return cur && typeof cur === 'object' && Object.hasOwn(cur, last) ? { parent: cur, key: last } : null;
}

function sourceValue(block, from, casing, nameEdits) {
  if (!isSourceKey(from) || !block) return '';
  if (from === 'name') return displayName(block.name, casing, nameEdits);
  if (from === 'quote') return typeof block.quote === 'string' ? block.quote : '';
  if (from === 'body') return typeof block.body === 'string' ? block.body : '';
  const field = from.slice(7);
  const v = block.fields && Object.hasOwn(block.fields, field) ? block.fields[field] : '';
  return typeof v === 'string' ? v : '';
}

/**
 * Render by the target's schema kind (7.74c): an `HTMLField` gets escaped paragraphs; a `StringField` gets the book's
 * characters as they are (every card and sheet escapes a plain field itself, and enricher syntax stays live as typed
 * text does). A target outside a schema follows the map's `as`. `heading`: a heading line, title-cased when the book
 * sets it in capitals (as a name is).
 */
function render(text, as, spec, path) {
  const kind = schemaFieldKind(spec, path);
  if (kind === 'html' || (kind === null && as === 'html')) return paragraphsHtml(text);
  return sourceText(text, as);
}

/** The book's text as the field's source, before any rendering (heading casing and control characters only). */
const sourceText = (text, as) => stripControls(as === 'heading' ? titleCaseHeading(text) : text);

/**
 * The verification hash of a filled field: `textCheck` of the book's text before rendering, so how a field is rendered
 * (plain, or as paragraphs for an `HTMLField`) never touches it. The one function the importer and the stamp share.
 */
const checkOf = text => textCheck(stripControls(text));

/**
 * Hydrate and report.
 * @param {object} spec  the redacted spec (not mutated)
 * @param {object} block `{ name, quote, body, fields }` from the slicer
 * @param {{ kind: string, casing?: string, nameEdits?: Array, map?: object, provided?: string[], source?: string, resolved?: boolean, generators?: object }} options
 *   `provided`: the source keys the entry lends (its `fields` plus its `more[]` keys); omitted means all of them
 * @returns {{ spec: object, filled: string[], emptiedNow: string[], itemNames: string[], itemsKept: string[], skipped: {path:string, reason:string}[], verified: string[], unverified: string[] }}
 */
export function hydrateWithReport(spec, block, options = {}) {
  const { kind, casing, nameEdits, provided = null, source = 'pdf', resolved = true, generators = {}, check = null } = options;
  const out = structuredClone(spec ?? {});
  const redacted = isRedacted(out);
  const generated = new Set(generatedPaths(out));
  const map = fieldMapFor(kind);
  const filled = [];
  const checks = {};
  const emptiedNow = [];
  const itemNames = [];
  const itemsKept = [];
  const skipped = [];
  const lends = key => !provided || provided.includes(key);
  // The same predicate the redaction and the structural test use: which mapped paths the entry asks the book for.
  const asked = askedPaths(kind, { fields: provided ?? undefined, map: options.map }, out);
  if (!map) return { spec: out, filled, emptiedNow, itemNames, itemsKept, skipped: [{ path: '*', reason: `unknown kind` }] };

  // Per-entity re-sourcing may only change the source of a path the kind's map already lists.
  const known = new Set(map.map(m => m.path));
  const override = {};
  for (const [target, from] of Object.entries(options.map ?? {})) {
    const path = readTargetPath(target);
    if (path && known.has(path) && isSourceKey(from)) override[path] = from;
  }

  for (const m of map) {
    const loc = locate(out, m.path);
    if (!loc) { skipped.push({ path: m.path, reason: 'no such field' }); continue; }
    if (m.join && !Object.hasOwn(override, m.path)) {
      let bookText = false;
      const pieces = [];
      for (const part of m.join.parts) {
        if (part.gen) {
          const fn = generators[part.gen] ?? GENERATORS[part.gen];
          const value = typeof fn === 'function' ? fn(out) : '';
          if (typeof value === 'string' && value.trim()) pieces.push(value.trim());
        } else if (!(part.ifNoPath && locate(out, part.ifNoPath)) && lends(part.from)) {
          const value = sourceValue(block, part.from, casing, nameEdits);
          if (value.trim()) { bookText = true; pieces.push(`${part.label ?? ''}${stripControls(value)}`); }
        }
      }
      if (bookText) { const joined = pieces.join(m.join.sep); loc.parent[loc.key] = joined; checks[m.path] = checkOf(joined); filled.push(m.path); } else skipped.push({ path: m.path, reason: 'no source text' });
      continue;
    }
    const from = override[m.path] ?? m.from;
    if (!asked.has(m.path)) { skipped.push({ path: m.path, reason: 'not provided' }); continue; }
    const text = sourceValue(block, from, casing, nameEdits);
    if (!text.trim()) {
      // The book was provided and the entry lends this key, but nothing parsed: empty and flag, never our wording.
      const held = typeof loc.parent[loc.key] === 'string' && loc.parent[loc.key].trim() !== '';
      if (block && fieldClass(kind, m.path) !== FIELD_CLASS.NAME && held) {
        loc.parent[loc.key] = '';
        emptiedNow.push(m.path);
        skipped.push({ path: m.path, reason: 'emptied' });
      } else skipped.push({ path: m.path, reason: 'no source text' });
      continue;
    }
    loc.parent[loc.key] = render(text, m.as, out, m.path);
    checks[m.path] = checkOf(sourceText(text, m.as));
    filled.push(m.path);
  }

  // embedded items (a mob's attacks and spells) take the name the book prints for them; one the book does
  // not print, or whose line was not found, keeps its own text and carries a flag. Numbers are never read (rule 6).
  if (block?.items && out.items) {
    const embedded = Array.from(out.items);
    for (const [id, r] of Object.entries(block.items)) {
      const item = embedded.find(i => i && typeof i === 'object' && i._id === id);
      if (!item) continue;
      const name = r.name ? stripControls(r.name) : '';
      if (name) { item.name = name; itemNames.push(id); continue; }
      item.flags = item.flags && typeof item.flags === 'object' ? item.flags : {};
      item.flags[FLAG_SCOPE] = { ...(item.flags[FLAG_SCOPE] ?? {}), sourcery: { kept: r.missed ? 'missed' : 'unprinted' } };
      itemsKept.push(id);
    }
  }

  for (const [path, fn] of Object.entries(generators)) {
    if (typeof fn !== 'function' || Object.hasOwn(GENERATORS, path)) continue;
    const loc = readTargetPath(path) && locate(out, path);
    if (!loc || !isEmpty(loc.parent[loc.key])) continue;
    const text = fn(out);
    if (typeof text === 'string' && text) { loc.parent[loc.key] = text; checks[path] = checkOf(text); filled.push(path); }
  }

  out.flags = out.flags && typeof out.flags === 'object' ? out.flags : {};
  out.flags[FLAG_SCOPE] = out.flags[FLAG_SCOPE] && typeof out.flags[FLAG_SCOPE] === 'object' ? out.flags[FLAG_SCOPE] : {};
  // A document whose placeholder name found no replacement stays marked redacted.
  const stillRedacted = redacted && !filled.includes('name');
  const stillGenerated = [...generated].filter(p => !filled.includes(p));
  // Verification: the text the book filled against the hash the recipe carries for it (a book that was not provided fills nothing).
  const verified = [];
  const unverified = [];
  for (const path of filled) {
    if (check) (Object.hasOwn(check, path) && check[path] === checks[path] ? verified : unverified).push(path);
  }
  const stillEmptied = [...new Set([...emptiedPaths(out), ...emptiedNow])].filter(p => !filled.includes(p));
  // A document whose entry does not provide its name keeps the public one: flagged, so the sheet can say so.
  const nameKept = !!block && !asked.has('name');
  out.flags[FLAG_SCOPE].sourcery = {
    resolved: !!resolved, source: typeof source === 'string' ? source.slice(0, 32) : 'pdf',
    ...(stillRedacted ? { redacted: true } : {}), ...(stillGenerated.length ? { generated: stillGenerated } : {}),
    ...(stillEmptied.length ? { emptied: stillEmptied } : {}),
    ...(unverified.length ? { unverified } : {}),
    ...(nameKept ? { nameKept: true } : {})
  };
  return { spec: out, filled, emptiedNow, itemNames, itemsKept, skipped, verified, unverified, checks };
}

/** `hydrate(redactedSpec, block, options) -> spec`. */
export function hydrate(spec, block, options = {}) {
  return hydrateWithReport(spec, block, options).spec;
}
