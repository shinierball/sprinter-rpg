/**
 * Race and Class are chosen on reaching the Third Floor.
 * A crawler below the unlock floor has neither. Applying one there is a Rule Break the user confirms (CONTRIBUTING rule 2):
 * nothing is blocked, the embedded race or class item records `ruleBreak: true`.
 *
 * The floor that counts is the higher of the world floor clock and the actor's own `details.floor`,
 * so a crawler created on Floor 3 is never prompted while the world clock still reads Floor 1.
 */
import { SYSTEM_ID } from '../../constants.mjs';
import { getCurrentFloor } from '../floor/current-floor.mjs';
import { parseFloorNumber } from '../floor/floor-number.mjs';
import { confirmRuleBreak, RULE_BREAK_REFUSALS, isRuleBreak } from '../rule-break.mjs';
import { escapeAttr } from '../escape-attr.mjs';

/** Default unlock floor; worlds and modules override it with `CONFIG.COG.raceClassUnlockFloor`. */
export const RACE_CLASS_UNLOCK_FLOOR = 3;

const TEMPLATES = {
  'COG.RaceClass.RuleBreakTitle': 'Race and Class Not Unlocked',
  'COG.RaceClass.RuleBreakMessage': 'Race and Class are chosen on Floor {floor}, and {actor} is on Floor {current}. Apply {name} anyway as a Rule Break?',
  'COG.RaceClass.RuleBreakReason': 'Race and Class are chosen on Floor {floor}; {actor} is on Floor {current}.',
  'COG.RaceClass.UnlockHint': 'Race and Class unlock on Floor {floor}',
  'COG.RaceClass.CreatorHint': 'Race and Class are chosen on Floor {floor}.',
  'COG.RaceClass.SpeciesLabel': 'Origin: {species}'
};

/**
 * Localized text for the race/class floor rule, with an English fallback when no i18n is loaded.
 * @param {string} key one of the `COG.RaceClass.*` keys
 * @param {object} [data]
 * @returns {string}
 */
export function raceClassText(key, data = {}) {
  const i18n = globalThis.game?.i18n;
  if (i18n?.has?.(key) && typeof i18n.format === 'function') return i18n.format(key, data);
  return (TEMPLATES[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => String(data[k] ?? ''));
}


const norm = (v) => (typeof v === 'string' ? v.trim().toLowerCase() : '');

/** The configured unlock floor (a positive integer; anything unreadable falls back to 3). */
export function raceClassUnlockFloor() {
  let raw = globalThis.CONFIG?.COG?.raceClassUnlockFloor;
  if (Array.isArray(raw)) raw = raw[0];
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : RACE_CLASS_UNLOCK_FLOOR;
}

/**
 * The floor an actor is on for this rule: the higher of the world clock and its `details.floor`.
 * @param {object} actor
 * @returns {number}
 */
export function effectiveFloor(actor, worldFloor = getCurrentFloor()) {
  return Math.max(Number(worldFloor) || 0, parseFloorNumber(actor?.system?.details?.floor));
}

/** True when `actor` is a crawler below the unlock floor. Other actor types (pets, mercenaries) are never locked. */
export function isRaceClassLocked(actor, worldFloor = getCurrentFloor()) {
  return actor?.type === 'crawler' && effectiveFloor(actor, worldFloor) < raceClassUnlockFloor();
}

function itemsOf(actor) {
  return Array.from(actor?.items ?? []);
}

/**
 * The race or class the actor already has from the applier: its flag record and embedded item.
 * @param {object} actor
 * @param {'race'|'class'} kind
 * @returns {{ flag: object|null, item: object|null }}
 */
function appliedSource(actor, kind) {
  const flagKey = kind === 'race' ? 'appliedRace' : 'appliedClass';
  const flag = actor?.getFlag?.(SYSTEM_ID, flagKey) || actor?.flags?.[SYSTEM_ID]?.[flagKey] || null; // a view has `flags`, not `getFlag`
  const items = itemsOf(actor).filter(i => i?.type === kind);
  const item = (flag?.itemId ? items.find(i => (i.id ?? i._id) === flag.itemId) : null) || items[0] || null;
  return { flag, item };
}

/**
 * True when `def` is the race or class the actor already has, so applying it is a refresh (sheet re-select,
 * compendium sync), not a new choice. Matches the applied item's `system.identifier` first, then the name.
 * @param {object} actor
 * @param {'race'|'class'} kind
 * @param {object} def `{ name, system? }`
 * @returns {boolean}
 */
function isSameAppliedSource(actor, kind, def) {
  const { flag, item } = appliedSource(actor, kind);
  const defId = norm(def?.system?.identifier);
  const itemId = norm(item?.system?.identifier);
  if (defId && itemId) return defId === itemId;
  const name = norm(def?.name);
  if (!name) return false;
  if (flag || item) return name === norm(flag?.name) || name === norm(item?.name);
  // An uncataloged custom name kept only as the detail string
  return name === norm(actor?.system?.details?.[kind]);
}


/**
 * Whether taking `def` as the crawler's `kind` is a floor Rule Break, and what to say about it. Pure: nothing is asked.
 * Never needed for other actor types, at or above the unlock floor, or when re-applying the race or class the actor
 * already has (that keeps the previous item's `ruleBreak`).
 *
 * @param {object} actor an actor, or an actor-source view (`raceClassView`)
 * @param {'race'|'class'} kind
 * @param {object} def `{ name, system? }`
 * @param {{ worldFloor?: number }} [opts] the world clock's floor (default: the live clock)
 * @returns {{ needed: boolean, ruleBreak: boolean, reason?: string, data?: object }} `ruleBreak` is the inherited flag of a re-apply
 */
export function raceClassFloorBreak(actor, kind, def, { worldFloor = getCurrentFloor() } = {}) {
  if (!isRaceClassLocked(actor, worldFloor)) return { needed: false, ruleBreak: false };
  if (isSameAppliedSource(actor, kind, def)) {
    const previous = appliedSource(actor, kind).item;
    return { needed: false, ruleBreak: isRuleBreak(previous) };
  }
  const data = { floor: raceClassUnlockFloor(), current: effectiveFloor(actor, worldFloor), actor: actor?.name || 'This crawler', name: def?.name || kind };
  return { needed: true, ruleBreak: false, reason: raceClassText('COG.RaceClass.RuleBreakReason', data), data };
}

/**
 * Ask a Rule Break before a crawler below the unlock floor takes a race or class (see {@link raceClassFloorBreak}).
 * Removing a race or class is never gated; callers only call this to apply.
 *
 * @param {object} actor
 * @param {'race'|'class'} kind
 * @param {object} def the race or class being applied (`{ name, system? }`)
 * @param {object} [options] passed to `confirmRuleBreak` (`ruleBreak: true` pre-confirms, `interactive: false` refuses); set to `warned: true` when a refusal was announced
 * @returns {Promise<{ proceed: boolean, ruleBreak: boolean, refusal?: string }>}
 */
export async function confirmRaceClassFloor(actor, kind, def, options = {}) {
  const gate = raceClassFloorBreak(actor, kind, def);
  if (!gate.needed) return { proceed: true, ruleBreak: gate.ruleBreak };
  const { data, reason } = gate;
  const res = await confirmRuleBreak({
    title: raceClassText('COG.RaceClass.RuleBreakTitle'),
    message: raceClassText('COG.RaceClass.RuleBreakMessage', { ...data, actor: escapeAttr(data.actor), name: escapeAttr(data.name) }),
    reason,
    options
  });
  if (!res.confirmed) {
    if (res.refusal !== RULE_BREAK_REFUSALS.CANCELLED) {
      globalThis.ui?.notifications?.warn?.(reason);
    }
    return { proceed: false, ruleBreak: false, refusal: res.refusal };
  }
  return { proceed: true, ruleBreak: true };
}
