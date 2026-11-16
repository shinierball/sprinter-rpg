/**
 * "Grant <tier> box" on the party Grind card: a City Boss Map's find (homebrew ruling 1184). Clicked by the GM or by the
 * crawler's owner; a player's click is applied by the GM through the chat relay (the GM writes the box and the card). The
 * box is the generic tier box through `grantLootBoxes`, named for the map. A second click on a granted offer asks a Rule Break.
 */
import { readFlag } from '../../utils/flags.mjs';
import { confirmRuleBreak } from '../../utils/rule-break.mjs';
import { resolveActorByUuid } from '../../utils/actor-uuid.mjs';
import { grantLootBoxes } from '../../documents/actor/achievement-award.mjs';
import { MAP_FINDS_FLAG, grindMapFindText, mapFindOf, updateMapFindCard } from '../../documents/actor/grind-map-find.mjs';
import { applyCardEffect, registerChatApplier } from '../chat-relay.mjs';

const ACTION = 'crawlerGrindMapFind';

/** The button's data; the box tier is checked against the registry when it is applied, never trusted. */
function parseMapFind(button) {
  return {
    targetUuid: button.dataset?.targetUuid,
    actorId: String(button.dataset?.actorId ?? ''),
    itemName: String(button.dataset?.itemName ?? '')
  };
}

/** Grant the box the actor's own maps find and record the offer as taken. The tier is read from the actor, not the button. */
async function grantFind(target, params, { message } = {}) {
  const find = mapFindOf(target);
  if (find) {
    await grantLootBoxes(target, [{ tier: find.boxTier, quantity: 1 }], { sourceName: find.itemName || params.itemName });
  }
  const state = readFlag(message, MAP_FINDS_FLAG);
  if (message && state?.offers) {
    const applied = { ...(state.applied ?? {}), [params.actorId]: { ruleBreak: Boolean(state.applied?.[params.actorId]) } };
    await updateMapFindCard(message, state.offers, applied);
  }
  return { targetUuid: target.uuid, targetName: target.name };
}

registerChatApplier(ACTION, {
  parse: parseMapFind,
  apply: grantFind,
  // a player's click goes to the GM, who writes the box and the card
  canApplyLocally: () => Boolean(globalThis.game?.user?.isGM),
  targetPolicy: 'button'
});

/** @param {Event} event @param {HTMLElement} button @param {ChatMessage} message */
export async function handleGrindMapFind(event, button, message) {
  const params = parseMapFind(button);
  const target = resolveActorByUuid(params.targetUuid);
  const state = readFlag(message, MAP_FINDS_FLAG);
  // only an offer the card lists, for the crawler it names
  const offer = (state?.offers ?? []).find((o) => o.actorId === params.actorId && o.actorUuid === params.targetUuid);
  if (!target || !offer) return;
  if (state.applied?.[params.actorId]) {
    const res = await confirmRuleBreak({
      title: grindMapFindText('COG.GrindMapFind.AlreadyTitle'),
      message: grindMapFindText('COG.GrindMapFind.AlreadyMessage', { name: target.name }),
      reason: grindMapFindText('COG.GrindMapFind.AlreadyReason', { name: target.name })
    });
    if (!res.confirmed) return;
  }
  await applyCardEffect(ACTION, { message, button, params, targets: [target] });
}
