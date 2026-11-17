/**
 * src/sourcery/redacted.mjs
 * The marker a redacted canon spec carries: `flags['sprinter-rpg'].sourcery.redacted === true`.
 *
 * A redacted spec has its human-text fields emptied, the name among them. Foundry refuses a document without a name, so
 * the builders give a redacted spec a placeholder name (`New Spell 0012`), and the hydrator treats that name as empty:
 * the flag is how it knows. Hydrating a document replaces the `sourcery` flag (`{ resolved, source }`), so a hydrated
 * document is no longer redacted. Pure.
 */

import { MOB_TIER_PREFIX } from '../utils/tag/tag-mechanics.mjs';
import { flagPath, readFlag, withFlags } from '../utils/flags.mjs';

const SOURCERY = 'sourcery';

const isRecord = v => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * The `sourcery` flag of a spec, payload or document: what the importer recorded about it (`redacted`, `resolved`,
 * `source`, `generated`, `emptied`, ...). `{}` when it has none or it is not an object. Callers read, never change, it.
 */
export function sourceryOf(doc) {
  if (!isRecord(doc)) return {};
  const value = readFlag(doc, SOURCERY);
  return isRecord(value) ? value : {};
}

/** `data` with its `sourcery` flag set to `value` (a copy; see `withFlags`). */
export const withSourcery = (data, value) => withFlags(data, { [SOURCERY]: value });

/** The `flags` object (system scope included) that carries `value` as the `sourcery` flag, for a builder's `flags` field. */
export const sourceryFlagsOf = (value) => withSourcery({}, value).flags;

/** The pack-index field and query path of a document's recipe id (`sourcery.id`), which the import writes on a table. */
export const SOURCERY_ID_PATH = flagPath('sourcery.id');

/** Whether a spec, payload or document carries the redacted marker. */
export function isRedacted(doc) {
  return sourceryOf(doc).redacted === true;
}

/** Whether a hydrated document carries `sourcery.resolved === false`: the importer could not parse its entry, so it is left empty. */
export function isUnresolved(doc) {
  return sourceryOf(doc).resolved === false;
}

/**
 * Why a document lacks book text: `'unresolved'` (not found in the provided PDFs), `'partial'` (imported, but the PDFs gave
 * nothing for the text paths still listed in `emptied`), `'redacted'` (not imported yet: a placeholder name, or text paths
 * still listed in `emptied`) or null. Unresolved wins when several apply.
 * @returns {'unresolved'|'partial'|'redacted'|null}
 */
export function noBookTextReason(doc) {
  if (isUnresolved(doc)) return 'unresolved';
  if (emptiedPaths(doc).length && sourceryOf(doc).source === 'pdf') return 'partial';
  if (isRedacted(doc) || emptiedPaths(doc).length) return 'redacted';
  return null;
}

/** The marker as a `flags` value, for a redacted spec. */
export function redactedFlags() {
  return sourceryFlagsOf({ redacted: true });
}

/**
 * The descriptive base of a redacted document's placeholder name, read from its structured data: a mob reads
 * `Level 7 Boss` (a `mob.tier.*` tag marks a boss) or `Level 3 Mob`, an achievement reads `Achievement`. Any other type, or a
 * mob with no usable level, gets `fallback` (the builder's default name for the type). The hydrator recognises a placeholder by
 * the redacted flag, never by this text.
 * @param {object} spec
 * @param {string} fallback
 * @param {string} [type] the document type when the spec does not carry it (a builder input)
 * @returns {string}
 */
export function placeholderBase(spec, fallback, type = spec?.type) {
  if (type === 'achievement') return 'Achievement';
  if (type !== 'mob') return fallback;
  const level = Number(spec.system?.details?.level);
  if (!Number.isInteger(level) || level < 1) return fallback;
  const tags = Array.isArray(spec.system?.tags) ? spec.system.tags : [];
  return `Level ${level} ${tags.some(t => typeof t === 'string' && t.startsWith(MOB_TIER_PREFIX)) ? 'Boss' : 'Mob'}`;
}

/**
 * The placeholder name of a redacted document: the builder's default name for its type plus the last four characters of
 * its `_id`, so a list of unhydrated documents is told apart.
 * @param {string} base the type's default name (`New Spell`), or {@link placeholderBase}
 * @param {string} [id]
 */
export function placeholderName(base, id) {
  const tail = typeof id === 'string' ? id.slice(-4) : '';
  return tail ? `${base} ${tail}` : base;
}

/**
 * Paths whose value is the generated stand-in (a join with generator parts, `src/sourcery/generators.mjs`):
 * `flags['sprinter-rpg'].sourcery.generated`, an array of strings. Separate from `redacted`, which means the name is a
 * placeholder. The hydrator treats such a path as empty; a hydrated document no longer carries the ones it filled.
 * @returns {string[]}
 */
export function generatedPaths(doc) {
  const g = sourceryOf(doc).generated;
  return Array.isArray(g) ? g.filter(p => typeof p === 'string' && p) : [];
}

/**
 * Paths the redaction emptied or cut (`scripts/lib/redact-specs.mjs`): `flags['sprinter-rpg'].sourcery.emptied`, an
 * array of strings. Each held text in the full spec and is empty in the redacted one, or keeps only its plain lines: the
 * text an import is asked to restore. The name is not listed (the `redacted` marker stands for it), nor are generated paths (their own flag). A
 * hydrated document keeps only the ones it did not fill. Paths only, never text.
 * @returns {string[]}
 */
export function emptiedPaths(doc) {
  const e = sourceryOf(doc).emptied;
  return Array.isArray(e) ? e.filter(p => typeof p === 'string' && p) : [];
}

/**
 * The `sourcery` flag a pack document or redacted spec carries: `redacted`, `generated` and `emptied` (paths only, never
 * text), nothing else (the engine's own `resolved`/`source` keys belong to hydrated documents).
 * @returns {object} a `flags` value (empty when neither applies)
 */
export function sourceryFlags(doc) {
  const sourcery = {};
  if (isRedacted(doc)) sourcery.redacted = true;
  const generated = generatedPaths(doc);
  if (generated.length) sourcery.generated = generated;
  const emptied = emptiedPaths(doc);
  if (emptied.length) sourcery.emptied = emptied;
  return Object.keys(sourcery).length ? sourceryFlagsOf(sourcery) : {};
}

/**
 * The `sourcery` flag a synced copy should carry once its compendium document is current, or `undefined` when the copy's
 * own flag stays as it is. A copy marked `redacted` whose source is no longer redacted drops the marker, and one that
 * lists `emptied` paths while the source lists none drops them. Each dropped key is written as Foundry's `-=key` deletion
 * so the merge removes the stale value and keeps the rest of the flag.
 * @param {object} target the world copy (document or data)
 * @param {object} source the compendium document it is synced from
 */
export function syncedSourcery(target, source) {
  const own = sourceryOf(target);
  let next;
  if (own.redacted && !isRedacted(source)) {
    next = { ...own };
    delete next.redacted;
    next['-=redacted'] = null;
  }
  if (own.emptied && !emptiedPaths(source).length) {
    next = { ...(next || own) };
    delete next.emptied;
    next['-=emptied'] = null;
  }
  return next;
}
