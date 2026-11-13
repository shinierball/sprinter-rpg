/**
 * Debuffs that end on a roll or an Action rather than a clock: "your next Check" (`next_check`), "the next Action you
 * take" (`next_action`), and the lost Action of Shocked (flag `forfeits-action`).
 *
 * - A d20 roll ends the roller's `next_check` debuffs, and their `next_action` debuffs too unless the roll was free of an
 *   Action (a free or already covered Evade, an automatic resist check): `settleAfterCheck`.
 * - A ledger slot of a kind that involves no roll ends `next_action` at once: `settleAfterAction`.
 * - Clean Up ends a `next_action` debuff whose bearer has a slot stamped after the debuff landed, so ticking the pip
 *   first never loses the Disadvantage before the roll it belongs to: `settleNextActionsAtCleanUp`.
 * - A debuff with the forfeit flag spends one Action when it can (a "Forfeited" slot) and ends: `settleForfeits`.
 *   It is not ended by rolls or slots, which are not the Action it takes.
 *
 * Ending is `item.delete()` by the client that rolled or wrote the slot (owner or GM), and by the GM at Clean Up.
 * Imports no chat or sheet code, so the ledger and the session engine can import it.
 */
import { SYSTEM_ID } from '../../constants.mjs';
import { RULE_FLAGS, hasRuleFlag } from '../../utils/tag/tag-behaviour.mjs';
import { NEXT_CHECK_UNIT, NEXT_ACTION_UNIT } from '../../utils/time/timing.mjs';
import { durationSpec } from '../../utils/time/durations.mjs';
import { combatantOfActor } from '../combat/combatants.mjs';

/** Ledger types that end `next_action` by their own roll; every other type ends it when the slot is recorded. */
const ROLL_ENDED_TYPES = Object.freeze(['attack', 'cast', 'check', 'evade', 'heal', 'taunt', 'catcher', 'intervene']);

/** The ledger label and type of the slot a forfeit records. */
const FORFEIT_SLOT = Object.freeze({ type: 'other', label: 'Forfeited', forfeited: true });

const asArray = (list) => (Array.isArray(list) ? list : Array.from(list?.values?.() ?? list ?? []));

/** The actor's debuffs whose duration unit is `unit` and which do not forfeit an Action (Shocked has its own ending). */
function debuffsEndingAt(actor, unit) {
  return asArray(actor?.items).filter(item => item?.type === 'debuff'
    && durationSpec(item.system?.durationConfig).unit === unit
    && !hasRuleFlag(item, RULE_FLAGS.forfeitsAction));
}

/** Delete the debuff; one a relayed write already removed is not an error. */
async function end(item) {
  try {
    await item.delete();
    return true;
  } catch (err) {
    console.warn(`Sprinter RPG | Could not end the debuff "${item?.name}":`, err);
    return false;
  }
}

async function endAll(items) {
  const ended = [];
  for (const item of items) if (await end(item)) ended.push(item);
  return ended;
}

/**
 * A d20 roll was made: end the roller's `next_check` debuffs, and `next_action` ones when the roll spent an Action.
 * The list is read before the first await, so a debuff the roll's own result lands afterwards is not ended by it.
 * @param {Actor} actor
 * @param {{ spendsAction?: boolean }} [opts] false for a roll that costs no Action (a free Evade, an automatic check)
 * @returns {Promise<Item[]>} the debuffs ended
 */
export async function settleAfterCheck(actor, { spendsAction = true } = {}) {
  if (!actor) return [];
  const ending = [...debuffsEndingAt(actor, NEXT_CHECK_UNIT), ...(spendsAction ? debuffsEndingAt(actor, NEXT_ACTION_UNIT) : [])];
  return endAll(ending);
}

/** The Action the actor took needs no roll to end `next_action` debuffs. @returns {Promise<Item[]>} the debuffs ended */
export async function settleAfterAction(actor) {
  if (!actor) return [];
  return endAll(debuffsEndingAt(actor, NEXT_ACTION_UNIT));
}

/** True when a ledger slot of this type is ended by its roll, not by being recorded. */
export const endsByRoll = (type) => ROLL_ENDED_TYPES.includes(type);

/**
 * Clean Up: end each combatant's `next_action` debuffs that have a ledger slot stamped after they landed. A debuff with no
 * `landedAt` stamp (not made by `applyCondition`) is left to the roll and the slot. A forfeited slot is not an Action taken.
 * @param {Combat} combat
 * @returns {Promise<Item[]>} the debuffs ended
 */
export async function settleNextActionsAtCleanUp(combat) {
  const ended = [];
  for (const combatant of asArray(combat?.combatants)) {
    const actor = combatant.actor ?? globalThis.game?.actors?.get?.(combatant.actorId);
    const slots = (combat.getCombatantActions?.(combatant)?.slots ?? []).filter(slot => slot && !slot.forfeited);
    if (!slots.length) continue;
    for (const item of debuffsEndingAt(actor, NEXT_ACTION_UNIT)) {
      const landedAt = Number(item.flags?.[SYSTEM_ID]?.landedAt);
      if (!Number.isFinite(landedAt) || !slots.some(slot => Number(slot.timestamp) > landedAt)) continue;
      if (await end(item)) ended.push(item);
    }
  }
  return ended;
}

/**
 * Shocked: each forfeit debuff on the combatant, while it has an Action left this round, records a "Forfeited" slot
 * and ends. With none left it stays (the next round's reset calls this again). A slot the ledger declines keeps the debuff.
 * @param {Combat} combat
 * @param {Combatant} combatant
 * @returns {Promise<Item[]>} the debuffs ended
 */
export async function settleForfeits(combat, combatant) {
  const actor = combatant?.actor ?? globalThis.game?.actors?.get?.(combatant?.actorId);
  const forfeits = asArray(actor?.items).filter(item => item?.type === 'debuff' && hasRuleFlag(item, RULE_FLAGS.forfeitsAction));
  const ended = [];
  for (const item of forfeits) {
    const actions = combat.getCombatantActions(combatant);
    if (!(actions.spent < actions.max)) break;
    const res = await combat.recordCombatantAction(combatant, { ...FORFEIT_SLOT }, { ruleBreak: false, interactive: false, actionBlockChecked: true });
    if (!res?.success) break;
    if (await end(item)) ended.push(item);
  }
  return ended;
}

/**
 * A debuff just landed: when its bearer is a combatant of the running combat, settle its forfeits now.
 * @param {Actor} actor
 * @returns {Promise<Item[]>} the debuffs ended
 */
export async function settleForfeitsOf(actor) {
  const combat = globalThis.game?.combat;
  if (!combat || !(Number(combat.round) >= 1) || typeof combat.recordCombatantAction !== 'function') return [];
  const combatant = combatantOfActor(combat, actor);
  return combatant ? settleForfeits(combat, combatant) : [];
}
