/**
 * Set Health by tapping one of the play sheet's Health bars: a tap on a bar that holds Health empties it and every bar
 * above it; a tap on an empty bar fills Health up to and including it. No Damage Resistance, no damage type.
 * A tap down is the Health write of any edit, not a set: the actor's temp bars (`_absorbDamageIntoTempBars`) take the
 * loss first and only whole Health bars of the rest reach Health, so with temp bars a tap can leave more Health than
 * the bar it hit (page 0 draws them for that reason). Dying and the end of Dying behave as for any other Health write;
 * a gain takes the chat card's own healing path (`applyHealingTo`: capped at Max Health, the "cannot be healed" Rule
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

/** The Health now, Max Health and the Health one bar holds, for a tap. */
const hpFacts = (actor) => {
  const hp = actor.system?.attributes?.hp;
  return { value: Number(hp?.value) || 0, max: Number(hp?.max) || 0, hpPerBar: Number(getHpPerBar(actor)) || 0 };
};

/**
 * The Health a tap on `bar` would leave, after the temp bars have taken their share of a loss: the actor's own absorption
 * step is run on a scratch change, so nothing is written and no second copy of the rule exists.
 * @returns {number}
 */
export function healthAfterTap(actor, bar) {
  const facts = hpFacts(actor);
  const next = healthAfterBarTap(facts, bar);
  if (!(next < facts.value)) return next;
  const changes = { 'system.attributes.hp.value': next };
  actor._absorbDamageIntoTempBars?.(changes, {});
  return Number(changes['system.attributes.hp.value']);
}

/** Tap Health bar `bar` on `actor`. @returns {Promise<number>} the Health now */
export async function tapHealthBar(actor, bar) {
  const facts = hpFacts(actor);
  const { value } = facts;
  const next = healthAfterBarTap(facts, bar);
  if (next < value) await actor.update({ 'system.attributes.hp.value': next });
  else if (next > value) await applyHealingTo(actor, { bars: 0, flatHealing: next - value });
  return Number(actor.system?.attributes?.hp?.value) || 0;
}
