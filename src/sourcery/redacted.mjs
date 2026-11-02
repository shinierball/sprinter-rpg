/**
 * src/sourcery/redacted.mjs
 * The marker a redacted canon spec carries: `flags['sprinter-rpg'].sourcery.redacted === true`.
 *
 * A redacted spec has its human-text fields emptied, the name among them. Foundry refuses a document without a name, so
 * the builders give a redacted spec a placeholder name (`New Spell 0012`), and the hydrator treats that name as empty:
 * the flag is how it knows. Hydrating a document replaces the `sourcery` flag (`{ resolved, source }`), so a hydrated
 * document is no longer redacted. Pure.
 */

import { MOB_TIER_PREFIX } from '../utils/tag-mechanics.mjs';

/** Flag scope (the system id; kept literal so the builders can use it). */
const SCOPE = 'sprinter-rpg';

const isRecord = v => !!v && typeof v === 'object' && !Array.isArray(v);

/** Whether a spec, payload or document carries the redacted marker. */
export function isRedacted(doc) {
  return isRecord(doc) && isRecord(doc.flags) && isRecord(doc.flags[SCOPE]) && isRecord(doc.flags[SCOPE].sourcery) && doc.flags[SCOPE].sourcery.redacted === true;
}

/** Whether a hydrated document carries `sourcery.resolved === false`: the importer could not parse its entry, so it is left empty. */
export function isUnresolved(doc) {
  return isRecord(doc) && isRecord(doc.flags) && isRecord(doc.flags[SCOPE]) && isRecord(doc.flags[SCOPE].sourcery) && doc.flags[SCOPE].sourcery.resolved === false;
}

/**
 * Why a document lacks book text: `'unresolved'` (not found in the provided PDFs), `'partial'` (imported, but the PDFs gave
 * nothing for the text paths still listed in `emptied`), `'redacted'` (not imported yet: a placeholder name, or text paths
 * still listed in `emptied`) or null. Unresolved wins when several apply.
 * @returns {'unresolved'|'partial'|'redacted'|null}
 */
export function noBookTextReason(doc) {
  if (isUnresolved(doc)) return 'unresolved';
  if (emptiedPaths(doc).length && doc.flags[SCOPE].sourcery.source === 'pdf') return 'partial';
  if (isRedacted(doc) || emptiedPaths(doc).length) return 'redacted';
  return null;
}

/** The marker as a `flags` value, for a redacted spec. */
export function redactedFlags() {
  return { [SCOPE]: { sourcery: { redacted: true } } };
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
  const g = isRecord(doc) && isRecord(doc.flags) && isRecord(doc.flags[SCOPE]) && isRecord(doc.flags[SCOPE].sourcery) ? doc.flags[SCOPE].sourcery.generated : null;
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
  const e = isRecord(doc) && isRecord(doc.flags) && isRecord(doc.flags[SCOPE]) && isRecord(doc.flags[SCOPE].sourcery) ? doc.flags[SCOPE].sourcery.emptied : null;
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
  return Object.keys(sourcery).length ? { [SCOPE]: { sourcery } } : {};
}
