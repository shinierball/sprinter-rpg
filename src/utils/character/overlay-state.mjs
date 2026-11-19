/**
 * Which race is in force while a transformation is laid over a victim, and whether a debuff is switched
 * on. A leaf module: tags.mjs and tag-behaviour.mjs read these, and `transform-rules.mjs` (which imports tag-mechanics,
 * which imports tags.mjs) re-exports them, so they live here to keep the import graph acyclic.
 */
import { clearFlag, flagPath, readFlag, withFlags, withoutFlags, writeFlag } from '../flags.mjs';

// The stored keys of the transformation engine: this module is the one place that names them.
const STATE_KEY = 'transformation';
const OWNER_KEY = 'transformationOf';
const FORM_KEY = 'transformationForm';
const GRANTED_KEY = 'transformationGranted';
const PAUSED_BY_KEY = 'pausedBy';
const TAKEN_OFF_KEY = 'takenOffBy';

/** Whether a debuff carries a `transform` block (an object; null or a non-object is not an affliction). */
export function hasTransformBlock(item) {
  const block = item?.system && typeof item.system === 'object' ? item.system.transform : undefined;
  return item?.type === 'debuff' && Boolean(block) && typeof block === 'object' && !Array.isArray(block);
}

/** The engine state flag of an affliction (a plain object; empty when none was written). */
export function transformState(item) {
  const flag = readFlag(item, STATE_KEY);
  return flag && typeof flag === 'object' && !Array.isArray(flag) ? flag : {};
}

/** Store an affliction's engine state (the whole object replaces the old one). */
export function writeTransformState(affliction, state) {
  return writeFlag(affliction, STATE_KEY, state);
}

/** Remove an affliction's engine state. */
export function clearTransformState(affliction) {
  return clearFlag(affliction, STATE_KEY);
}

/**
 * The actor's stored attributes (`_source`), or its prepared ones when it has no source. While a form is laid over the
 * victim the prepared size and Move are the form's, so anything that reads a number to write it back, or to show it in
 * an input a save will submit, reads this.
 * @param {object} actor
 * @returns {object}
 */
export function storedAttributes(actor) {
  return actor?.system?._source?.attributes ?? actor?.system?.attributes ?? {};
}

/** The id of the affliction an item belongs to (a form race, its traits, a created skill, an added effect), or ''. */
export function transformationOfItem(item) {
  const id = readFlag(item, OWNER_KEY);
  return typeof id === 'string' ? id : '';
}

/** Whether an item belongs to an affliction: the same rule as `transformationOfItem`, a stamp that is a non-empty string. */
export function hasTransformationOwner(item) {
  return transformationOfItem(item) !== '';
}

/** `data` stamped as made for the affliction `owner`. A copy. */
export function withTransformationOf(data, owner) {
  return withFlags(data, { [OWNER_KEY]: owner });
}

/** `data` stamped with the form that created a skill and the rank that form gave it. A copy. */
export function withFormStamp(data, formIndex, granted) {
  return withFlags(data, { [FORM_KEY]: formIndex, [GRANTED_KEY]: granted });
}

/** The update that stamps an existing skill with its form and the rank the form gave it. */
export function formStampUpdate(formIndex, granted) {
  return { [flagPath(FORM_KEY)]: formIndex, [flagPath(GRANTED_KEY)]: granted };
}

/** Remove everything that ties a skill to an affliction's form (the owner, the form and the granted rank). */
export async function clearFormStamp(item) {
  for (const key of [OWNER_KEY, FORM_KEY, GRANTED_KEY]) await clearFlag(item, key);
}

/** The id of the affliction that paused a trait, or ''. */
export function pausedByOf(item) {
  return String(readFlag(item, PAUSED_BY_KEY) ?? '');
}

/** The update fields that record (an id) or clear (`''`) the affliction that paused a trait. */
export function pausedByUpdate(owner) {
  return { [flagPath(PAUSED_BY_KEY)]: owner };
}

/** The id of the affliction whose fit pass took a piece of gear off, or ''. */
export function takenOffByOf(item) {
  return String(readFlag(item, TAKEN_OFF_KEY) ?? '');
}

/** The update fields that record (an id) or clear (`''`) the affliction that took a piece of gear off. */
export function takenOffByUpdate(owner) {
  return { [flagPath(TAKEN_OFF_KEY)]: owner };
}

/**
 * The changed affliction whose form race is laid over the victim (stage `changed`, `formIndex >= 0`), or null.
 * With the original body as the form (index -1) there is no overlay: the original race is in force.
 * @param {Iterable<object>} items the actor's items
 * @returns {object|null}
 */
export function overlayOf(items) {
  for (const item of (items ?? [])) {
    if (!hasTransformBlock(item)) continue;
    const state = transformState(item);
    if (state.stage === 'changed' && Number(state.formIndex) >= 0) return item;
  }
  return null;
}

/**
 * The token image of the form in force: the `tokenImg` of the current form's row while an affliction is changed into a
 * form (`overlayOf`), else `''` (the original body, a pending affliction, a form with a blank image).
 * @param {Iterable<object>} items the actor's items
 * @returns {string}
 */
export function formTokenImage(items) {
  const overlay = overlayOf(items);
  if (!overlay) return '';
  const forms = overlay.system?.transform?.forms;
  const row = Array.isArray(forms) ? forms[Number(transformState(overlay).formIndex)] : null;
  return typeof row?.tokenImg === 'string' ? row.tokenImg.trim() : '';
}

/**
 * Whether a race item is the race in force. A form race (flagged `transformationOf`) is in force only while its
 * affliction is the overlay and names it as the current form; any other race item is in force while there is no overlay.
 * @param {Iterable<object>} items the actor's items
 * @param {object} raceItem
 * @returns {boolean}
 */
export function raceInForce(items, raceItem) {
  if (raceItem?.type !== 'race') return false;
  const overlay = overlayOf(items);
  const owner = transformationOfItem(raceItem);
  if (owner) {
    if (!overlay || (overlay.id ?? overlay._id) !== owner) return false;
    const formItemId = transformState(overlay).formItemId;
    return !formItemId || formItemId === (raceItem.id ?? raceItem._id);
  }
  return !overlay;
}

/** The race item in force, or null (an actor with no race). */
export function effectiveRace(items) {
  const list = Array.from(items ?? []);
  return list.find((item) => item?.type === 'race' && raceInForce(list, item)) ?? null;
}

/** Which form (its index in `transform.forms`) created a skill the engine made for a form; null for an unstamped item. */
export function formOriginOf(item) {
  const raw = readFlag(item, FORM_KEY);
  return Number.isInteger(raw) ? raw : null;
}

/** The rank the form's own row gave a skill it created (what leaves with the form), or null for an unstamped item. */
export function grantedRankOf(item) {
  const raw = readFlag(item, GRANTED_KEY);
  return raw === null || raw === undefined || raw === '' || !Number.isFinite(Number(raw)) ? null : Number(raw);
}

/**
 * Whether a skill the engine created for a form is in force: its form is the one the victim has now. A skill is kept,
 * not in force, while another form (or the original body) is current (1196). An unstamped item, one no affliction owns,
 * and any item that is not a transformation's is in force.
 * @param {Iterable<object>} items the actor's items
 * @param {object} item
 * @returns {boolean}
 */
export function formSkillInForce(items, item) {
  const owner = transformationOfItem(item);
  const origin = formOriginOf(item);
  if (!owner || origin === null) return true;
  const affliction = Array.from(items ?? []).find((i) => (i.id ?? i._id) === owner);
  if (!affliction) return true;
  const state = transformState(affliction);
  return state.stage === 'changed' && Number(state.formIndex) === origin;
}

/** The item flags the transformation engine owns (what a copy must not carry). */
const ENGINE_ITEM_FLAGS = Object.freeze([OWNER_KEY, PAUSED_BY_KEY, TAKEN_OFF_KEY, FORM_KEY, GRANTED_KEY]);

/**
 * Creation data stamped as a pending affliction: `transformation` replaced by `{ stage: 'pending', landedAt, landedFloor }`,
 * whatever was there. A copy.
 * @param {object} data creation data
 * @param {{ landedAt: number, landedFloor: number }} landing
 */
export function withPendingStamp(data, { landedAt, landedFloor }) {
  return withFlags(data, { [STATE_KEY]: { stage: 'pending', landedAt, landedFloor } });
}

/**
 * Creation data without the engine flags that name no affliction on the carrier. `owns(id)` answers "is `id` an
 * affliction on the carrier". `transformationForm` / `transformationGranted` go with `transformationOf`; `takenOffBy` is judged like `pausedBy`. When `pausedBy`
 * goes, the pause goes too (a buff `system.active: true`, a debuff `system.paused: false`, as `unpauseTraits` writes).
 * @param {object} data creation data (`type`, `flags`, `system`)
 * @param {(id: string) => boolean} owns
 * @returns {{ data: object, changed: boolean }} `data` is a copy
 */
export function withoutEngineFlags(data, owns) {
  const ownerOf = readFlag(data, OWNER_KEY);
  const keepOwner = typeof ownerOf === 'string' && ownerOf !== '' && owns(ownerOf);
  const pausedBy = readFlag(data, PAUSED_BY_KEY);
  const keepPause = typeof pausedBy === 'string' && pausedBy !== '' && owns(pausedBy);
  const takenOffBy = readFlag(data, TAKEN_OFF_KEY);
  const keepTakenOff = typeof takenOffBy === 'string' && takenOffBy !== '' && owns(takenOffBy);
  const keeps = { [PAUSED_BY_KEY]: keepPause, [TAKEN_OFF_KEY]: keepTakenOff };
  const strip = ENGINE_ITEM_FLAGS.filter((key) => !(key in keeps ? keeps[key] : keepOwner));
  let next = withoutFlags(data, strip);
  const changed = next !== data;
  if (pausedBy && !keepPause) {
    const unpause = data.type === 'buff' ? { active: true } : { paused: false };
    next = { ...next, system: { ...(next.system ?? {}), ...unpause } };
  }
  return { data: next, changed };
}
