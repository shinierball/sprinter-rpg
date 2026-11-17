/**
 * The flags that time an effect: the round (and combat) a debuff landed in during a Clean Up, the last round whose
 * durations a combat ticked, and when a debuff landed on the ledger's clock. This module owns those words.
 */
import { flagPath, readFlag, withFlags, writeFlag } from '../flags.mjs';

const APPLIED_ROUND = 'appliedRound';
const APPLIED_COMBAT_ID = 'appliedCombatId';
const DURATIONS_TICKED_ROUND = 'durationsTickedRound';
const LANDED_AT = 'landedAt';

/** The last round whose round-timed durations this combat ticked (undefined before the first). */
export const durationsTickedRoundOf = (combat) => readFlag(combat, DURATIONS_TICKED_ROUND);

/** Record that this combat ticked its durations for `round`. */
export const markDurationsTicked = (combat, round) => writeFlag(combat, DURATIONS_TICKED_ROUND, round);

/**
 * Record the round (and combat) a pulse inflicted a debuff in, so the same Clean Up's durations step does not count
 * its first round down. Local write: a document without `setFlag` keeps no mark.
 */
export async function markAppliedRound(doc, { round, combatId }) {
  await writeFlag(doc, APPLIED_ROUND, Number(round) || 0);
  await writeFlag(doc, APPLIED_COMBAT_ID, combatId ?? '');
}

/** Whether the item was stamped as applied in this round of this combat. */
export function appliedInRound(item, round, combatId) {
  return Number(readFlag(item, APPLIED_ROUND)) === Number(round) && readFlag(item, APPLIED_COMBAT_ID) === combatId;
}

/** The update fragment that stamps an item as applied in `round` of `combatId` (the same stamp `markAppliedRound` writes). */
export function appliedRoundUpdate({ round, combatId }) {
  return { [flagPath(APPLIED_ROUND)]: round, [flagPath(APPLIED_COMBAT_ID)]: combatId };
}

/** When the debuff landed, on the clock a ledger slot's `timestamp` uses (undefined for a debuff not made by `applyCondition`). */
export const landedAtOf = (item) => readFlag(item, LANDED_AT);

/** Debuff creation data stamped with the time it landed. */
export const withLandedAt = (data, at) => withFlags(data, { [LANDED_AT]: at });

/** The update fragment that restamps a debuff's landing time. */
export const landedAtUpdate = (at) => ({ [flagPath(LANDED_AT)]: at });
