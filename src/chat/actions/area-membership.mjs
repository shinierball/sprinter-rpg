/**
 * Template membership feeds targets (E2.2). A card's "Place Area of Effect" button stamps the card's message id on
 * every Region it creates (`flags[SYSTEM_ID].area.messageId`, set by `handlePlaceTemplate`). When "Apply to targets"
 * runs on that card, or on a damage card whose `sourceMessageId` names it, and the user has no targets of their own,
 * the targets are the tokens inside those Regions at that moment (Foundry's own `testInsideRegion`, so a token that
 * moved in after placement counts). The area is placed on the caster and dragged afterwards, hence apply time.
 */
import { SYSTEM_ID } from '../../constants.mjs';
import { resolveAreaGeometry } from '../../utils/area-geometry.mjs';
import { findAreaRegions, tokensInRegion } from '../../utils/region-shapes.mjs';
import { auraRank } from '../../documents/actor/aura-effects.mjs';

/**
 * The tokens inside the Regions linked to a card, on the viewed scene. Empty without a linked or surviving Region.
 * A caster-anchored area leaves the caster out unless the item is meant for allies (the placement-time rule).
 * @param {{ messageIds: Array<string|null|undefined> }} link the card's own message id and its `sourceMessageId`
 * @returns {Token[]} token placeables
 */
export function tokensInLinkedArea({ messageIds = [] } = {}) {
  const scene = globalThis.canvas?.scene;
  const ids = new Set(messageIds.filter(id => typeof id === 'string' && id));
  if (!scene || !ids.size) return [];
  const regions = findAreaRegions(scene).filter(r => ids.has(r.flags?.[SYSTEM_ID]?.area?.messageId));
  const inside = new Map();
  for (const region of regions) {
    const flags = region.flags[SYSTEM_ID].area;
    const item = flags.sourceItemUuid ? globalThis.fromUuidSync?.(flags.sourceItemUuid) : null;
    const geometry = item ? resolveAreaGeometry(item, { rank: auraRank(item.parent, item) }) : null;
    const skipCaster = geometry?.anchor === 'caster' && geometry.targetFilter !== 'allies';
    for (const doc of tokensInRegion(region)) {
      if (skipCaster && flags.casterUuid && doc.actor?.uuid === flags.casterUuid) continue;
      inside.set(doc.id, doc);
    }
  }
  return [...inside.values()].map(doc => doc.object).filter(Boolean);
}

/**
 * The linked-area tokens for a chat card button: the card's message and the message it answers.
 * @param {ChatMessage|null} message
 * @param {HTMLElement|null} card the damage or spell card element (`data-source-message-id`)
 */
export function tokensInCardArea(message, card) {
  return tokensInLinkedArea({ messageIds: [message?.id, card?.dataset?.sourceMessageId] });
}
