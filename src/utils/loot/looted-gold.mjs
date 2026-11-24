/**
 * The lifetime count of gold an actor has received (`system.currency.looted`, core pp. 163, 215): every rise of
 * `system.currency.gold` adds to it (the human, 1472 (c)), written by the `preUpdateActor` hook beside the rise. A deity's
 * tithe is worked out from it (the bond's `titheMark` holds the count at the last tithe).
 */
import { firstScalar } from '../first-scalar.mjs';

const GOLD_PATH = 'system.currency.gold';
const LOOTED_PATH = 'system.currency.looted';

/** A whole number of 0 or more from a stored or incoming value, or null when it is not a number. */
function wholeOrNull(raw) {
  const n = Math.floor(Number(firstScalar(raw, null)));
  return Number.isFinite(n) ? Math.max(0, n) : null;
}

/** The sanitised `system.currency.looted` of an actor (whole, at least 0; anything else reads 0). */
export function lootedGoldOf(actor) {
  return wholeOrNull(actor?.system?.currency?.looted) ?? 0;
}

/** The value an update carries at a dotted path, whether the update is expanded or flattened. */
function carried(changes, path) {
  const flat = changes && typeof changes === 'object' ? changes : {};
  if (Object.hasOwn(flat, path)) return { has: true, value: flat[path] };
  const nested = globalThis.foundry.utils.getProperty(flat, path);
  return { has: nested !== undefined, value: nested };
}

/**
 * The extra change that counts a gold rise: when an update raises the actor's gold, `{ 'system.currency.looted': looted + rise }`.
 * A fall, an equal value, a non-number, or an update that already sets the count gives `{}`.
 * @param {object} actor
 * @param {object} changes the update's data
 * @returns {object}
 */
export function lootedGoldChange(actor, changes) {
  const incoming = carried(changes, GOLD_PATH);
  if (!incoming.has || carried(changes, LOOTED_PATH).has) return {};
  const next = wholeOrNull(incoming.value);
  if (next === null) return {};
  const rise = next - (wholeOrNull(actor?.system?.currency?.gold) ?? 0);
  return rise > 0 ? { [LOOTED_PATH]: lootedGoldOf(actor) + rise } : {};
}

/**
 * The update for the GM taking gold back (the human, 1474 (c)): `n` off the gold and off the count, neither below 0, in
 * one update. The pre-update hook sees a fall and adds nothing.
 * @param {object} actor
 * @param {number} n
 * @returns {object}
 */
export function takeBackGoldUpdate(actor, n) {
  const take = wholeOrNull(n) ?? 0;
  const gold = wholeOrNull(actor?.system?.currency?.gold) ?? 0;
  return { [GOLD_PATH]: Math.max(0, gold - take), [LOOTED_PATH]: Math.max(0, lootedGoldOf(actor) - take) };
}
