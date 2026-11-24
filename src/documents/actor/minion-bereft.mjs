/**
 * A minion whose controller died is Bereft: it carries on with its last command (core book p. 233). The book names only the
 * minions not subject to a duration; this system marks every minion of the dead controller (the human's ruling), and the GM
 * may give control back. A whisper tells the GMs which minions were marked and carries the "Give back control" button.
 * Nothing here blocks anything (Directive 2).
 */
import { isActiveGM } from '../../utils/gm-relay.mjs';
import { escapeAttr } from '../../utils/escape-attr.mjs';
import { confirmRuleBreak } from '../../utils/rule-break.mjs';
import { resolveActorByUuid } from '../../utils/actor-uuid.mjs';
import { isDeadDebuff, isDead } from './dying.mjs';
import { sweepActors } from './duration-expiry.mjs';
import { gmWhisper } from '../../utils/owner-recipients.mjs';
import { appliedByOf } from '../../utils/effects/applied-buff.mjs';
import { minionBuffOf } from './minion-buff.mjs';
import { markBereftMinion, isBereftMinionBuff, clearBereftMinion } from './minion-orders.mjs';

/** The chat action of the whisper card's button. */
const GIVE_BACK_CONTROL_ACTION = 'crawlerGiveBackControl';

/** The minions of a controller: actors whose minion buff names it as caster. */
function minionsOf(controller) {
  return sweepActors().filter((actor) => {
    const buff = minionBuffOf(actor);
    return buff && appliedByOf(buff)?.casterUuid === controller.uuid;
  });
}

function bereftCard(controller, minions) {
  const names = minions.map((m) => escapeAttr(m.name || 'A minion')).join(', ');
  const uuids = minions.map((m) => m.uuid).join(',');
  return `<div class="cog-chat-card cog-minion-bereft"><p>${escapeAttr(controller.name || 'A controller')} has died. Bereft, carrying on with their last command: ${names}.</p>`
    + `<button type="button" class="cog-apply-damage-btn" data-action="${GIVE_BACK_CONTROL_ACTION}" data-controller-uuid="${escapeAttr(controller.uuid)}" data-minion-uuids="${escapeAttr(uuids)}">Give back control</button></div>`;
}

/** Mark every minion of a dead controller Bereft and whisper the GMs the ones newly marked. */
async function bereaveMinions(controller) {
  const marked = [];
  for (const actor of minionsOf(controller)) {
    const buff = minionBuffOf(actor);
    if (isBereftMinionBuff(buff)) continue;
    await markBereftMinion(buff);
    marked.push(actor);
  }
  if (!marked.length) return null;
  return globalThis.ChatMessage?.create?.({ content: bereftCard(controller, marked), whisper: gmWhisper() }) ?? null;
}

/**
 * The `createItem` hook body: a Dead debuff landing on an actor (by `die()` or by the GM's hand) bereaves its minions.
 * Runs on the active GM's client only.
 * @param {Item} item
 */
export async function onDeadDebuffCreated(item) {
  if (item?.type !== 'debuff' || !isDeadDebuff(item) || !item.parent || !isActiveGM()) return null;
  return bereaveMinions(item.parent);
}

/**
 * The GM's "Give back control": clears the Bereft mark on the named minions of a controller. A controller still Dead asks
 * a Rule Break first (Directive 2). Returns the minions that were freed, or null when declined or not a GM.
 * @param {string} controllerUuid
 * @param {string[]} minionUuids
 * @returns {Promise<Actor[]|null>}
 */
export async function giveBackControl(controllerUuid, minionUuids) {
  if (!globalThis.game?.user?.isGM) return null;
  const controller = resolveActorByUuid(controllerUuid);
  if (!controller) return null;
  if (isDead(controller)) {
    const ask = await confirmRuleBreak({
      message: `${controller.name} is still Dead. Give control of the minions back anyway as a Rule Break?`,
      reason: `${controller.name} is still Dead.`
    });
    if (!ask.confirmed) return null;
  }
  const freed = [];
  for (const uuid of minionUuids) {
    const actor = resolveActorByUuid(uuid);
    const buff = actor ? minionBuffOf(actor) : null;
    if (!buff || !isBereftMinionBuff(buff) || appliedByOf(buff)?.casterUuid !== controller.uuid) continue;
    await clearBereftMinion(buff);
    freed.push(actor);
  }
  return freed;
}
