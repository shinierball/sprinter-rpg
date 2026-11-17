/**
 * Which race is in force while a transformation is laid over a victim, and whether a debuff is switched
 * on. A leaf module: tags.mjs and tag-behaviour.mjs read these, and `transform-rules.mjs` (which imports tag-mechanics,
 * which imports tags.mjs) re-exports them, so they live here to keep the import graph acyclic.
 */
import { SYSTEM_ID } from '../../constants.mjs';
import { hasTransformBlock } from '../effects/debuff-force.mjs';
import { readFlag } from '../flags.mjs';

/** The engine state flag of an affliction (a plain object; empty when none was written). */
export function transformState(item) {
  const flag = item?.flags?.[SYSTEM_ID]?.transformation;
  return flag && typeof flag === 'object' && !Array.isArray(flag) ? flag : {};
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
  const id = item?.flags?.[SYSTEM_ID]?.transformationOf;
  return typeof id === 'string' ? id : '';
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
  const raw = readFlag(item, 'transformationForm');
  return Number.isInteger(raw) ? raw : null;
}

/** The rank the form's own row gave a skill it created (what leaves with the form), or null for an unstamped item. */
export function grantedRankOf(item) {
  const raw = readFlag(item, 'transformationGranted');
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
