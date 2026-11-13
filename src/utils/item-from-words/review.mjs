/**
 * src/utils/item-from-words/review.mjs
 * What the review window does to a draft (step doc 7.43 section 3, 7.43c): patch one unresolved reference, set one aside
 * as a note, and turn a checked draft into the spec Create passes on. Every change is made to the draft and the draft is
 * checked again; nothing is spliced into the checked spec by hand. Pure.
 */
import { SYSTEM_ID } from '../../constants.mjs';
import { toStringList } from '../first-scalar.mjs';
import { isPlainObject } from './check-reading.mjs';

/** One step of a reported path: `grants[0]` is `{ key: 'grants', index: 0 }`, `onHit` is `{ key: 'onHit' }`. */
function steps(path) {
  return String(path).split('.').map((part) => {
    const open = part.indexOf('[');
    if (open === -1) return { key: part };
    return { key: part.slice(0, open), index: Number(part.slice(open + 1, part.indexOf(']'))) };
  });
}

/**
 * Walk to the container of the value a reported path names. A row that is one object where a list belongs counts as a
 * list of one, and a comma string where a list of ids belongs becomes the list, as `checkDraft` read them.
 * @returns {{ container: object, key: string, index: number|undefined }|null} null when the draft no longer has the place
 */
function locate(draft, path) {
  const list = steps(path);
  let node = draft;
  for (const [i, step] of list.entries()) {
    if (!isPlainObject(node)) return null;
    const last = i === list.length - 1;
    if (step.index === undefined) {
      if (last) return { container: node, key: step.key };
      node = node[step.key];
      continue;
    }
    let rows = node[step.key];
    if (isPlainObject(rows)) rows = node[step.key] = [rows];
    else if (typeof rows === 'string') rows = node[step.key] = toStringList(rows);
    if (!Array.isArray(rows)) return null;
    if (last) return { container: node, key: step.key, index: step.index };
    node = rows[step.index];
  }
  return null;
}

/**
 * Where the reference of an `unresolved` record sits in the draft.
 * - `entry`: one id in a list (`persistentBuffs[1]`); the list is indexed after blanks are left out, so it is found by the reference it held.
 * - `field`: the reference field of a row (`grants[0].identifier`); `rows[index]` is the row.
 * - `scalar`: a value of its own (`spellIdentifier`).
 * @returns {{ shape: 'entry'|'field'|'scalar', rows?: Array, index?: number, container?: object, key?: string }|null}
 */
function find(draft, { path, ref }) {
  const list = steps(path);
  const last = list.at(-1);
  if (last.index !== undefined) {
    const at = locate(draft, path);
    const rows = at && at.container[at.key];
    const index = Array.isArray(rows) ? rows.findIndex((e) => typeof e === 'string' && e.trim() === ref) : -1;
    return index < 0 ? null : { shape: 'entry', rows, index };
  }
  if (list.length > 1 && list.at(-2).index !== undefined) {
    const at = locate(draft, path.slice(0, path.lastIndexOf('.')));
    const rows = at && at.container[at.key];
    return Array.isArray(rows) && isPlainObject(rows[at.index]) ? { shape: 'field', rows, index: at.index, key: last.key } : null;
  }
  const at = locate(draft, path);
  return at && at.container[at.key] !== undefined ? { shape: 'scalar', container: at.container, key: at.key } : null;
}

/**
 * The draft with one unresolved reference answered by the identifier the user picked.
 * @param {object} draft what `extractDraft` found
 * @param {{ path: string, ref: string }} entry an `unresolved` record of `checkDraft`
 * @param {string} identifier the catalog identifier chosen
 * @returns {object|null} a changed copy, or null when the draft no longer holds the reference
 */
export function pickReference(draft, entry, identifier) {
  const next = structuredClone(draft);
  const place = find(next, entry);
  if (!place) return null;
  if (place.shape === 'entry') place.rows[place.index] = identifier;
  else if (place.shape === 'field') place.rows[place.index][place.key] = identifier;
  else place.container[place.key] = identifier;
  return next;
}

/**
 * The draft with one unresolved reference answered "leave it as a note": the row or entry is removed and `line` joins the
 * draft's `unexpressed` list.
 * @param {object} draft
 * @param {{ path: string, ref: string }} entry
 * @param {string} line the note, as it will read in the description
 * @returns {object|null} a changed copy, or null when the draft no longer holds the reference
 */
export function noteReference(draft, entry, line) {
  const next = structuredClone(draft);
  const place = find(next, entry);
  if (!place) return null;
  if (place.shape === 'scalar') delete place.container[place.key];
  else place.rows.splice(place.index, 1);
  const notes = Array.isArray(next.unexpressed) ? next.unexpressed : typeof next.unexpressed === 'string' ? [next.unexpressed] : [];
  next.unexpressed = [...notes, line];
  return next;
}

/**
 * The spec Create passes to `createAndEditItem(type, spec)`: the checked spec, the source stamp the user chose, and the
 * unexpressed lines the user kept as one last paragraph of the description. `checkDraft` already cleaned each line with
 * `plainText` (angle brackets and enricher syntax neutralised), so the paragraph is that text between `<p>` tags and is
 * never escaped a second time (which would turn `&lt;` into `&amp;lt;`).
 * @param {{ type: string, spec: object, unexpressed: string[] }} check a `checkDraft` result that is `ok`
 * @param {{ stamp: object, keepNotes: boolean }} options `stamp` is the full source stamp (`{ theme, set, authorship, ... }`);
 *   `keepNotes` appends `check.unexpressed` to the description
 * @returns {{ type: string, spec: object }}
 */
export function reviewSpec(check, { stamp, keepNotes }) {
  const spec = structuredClone(check.spec);
  const notes = keepNotes ? check.unexpressed.filter((line) => typeof line === 'string' && line.trim()) : [];
  if (notes.length) spec.system.description = `${spec.system.description ?? ''}<p>${notes.join(' ')}</p>`;
  spec.flags = { ...(spec.flags ?? {}), [SYSTEM_ID]: { ...(spec.flags?.[SYSTEM_ID] ?? {}), source: { ...stamp } } };
  return { type: check.type, spec };
}
