/**
 * The Command control of the combat tracker (core book p. 233): commanding a minion costs its controller one Action, and one
 * command reaches one minion or all of the controller's minions in the fight. The command lasts the combat (see
 * `minion-orders.mjs`); new orders cost another Action. Over budget asks the ledger's Rule Break (Directive 2).
 *
 * A split creature (its minion buff carries `command-check`, core p. 203) is commanded one at a time: its controller's Action
 * and an Unopposed handling check, settled by the GM from the card (`settleCommandCheck`).
 */
import { combatantOfActor } from '../combat/combatants.mjs';
import { promptChoicePicks } from '../../utils/ui/choice-picker.mjs';
import { RULE_FLAGS, hasRuleFlag } from '../../utils/tag/tag-behaviour.mjs';
import { commandedMinionUuids, minionState, saveCommandedMinions } from './minion-orders.mjs';
import { rollCommandCheck } from './pet-checks.mjs';

const SCOPE_ONE = 'one';
const SCOPE_ALL = 'all';

/**
 * Command a minion on its controller's Action.
 * @param {Combat} combat
 * @param {Combatant} minionCombatant
 * @param {{ round?: number|null }} [options] the round the tracker shows
 * @returns {Promise<{ commanded?: string[], message?: object, ruleBreak: boolean }|null|undefined>} `message` is the check card of a
 *   split creature (it commands nothing until the GM settles it); undefined when nothing can be commanded,
 *   null when the user closed the pick or declined the over-budget confirm
 */
export async function commandMinion(combat, minionCombatant, { round = null } = {}) {
  const minion = minionCombatant?.actor;
  const here = minion ? minionState(combat, minion) : null;
  if (!here?.controller || here.state === 'bereft' || here.state === 'self-directed') return undefined;
  const controller = here.controller;
  const controllerCombatant = combatantOfActor(combat, controller);
  if (!controllerCombatant) {
    globalThis.ui?.notifications?.warn?.(`${controller.name || 'The controller'}, who commands ${minion.name || 'this minion'}, is not in this combat.`);
    return undefined;
  }

  const checked = hasRuleFlag(here.buff, RULE_FLAGS.commandCheck);
  if (checked) return commandWithCheck(combat, minion, controller, controllerCombatant, round);

  const others = Array.from(combat.combatants ?? []).map((c) => c.actor).filter((actor) => {
    if (!actor || actor.uuid === minion.uuid) return false;
    const state = minionState(combat, actor);
    return state?.state === 'uncommanded' && state.controller?.uuid === controller.uuid && !hasRuleFlag(state.buff, RULE_FLAGS.commandCheck);
  });
  let picked = [minion];
  if (others.length) {
    const picks = await promptChoicePicks({
      title: 'Command',
      entries: [{
        key: 'scope',
        label: 'Command',
        candidates: [
          { value: SCOPE_ONE, label: `${minion.name} only` },
          { value: SCOPE_ALL, label: `All ${others.length + 1} of ${controller.name}'s minions here` }
        ]
      }]
    });
    if (!picks?.scope) return null;
    if (picks.scope === SCOPE_ALL) picked = [minion, ...others];
  }

  const label = `Command ${picked.map((a) => a.name || 'minion').join(', ')}`;
  const recorded = await combat.recordCombatantAction(controllerCombatant, { type: 'other', label }, { round });
  if (!recorded?.success) return null;
  const commanded = [...new Set([...commandedMinionUuids(controllerCombatant), ...picked.map((a) => a.uuid)])];
  await saveCommandedMinions(controllerCombatant, commanded);
  return { commanded: picked.map((a) => a.uuid), ruleBreak: recorded.ruleBreak === true };
}

/** A split creature: record the controller's Action, then roll the check; the GM's ingest writes the command. */
async function commandWithCheck(combat, minion, controller, controllerCombatant, round) {
  const copies = Array.from(combat.combatants ?? []).filter((c) => c.actor?.uuid === minion.uuid);
  if (copies.length > 1) {
    globalThis.ui?.notifications?.warn?.(`The copies of ${minion.name || 'this creature'} share one actor: unlink their tokens so each takes its own command.`);
  }
  const recorded = await combat.recordCombatantAction(controllerCombatant, { type: 'check', label: `Command check: ${minion.name || 'minion'}` }, { round });
  if (!recorded?.success) return null;
  const ruleBreak = recorded.ruleBreak === true;
  const message = await rollCommandCheck(minion, controller, { ruleBreak, actionBlockChecked: true });
  return { message, ruleBreak };
}
