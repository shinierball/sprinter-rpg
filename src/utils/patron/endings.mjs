/**
 * How a patronage ends (core rulebook p. 316): the termination fee a quit patron is owed, and the ban a Bard earns by
 * killing their own patron. Pure: it reads patronage blocks through `patronage-state.mjs`.
 */
import { patronageItems, patronageOf } from './patronage-state.mjs';

/** A patron who quits is owed half of what they earned from the Bard (p. 316). */
export const TERMINATION_FEE_PERCENT = 50;

/**
 * The fee owed to the showrunners when a patron quits: half of what the patron earned, rounded down.
 * @param {number} earned gold this patron has had from the Bard
 */
export function terminationFee(earned) {
  const gold = Math.max(0, Math.trunc(Number(earned) || 0));
  return Math.floor((gold * TERMINATION_FEE_PERCENT) / 100);
}

/**
 * What killing a patron costs. A former patron or god whose patronage `endedBy` is `murdered` bans a new patron on the
 * Floor it happened (`endedFloor`), and the next audition starts Opposed for good; deleting that former item clears it.
 * @param {Iterable<object>} items the crawler's items
 * @param {number} floor the crawler's current Floor
 * @returns {{ bannedThisFloor: boolean, startOpposed: boolean }}
 */
export function murderBan(items, floor) {
  const murdered = patronageItems(items).map(patronageOf).filter((p) => p.endedBy === 'murdered');
  return {
    bannedThisFloor: murdered.some((p) => p.endedFloor === floor),
    startOpposed: murdered.length > 0
  };
}
