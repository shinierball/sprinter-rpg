/**
 * The conditions tab's view of an activated buff: its badge ([READY], [ACTIVE: 10m left], [COOLDOWN 12h]) and which of
 * Use and End the owner is offered. A closed window is not "suspended": the badge says READY or COOLDOWN; the suspended
 * badge is for the other reasons (dispel, a lapsed god, a smite, a zero zone), and then no Use is offered.
 */
import { ACTIVATION_RECORD_KEY, activationOf } from '../../utils/effects/activation-window.mjs';
import { isBuffSuppressed } from '../../utils/effects/dispel.mjs';
import { cooldownState } from '../../utils/time/cooldowns.mjs';
import { formatRemaining, formatSeconds } from '../../utils/time/timing.mjs';
import { currentTimeContext } from '../../documents/actor/dungeon-time.mjs';
import { say } from '../../documents/actor/vehicle-drive-common.mjs';

const KEY = 'COG.Activation.Sheet.';

/** What is left of an open window, as the badge says it. */
function leftOf(activation, now) {
  const { unit } = activation.window;
  if (unit === 'combat') return say(`${KEY}LeftCombat`, 'this combat');
  if (unit === 'use' || unit === 'hit') {
    if (activation.usesLeft <= 0) return say(`${KEY}LeftSpent`, 'last use');
    return say(`${KEY}${unit === 'use' ? 'LeftUses' : 'LeftHits'}`, unit === 'use' ? '{n} use(s)' : '{n} hit(s)', { n: activation.usesLeft });
  }
  const seconds = activation.closesAt === null ? 0 : Math.max(0, activation.closesAt - now.time);
  return `${formatSeconds(seconds)} left`;
}

/**
 * @param {Actor} actor
 * @param {Item} item the owned buff
 * @returns {{ canUse: boolean, canEnd: boolean, badge: string }|null} null for a buff that is not activated
 */
export function activationView(actor, item) {
  const activation = activationOf(item);
  if (!activation.enabled) return null;
  const now = currentTimeContext(actor);
  const owner = actor?.isOwner === true;
  if (activation.open) {
    return { canUse: false, canEnd: owner, badge: `[${say(`${KEY}BadgeActive`, 'ACTIVE: {left}', { left: leftOf(activation, now) })}]` };
  }
  const records = Array.isArray(item.system?.useRecords) ? item.system.useRecords : [];
  const state = cooldownState(activation.cooldown, records.find((r) => r?.key === ACTIVATION_RECORD_KEY) ?? null, now);
  const badge = state.ready
    ? say(`${KEY}BadgeReady`, 'READY')
    : say(`${KEY}BadgeCooldown`, 'COOLDOWN {left}', { left: formatRemaining(state).replace(/ remaining$/, '') });
  // A buff withheld for another reason could not take effect, so offering Use would spend the day for nothing
  const withheld = isBuffSuppressed(actor, item, { ignoreWindow: true });
  return { canUse: owner && !withheld, canEnd: false, badge: withheld ? '' : `[${badge}]` };
}
