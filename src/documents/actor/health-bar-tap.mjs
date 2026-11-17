/**
 * Set Health by tapping one of the play sheet's Health bars: a tap on a bar that holds Health empties it and every bar
 * above it; a tap on an empty bar fills Health up to and including it. No Damage Resistance, no damage type.
 * A loss is a plain `actor.update`, so temp bars, Dying and the end of Dying behave as for any other Health write; a
 * gain takes the chat card's own healing path (`applyHealingTo`: capped at Max Health, the "cannot be healed" Rule
 * Break, `until_healed` debuffs).
 */
import { applyHealingTo } from '../../chat/actions/restore.mjs';
import { getHpPerBar } from '../combat-metrics.mjs';
import { firstScalar } from '../../utils/first-scalar.mjs';

/** The Health a tap on bar `bar` (1 = the first) leaves, from the Health now, Max Health and the Health one bar holds. */
function healthAfterBarTap({ value, max, hpPerBar }, bar) {
  const n = Math.floor(Number(firstScalar(bar, 0)));
  if (!(n >= 1) || !(hpPerBar > 0)) return value;
  const below = (n - 1) * hpPerBar;
  if (value > below) return below;
  return Math.min(max, n * hpPerBar);
}

/** Tap Health bar `bar` on `actor`. @returns {Promise<number>} the Health now */
export async function tapHealthBar(actor, bar) {
  const hp = actor.system?.attributes?.hp;
  const value = Number(hp?.value) || 0;
  const next = healthAfterBarTap({ value, max: Number(hp?.max) || 0, hpPerBar: Number(getHpPerBar(actor)) || 0 }, bar);
  if (next < value) await actor.update({ 'system.attributes.hp.value': next });
  else if (next > value) await applyHealingTo(actor, { bars: 0, flatHealing: next - value });
  return Number(actor.system?.attributes?.hp?.value) || 0;
}
