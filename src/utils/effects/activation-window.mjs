/**
 * Buff activation windows, the read half (leaf: imports only the sanitiser). A buff with `system.activation.enabled`
 * applies only while its window is open (opened by Use, closed by the clock, a combat end, a count of uses or hits, or
 * by hand); while closed it is withheld by `isBuffSuppressed`, so every reader of active buffs follows. The write half
 * is `documents/actor/buff-activation.mjs`; the pure arithmetic is `activation-plan.mjs`.
 */
import { firstScalar } from '../first-scalar.mjs';

/** The units a window may close by: counted events (`use`, `hit`), timed lengths, or the end of the combat. */
export const ACTIVATION_WINDOW_UNITS = Object.freeze(['use', 'hit', 'seconds', 'rounds', 'minutes', 'hours', 'combat']);

/** The key of an activation's cooldown record in the buff's `useRecords`. */
export const ACTIVATION_RECORD_KEY = 'activation';

const EVENT_UNITS = Object.freeze(['use', 'hit']);
const FALLBACK_UNIT = 'use';

const finite = (raw, fallback) => {
  const n = Number(firstScalar(raw, fallback));
  return Number.isFinite(n) ? n : fallback;
};

/** @returns {boolean} whether the unit counts events (a use or a hit) rather than time */
export const isEventUnit = (unit) => EVENT_UNITS.includes(unit);

/**
 * The sanitised activation block of a buff (an item, a `getActiveBuffs()` entry or a bare system object). A missing
 * block reads as a disabled one; an unknown unit reads as `use`; a non-number reads as its initial.
 * @param {object|null|undefined} item
 * @returns {{ enabled: boolean, cooldown: object|null, window: { unit: string, value: number, query: object|null },
 *   open: boolean, closesAt: number|null, combatId: string, usesLeft: number }}
 */
export function activationOf(item) {
  const raw = item?.system?.activation ?? item?.activation ?? null;
  const window = raw?.window ?? {};
  const unit = String(firstScalar(window.unit, FALLBACK_UNIT)).trim();
  const query = window.query && typeof window.query === 'object' ? window.query : null;
  const closesAt = raw?.closesAt === null || raw?.closesAt === undefined ? null : finite(raw.closesAt, null);
  return {
    enabled: raw?.enabled === true,
    cooldown: raw?.cooldown && typeof raw.cooldown === 'object' ? raw.cooldown : null,
    window: { unit: ACTIVATION_WINDOW_UNITS.includes(unit) ? unit : FALLBACK_UNIT, value: Math.max(0, finite(window.value, 1)), query },
    open: raw?.open === true,
    closesAt,
    combatId: typeof raw?.combatId === 'string' ? raw.combatId : '',
    usesLeft: Math.max(0, Math.floor(finite(raw?.usesLeft, 0)))
  };
}

/**
 * True when the buff is an activated one whose window is not open: its rows, grants and tags are withheld.
 * @param {object|null|undefined} item the owned buff (look a `getActiveBuffs()` entry up on the actor by id first)
 * @returns {boolean}
 */
export function activationClosed(item) {
  const activation = activationOf(item);
  return activation.enabled && !activation.open;
}
