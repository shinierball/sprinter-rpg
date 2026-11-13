/**
 * What the Dying and Dead debuffs look like to a surface (sheet badge, combat tracker row, HUD). Read-only; the rules
 * live in `dying.mjs`. "Dying" and "Dead" are in-force debuffs carrying `condition.dying` / `condition.dead`, never "HP is 0".
 */
import { debuffInForce } from '../../utils/effects/debuff-force.mjs';
import { conditionTagId } from '../../utils/identifier.mjs';
import { dyingCardText } from './dying-card.mjs';

const DYING_CONDITION = conditionTagId('dying');
const DEAD_CONDITION = conditionTagId('dead');
const carries = (item, tag) => Array.from(item?.allTags ?? []).includes(tag);
const isDyingDebuff = (item) => carries(item, DYING_CONDITION);
const isDeadDebuff = (item) => carries(item, DEAD_CONDITION);

/** `{ dying, remaining, dead }`. Dead wins over Dying: an actor carrying both is Dead. */
export function zeroHealthState(actor) {
  const debuffs = Array.from(actor?.items ?? []).filter((i) => i?.type === 'debuff' && debuffInForce(i));
  const dead = debuffs.some(isDeadDebuff);
  const dyingDebuff = dead ? null : debuffs.find(isDyingDebuff);
  const remaining = dyingDebuff ? Math.max(0, Number(dyingDebuff.system?.durationConfig?.remainingRounds) || 0) : 0;
  return { dying: Boolean(dyingDebuff), remaining, dead };
}

/** The badge a surface prints: `{ dying, remaining, dead, label, title, cssClass }`, or null when the actor is neither Dying nor Dead. */
export function zeroHealthBadge(actor) {
  const state = zeroHealthState(actor);
  if (!state.dying && !state.dead) return null;
  const name = actor?.name ?? '';
  if (state.dead) {
    return { ...state, label: dyingCardText('COG.Dying.DeadBadge'), title: dyingCardText('COG.Dying.Dead', { actor: name }), cssClass: 'cog-badge-dead' };
  }
  return {
    ...state,
    label: dyingCardText('COG.Dying.BadgeRounds', { rounds: state.remaining }),
    title: dyingCardText('COG.Dying.Title', { actor: name, rounds: state.remaining }),
    cssClass: 'cog-badge-dying'
  };
}
