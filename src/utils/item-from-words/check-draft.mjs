/**
 * src/utils/item-from-words/check-draft.mjs
 * `checkDraft(draft, { resolve, expectedType })`: judge a chatbot's draft (step doc 7.43 section 2.6). The draft is untrusted, so every
 * field is checked against the DataModel and the registries, a field that fails is dropped on its own, and nothing the
 * draft says reaches a document except through the cleaned `spec` and `buildPayload`. Never throws; warnings, dropped
 * keys and unresolved references never make `ok` false, because the user decides in the review. Pure.
 */
import { buildPayload } from '../../data/builders/item-payload.mjs';
import { firstScalar } from '../first-scalar.mjs';
import { paragraphsHtml, plainText } from '../../sourcery/text.mjs';
import {
  DRAFT_TYPES, DRAFT_FIELDS, MODIFIER_ARRAYS, LIST_REFERENCES, SCALAR_REFERENCES, fieldChoices, fieldSpec
} from './draft-fields.mjs';
import { isPlainObject, newCheck, readScalar, resolveInto, setPath, systemPath } from './check-reading.mjs';
import { cleanGrants, cleanModifierRows, cleanOutcomes, cleanStringList } from './check-rows.mjs';

/** Longest item name a draft keeps. */
const DRAFT_NAME_MAX = 100;

/** Most `unexpressed` lines a draft keeps. */
const UNEXPRESSED_MAX = 50;

/** `text` cleaned for a field, cut to `max` characters without splitting an entity (`&lt;`) the cleaning wrote. */
function cleanedName(text, max) {
  const cleaned = plainText(text.trim()).trim();
  if (cleaned.length <= max) return cleaned;
  const cut = cleaned.slice(0, max);
  const amp = cut.lastIndexOf('&');
  return (amp > cut.lastIndexOf(';') ? cut.slice(0, amp) : cut).trim();
}

/** The keys a draft carries at its top level; any other (`img`, `flags`, `_id`, `items`, `folder`) is dropped. */
const DRAFT_KEYS = Object.freeze(['type', 'name', 'description', 'system', 'unexpressed']);

/** Every prefix of every allowed path: the objects a draft may nest (`durationConfig`, `healing`, `onHit`, `charges`). */
const parentsOf = (paths) => new Set(paths.flatMap((path) => path.split('.').slice(0, -1).map((_, i, parts) => parts.slice(0, i + 1).join('.'))));

/** Clean one array path by its row shape. */
function cleanArray(check, type, path, raw) {
  if (MODIFIER_ARRAYS.includes(path)) return cleanModifierRows(check, type, path, raw);
  if (path === 'grants') return cleanGrants(check, type, raw);
  if (path === 'outcomes') return cleanOutcomes(check, raw);
  return cleanStringList(check, type, path, raw, { references: LIST_REFERENCES[path] ?? null });
}

/** Walk a draft's `system` against the allow-list of its type; returns the cleaned `system`. */
function cleanSystem(check, type, system) {
  const { scalars, arrays } = DRAFT_FIELDS[type];
  const parents = parentsOf([...scalars, ...arrays]);
  const out = {};
  const visit = (node, prefix) => {
    for (const key of Object.keys(node)) {
      const path = prefix ? `${prefix}.${key}` : key;
      const raw = node[key];
      if (scalars.includes(path)) {
        const at = systemPath(path);
        const reference = SCALAR_REFERENCES[path];
        if (reference) {
          const id = resolveInto(check, at, reference, firstScalar(raw));
          if (id) setPath(out, path, id);
          continue;
        }
        const read = readScalar(check, at, raw, fieldSpec(type, path), fieldChoices(type, path));
        if (read.ok) setPath(out, path, read.value);
      } else if (arrays.includes(path)) {
        const rows = cleanArray(check, type, path, raw);
        if (rows.length) setPath(out, path, rows);
      } else if (parents.has(path) && isPlainObject(raw)) {
        visit(raw, path);
      } else {
        check.drop(systemPath(path), 'a draft may not set this');
      }
    }
  };
  visit(system, '');
  return out;
}

/**
 * @param {*} draft what `extractDraft` found: `{ type, name, description, system, unexpressed }`
 * @param {{ resolve?: { find?: (kind: string, ref: string) => object|null, list?: (kind: string) => object[] } }} [options]
 *   `resolve` reads the catalogs (default: the live ones through `catalog-lookup`); `find` matches an exact identifier, `list` gives every entry for the by-name step;
 *   `expectedType` is the type the prompt asked for: a draft of another type is still checked as its own type, with one `type` warning (a value outside `DRAFT_TYPES` is ignored)
 * @returns {{ ok: boolean, type: string, spec: { name?: string, system: object }|null, payload: object|null,
 *   warnings: Array<{ path: string, message: string, code: string }>, findings: Array<import('../item-check/registry.mjs').Finding>, unresolved: Array<{ path: string, kind: string, ref: string, row: * }>,
 *   dropped: Array<{ path: string, reason: string }>, unexpressed: string[],
 *   matchedByName: Array<{ path: string, kind: string, ref: string, identifier: string, name: string }> }}
 *   `unresolved[].row` is what was held out of the spec: the row, the list entry or the value.
 */
export function checkDraft(draft, { resolve, expectedType } = {}) {
  const check = newCheck(resolve);
  const result = { ok: false, type: '', spec: null, payload: null };
  try {
    run(check, draft, result, expectedType);
  } catch (err) {
    result.ok = false;
    result.payload = null;
    check.warn('draft', `could not be checked: ${err?.message ?? err}`, 'internal');
  }
  const { warnings, unresolved, dropped, unexpressed, matchedByName, findings } = check;
  return { ...result, warnings, findings, unresolved, dropped, unexpressed, matchedByName };
}

function run(check, draft, result, expectedType) {
  if (!isPlainObject(draft)) return check.warn('draft', 'is not an object', 'type');
  const type = firstScalar(draft.type);
  if (typeof type !== 'string' || !DRAFT_TYPES.includes(type.trim())) {
    return check.warn('type', `${JSON.stringify(draft.type)} is not one of: ${DRAFT_TYPES.join(', ')}`, 'type');
  }
  result.type = type.trim();
  if (DRAFT_TYPES.includes(expectedType) && expectedType !== result.type) {
    check.warn('type', `The prompt asked for a ${expectedType} item; the reply is a ${result.type}. It was checked as a ${result.type}.`, 'type');
  }
  for (const key of Object.keys(draft)) if (!DRAFT_KEYS.includes(key)) check.drop(key, 'a draft may not set this');

  const spec = { system: {} };
  if (typeof draft.name === 'string') {
    const name = cleanedName(draft.name, DRAFT_NAME_MAX);
    if (name) spec.name = name;
  } else if (draft.name !== undefined) check.drop('name', 'the name is not text');
  if (draft.system !== undefined && !isPlainObject(draft.system)) check.warn('system', 'is not an object', 'field');
  if (isPlainObject(draft.system)) spec.system = cleanSystem(check, result.type, draft.system);
  if (typeof draft.description === 'string') {
    const description = paragraphsHtml(draft.description);
    if (description) spec.system.description = description;
  } else if (draft.description !== undefined) check.drop('description', 'the description is not text');
  const notes = Array.isArray(draft.unexpressed) ? draft.unexpressed : typeof draft.unexpressed === 'string' ? [draft.unexpressed] : [];
  const drafted = [];
  for (const note of notes) {
    if (drafted.length >= UNEXPRESSED_MAX) break;
    const text = typeof note === 'string' ? plainText(note).trim() : '';
    if (text) drafted.push(text);
  }
  check.unexpressed = drafted.concat(check.unexpressed);

  // The 7.53 completeness check runs on the payload as it would be created, with this check's own resolver. Its findings
  // stay apart from `warnings` (they are advice, not a defect in the draft); an unknown tag is already a `tag` warning.
  const built = [];
  result.payload = buildPayload(result.type, structuredClone(spec), { warnings: built, delegate: false, check: { resolve: check.resolver } });
  for (const w of built) (w.code === 'check' ? check.findings : check.warnings).push(w.code === 'check' ? w.finding : w);
  result.spec = spec;
  result.ok = true;
}
