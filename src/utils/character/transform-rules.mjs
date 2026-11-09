/**
 * Transformation rules: pure functions over item data, no document imports.
 *
 * An affliction is a debuff whose `system.transform` block names the forms (races) a victim changes into, the effects
 * the change adds, a reminder cue and a cure window. The engine state (stage, landing floor, the stored original race)
 * lives in `flags[SYSTEM_ID].transformation`, written only by the engine. Cues and cure windows are registries
 * (`CONFIG.COG.transformCues`, `CONFIG.COG.cureWindows`), never schema choices; an unknown id is inert.
 */
import { firstScalar } from '../first-scalar.mjs';
import { FORM_RACE_TAG } from '../../data/tag-vocabulary.mjs';
import { hasTransformBlock } from '../effects/debuff-force.mjs';
import { transformState, transformationOfItem, overlayOf, raceInForce } from './overlay-state.mjs';

// The pause and overlay predicates live in leaf modules (tags.mjs reads them); they are part of this module's API
export { transformState, transformationOfItem, overlayOf, raceInForce };

/**
 * @typedef {object} TransformCueDef
 * @property {string} id
 * @property {string} label
 * @property {string} [hint] one line for an editor
 */

/**
 * @typedef {object} CureWindowDef
 * @property {string} id
 * @property {string} label
 * @property {(state: object, now: { floor?: number }) => boolean} open whether a cure after the change reverts freely
 */

/** @type {Record<string, TransformCueDef>} The reminder moments. `CONFIG.COG.transformCues === TRANSFORM_CUES`. */
export const TRANSFORM_CUES = {};

/** @type {Record<string, CureWindowDef>} Cure windows after the change. `CONFIG.COG.cureWindows === CURE_WINDOWS`. */
export const CURE_WINDOWS = {};

const ID = /^[A-Za-z][\w.-]*$/;

/**
 * Add a reminder cue. Modules prefix theirs ('my-module.moon'); a module adds a cue only together with the code that posts it.
 * @param {TransformCueDef} def
 * @returns {boolean} whether it was registered
 */
export function registerTransformCue(def) {
  const id = def?.id;
  if (typeof id !== 'string' || !ID.test(id)) {
    console.warn(`Sprinter RPG | Transform cue ${String(id)} was not registered: it needs an id.`);
    return false;
  }
  TRANSFORM_CUES[id] = { label: id, hint: '', ...def };
  return true;
}

/**
 * Add a cure window.
 * @param {CureWindowDef} def
 * @returns {boolean} whether it was registered
 */
export function registerCureWindow(def) {
  const id = def?.id;
  if (typeof id !== 'string' || !ID.test(id) || typeof def.open !== 'function') {
    console.warn(`Sprinter RPG | Cure window ${String(id)} was not registered: it needs an id and an open(state, now) function.`);
    return false;
  }
  CURE_WINDOWS[id] = { label: id, ...def };
  return true;
}

for (const def of [
  { id: 'apply', label: 'When it lands', hint: 'A card with a Change button right after it lands.' },
  { id: 'death', label: 'At 0 Health', hint: 'A GM-only card with a Change button when damage takes the victim to 0 Health.' },
  { id: 'rest', label: 'After a long rest', hint: 'A card with a Change button after a long or full-day rest (posts in a later release).' },
  { id: 'floor', label: 'On a floor change', hint: 'A GM card with a Change button when the current floor changes (posts in a later release).' }
]) registerTransformCue(def);

for (const def of [
  { id: 'never', label: 'Not after the change (Rule Break)', open: () => false },
  { id: 'always', label: 'Any time', open: () => true },
  {
    id: 'floor',
    label: 'Until the floor ends',
    open: (state, now) => Number.isFinite(Number(state?.landedFloor)) && Number.isFinite(Number(now?.floor)) && Number(state.landedFloor) === Number(now.floor)
  }
]) registerCureWindow(def);

const warned = new Set();
function warnOnce(key, message) {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(`Sprinter RPG | ${message}`);
}
/** Tests only: forget which warnings were already printed. */
export function resetTransformWarnings() { warned.clear(); }

const text = (raw) => {
  const val = firstScalar(raw, '');
  return typeof val === 'string' ? val.trim() : '';
};

const asList = (raw) => {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object') return Object.values(raw);
  return [];
};

/**
 * A stored `transform` block as clean data (CONTRIBUTING §4): `cue`, `curable` and each form's `race` take the first
 * entry of an array or comma list; form rows with no race are dropped; `effects` are trimmed and deduplicated (a comma
 * list is a list of identifiers). Null or a non-object is not an affliction.
 * @param {*} raw
 * @returns {{ forms: Array<{race: string, label: string, tokenImg: string}>, effects: string[], cue: string, curable: string }|null}
 */
export function normalizeTransform(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const forms = [];
  for (const row of asList(raw.forms)) {
    const race = text(row?.race);
    if (!race) continue;
    forms.push({
      race,
      label: typeof row.label === 'string' ? row.label.trim() : '',
      tokenImg: typeof row.tokenImg === 'string' ? row.tokenImg.trim() : ''
    });
  }
  const rawEffects = typeof raw.effects === 'string' ? raw.effects.split(',') : asList(raw.effects);
  const effects = [];
  for (const entry of rawEffects) {
    const id = text(entry);
    if (id && !effects.includes(id)) effects.push(id);
  }
  return { forms, effects, cue: text(raw.cue), curable: text(raw.curable) || 'never' };
}

const sysOf = (item) => (item?.system && typeof item.system === 'object' ? item.system : {});

/** Whether a debuff carries a `transform` block. */
export function isAffliction(item) {
  return hasTransformBlock(item);
}

/** `'pending'`, `'changed'`, or `''` when the item is not an affliction. An affliction with no state yet is pending. */
export function afflictionStage(item) {
  if (!isAffliction(item)) return '';
  return transformState(item).stage === 'changed' ? 'changed' : 'pending';
}

/** The sanitized form rows of an affliction (empty when it has none). `formIndex` in the state indexes this list. */
export function formEntries(item) {
  return normalizeTransform(sysOf(item).transform)?.forms ?? [];
}

/** One form row, or null. */
export function formAt(item, index) {
  const i = Number(index);
  return Number.isInteger(i) && i >= 0 ? formEntries(item)[i] ?? null : null;
}

/** The registered cue an affliction names, or null (none, or unknown: inert, with one warning per id). */
export function cueOf(item) {
  const id = normalizeTransform(sysOf(item).transform)?.cue ?? '';
  if (!id) return null;
  const def = TRANSFORM_CUES[id];
  if (!def) warnOnce(`cue:${id}`, `Unknown transform cue "${id}"; it posts no reminder.`);
  return def ?? null;
}

/**
 * Whether the affliction's cure window is open: a cure then reverts a changed affliction with no prompt.
 * An unknown window counts as `never`, with one warning per id.
 * @param {object} item
 * @param {{ floor?: number }} [now]
 * @returns {boolean}
 */
export function cureWindowOpen(item, now = {}) {
  const id = normalizeTransform(sysOf(item).transform)?.curable || 'never';
  const def = CURE_WINDOWS[id];
  if (!def) {
    warnOnce(`window:${id}`, `Unknown cure window "${id}"; it counts as "never".`);
    return false;
  }
  try {
    return def.open(transformState(item), now ?? {}) === true;
  } catch {
    return false;
  }
}

/** Whether a cure must ask a Rule Break: a changed affliction whose window is closed. A pending one cures freely. */
export function heldByCure(item, now = {}) {
  return afflictionStage(item) === 'changed' && !cureWindowOpen(item, now);
}

/** Whether a race definition (data or item) is only a transformation form: the `race.form` tag. */
export function isFormRace(def) {
  return (def?.system?.tags ?? def?.tags ?? []).includes(FORM_RACE_TAG);
}

/**
 * A stat score after rows with a minimum. `scoreAll` includes every row; `flooredSum` is the sum of the rows that carry
 * a `floor`. The floored rows never take the score below `floor`, and do nothing to a score already at or below it.
 * A `floor` of 0 or less is no minimum.
 * @param {number} scoreAll
 * @param {number} flooredSum
 * @param {number} floor
 * @returns {number}
 */
export function flooredScore(scoreAll, flooredSum, floor) {
  const all = Number(scoreAll);
  const sum = Number(flooredSum);
  const min = Number(floor);
  if (!Number.isFinite(all)) return all;
  if (!Number.isFinite(sum) || !Number.isFinite(min) || min <= 0) return all;
  const without = all - sum;
  return Math.max(all, Math.min(min, without));
}
