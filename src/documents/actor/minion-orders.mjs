/**
 * A minion waits for its controller's command (core book p. 233). A minion is a creature holding an in-force buff tagged
 * `mob.minion`; the buff's caster (`appliedBy.casterUuid`) is its controller. A command lasts the combat (a fight is a
 * scene) and is kept on the controller's combatant as the uuids of the minions it commanded. A minion whose controller died
 * and that has no duration is Bereft: it carries on with its last command, so the gate leaves it alone.
 *
 * Read by the action gate, so this module must not import the gate, `dying.mjs`, `dungeon-time.mjs`, `item-buffs.mjs`,
 * `minion-command.mjs` or `pet-checks.mjs` (each leads back to it). Nothing here blocks anything (Directive 2).
 */
import { readFlag, writeFlag, clearFlag } from '../../utils/flags.mjs';
import { resolveActorByUuid } from '../../utils/actor-uuid.mjs';
import { RULE_FLAGS, hasRuleFlag } from '../../utils/tag/tag-behaviour.mjs';
import { appliedByOf } from '../../utils/effects/applied-buff.mjs';
import { minionBuffOf } from './minion-buff.mjs';
import { activeCombatFor, combatantOfActor } from '../combat/combatants.mjs';
import { minionOrderCauses, commandsAfterCheck } from '../../data/rules/minion-rules.mjs';
import { PET_GUIDANCE } from '../../data/rules/pet-rules.mjs';
import { isSuccessOutcome } from '../../utils/roll/check-assists.mjs';
import { guidanceRecordOf } from './pet-guidance.mjs';

/** The combatant flag that holds the uuids of the minions its owner commanded this combat. */
const COMMANDS_FLAG = 'minionCommands';
/** The buff flag that marks a minion whose controller died. */
const BEREFT_FLAG = 'minionBereft';

/** The controller of a minion: the actor that cast its minion buff, or null. */
export function minionControllerOf(actor) {
  const caster = appliedByOf(minionBuffOf(actor))?.casterUuid;
  return caster ? resolveActorByUuid(caster) : null;
}

/** The minions a combatant commanded this combat, as a clean array of uuid strings (bad stored data reads as none). */
export function commandedMinionUuids(combatant) {
  const raw = readFlag(combatant, COMMANDS_FLAG);
  return Array.isArray(raw) ? raw.filter((u) => typeof u === 'string' && u !== '') : [];
}

/** Store the minions a combatant has commanded. */
export function saveCommandedMinions(combatant, uuids) {
  return writeFlag(combatant, COMMANDS_FLAG, [...new Set((Array.isArray(uuids) ? uuids : []).filter((u) => typeof u === 'string' && u !== ''))]);
}

/** Mark a minion buff Bereft. */
export function markBereftMinion(buff) {
  return writeFlag(buff, BEREFT_FLAG, true);
}

/** Whether a minion buff is marked Bereft. */
export function isBereftMinionBuff(buff) {
  return readFlag(buff, BEREFT_FLAG) === true;
}

/** Take the Bereft mark off a minion buff (its controller has control again). */
export function clearBereftMinion(buff) {
  return clearFlag(buff, BEREFT_FLAG);
}

/**
 * Where a minion stands in a combat, or null when the actor is no minion.
 * @param {Combat} combat
 * @param {Actor} actor
 * @returns {{ state: 'bereft'|'self-directed'|'commanded'|'uncommanded', controller: Actor|null, buff: Item }|null}
 */
export function minionState(combat, actor) {
  const buff = minionBuffOf(actor);
  if (!buff) return null;
  const controller = minionControllerOf(actor);
  let state = 'uncommanded';
  if (isBereftMinionBuff(buff)) state = 'bereft';
  else if (hasRuleFlag(actor, RULE_FLAGS.selfDirected)) state = 'self-directed';
  else if (Array.from(combat?.combatants ?? []).some((c) => commandedMinionUuids(c).includes(actor.uuid)) || carriedGuidance(combat, actor, buff)) state = 'commanded';
  return { state, controller, buff };
}

/**
 * A split pet that was Guided or Frenzied this combat keeps that as its command (core pp. 203, 232, 233): its guidance
 * record is read although the guidance rule no longer governs it.
 */
function carriedGuidance(combat, actor, buff) {
  if (!hasRuleFlag(buff, RULE_FLAGS.commandCheck) || actor.type !== 'pet') return false;
  const combatant = combatantOfActor(combat, actor);
  if (!combatant) return false;
  const guided = guidanceRecordOf(combatant).state;
  return guided === PET_GUIDANCE.limited.id || guided === PET_GUIDANCE.free.id;
}

/**
 * The uuids a Success on this creature's command check commands: itself, or, with `command-together`, every creature of the
 * combat whose minion buff came from the same cast (same caster, card and identifier) and carries it too.
 * @param {Combat} combat
 * @param {Actor} actor
 * @returns {string[]}
 */
function splitGroupOf(combat, actor) {
  const buff = minionBuffOf(actor);
  if (!buff || !hasRuleFlag(buff, RULE_FLAGS.commandTogether)) return [actor.uuid];
  const sameCast = (other) => {
    const a = appliedByOf(buff);
    const b = appliedByOf(other);
    return a?.casterUuid === b?.casterUuid && (a?.messageId ?? '') === (b?.messageId ?? '') && buff.system?.identifier === other.system?.identifier;
  };
  const group = new Set([actor.uuid]);
  for (const combatant of Array.from(combat?.combatants ?? [])) {
    const other = combatant.actor;
    const otherBuff = other ? minionBuffOf(other) : null;
    if (otherBuff && hasRuleFlag(otherBuff, RULE_FLAGS.commandTogether) && sameCast(otherBuff)) group.add(other.uuid);
  }
  return [...group];
}

/**
 * Settle a command check card into the controller's commanded list (the active GM; the caller holds the controller's
 * command queue). A Success commands the creature (and, from Rank 15, its copies); a Fail gives no new command and takes back
 * only what this card added.
 * @param {Actor} minion
 * @param {{ outcome: string, prior?: { command?: { added?: string[] } } }} p
 * @returns {Promise<{ skipped: string }|{ changed: boolean, commanded: string[], added: string[], group: string[] }>}
 */
export async function settleCommandCheck(minion, { outcome, prior } = {}) {
  const combat = globalThis.game?.combat;
  const here = minion ? minionState(combat, minion) : null;
  if (!here || here.state === 'bereft' || here.state === 'self-directed') return { skipped: 'minion' };
  const controllerCombatant = combatantOfActor(combat, here.controller);
  if (!controllerCombatant) return { skipped: 'controller' };
  const before = commandedMinionUuids(controllerCombatant);
  const group = splitGroupOf(combat, minion);
  const settled = commandsAfterCheck({ list: before, group, added: Array.isArray(prior?.command?.added) ? prior.command.added : [], success: isSuccessOutcome(outcome) });
  const changed = settled.list.length !== before.length || settled.list.some((uuid, i) => uuid !== before[i]);
  if (changed) await saveCommandedMinions(controllerCombatant, settled.list);
  return { changed, commanded: settled.list, added: settled.added, group };
}

/**
 * The Rule Break reasons for this actor taking an Action: empty unless it is a minion in a running combat. Every Action
 * type counts; `actionType` is taken for the shape of the pet guidance causes it sits beside.
 * @param {Actor} actor
 * @param {string} _actionType a `COG_ACTION_TYPES` id
 * @returns {string[]}
 */
export function minionOrderCausesFor(actor, _actionType) {
  if (!activeCombatFor(actor)) return [];
  const combat = globalThis.game.combat;
  if (!combatantOfActor(combat, actor)) return [];
  const here = minionState(combat, actor);
  if (!here) return [];
  return minionOrderCauses({ commanded: here.state === 'commanded', selfDirected: here.state === 'self-directed', bereft: here.state === 'bereft' });
}
