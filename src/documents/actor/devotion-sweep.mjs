/**
 * The devotion day sweep: when the world clock crosses into a new 30-hour day, each worshipped god's missed offerings
 * are counted (core rulebook p. 163). One missed day lapses the bond (the 7.44c predicate then withholds its gifts) and
 * ends the streak; two make a Divine Debuff due and three make Fallen from Grace due, both only as one GM whisper listing
 * every change. Nothing is applied automatically. Active GM only; only the `day` tracking mode sweeps.
 */
import { isActiveGM } from '../../utils/gm-relay.mjs';
import { dayIndex } from '../../utils/time/timing.mjs';
import { bondOf, isWorshipBond } from '../../utils/deity/worship-state.mjs';
import { WORSHIP_TRACKING, sweepPatch } from '../../utils/deity/devotion.mjs';
import { postWorshipNotice } from '../../chat/worship-card.mjs';
import { sweepActors } from './duration-expiry.mjs';
import { worshipTrackingMode } from './devotion.mjs';
import { writeBond } from './worship.mjs';

/**
 * Count the missed offerings of every worshipper at world time `now`.
 * @param {number} now world seconds
 * @param {number} [previous] the world time before the change; a change inside one day sweeps nothing
 * @returns {Promise<object[]>} the notice entries (`{ actor, deity, notice, missedDays }`)
 */
async function sweepDevotion(now, previous) {
  if (worshipTrackingMode() !== WORSHIP_TRACKING.day) return [];
  const today = dayIndex(now);
  if (previous !== undefined && dayIndex(previous) === today) return [];
  const entries = [];
  for (const actor of sweepActors()) {
    for (const item of Array.from(actor.items ?? [])) {
      if (!isWorshipBond(item)) continue;
      const required = item.system?.offering?.required !== false;
      const { patch, notice } = sweepPatch(bondOf(item), today, { required });
      if (!Object.keys(patch).length) continue;
      await writeBond(item, patch);
      if (notice) entries.push({ actor, deity: item, notice, missedDays: patch.missedDays });
    }
  }
  if (entries.length) await postWorshipNotice('devotion', { entries });
  return entries;
}

/** Register the world-time sweep (active GM only at run time). Once, from the ready hook. */
export function registerDevotionHooks() {
  globalThis.Hooks?.on?.('updateWorldTime', (worldTime, delta) => {
    if (isActiveGM()) return sweepDevotion(worldTime, worldTime - (Number(delta) || 0));
  });
}
