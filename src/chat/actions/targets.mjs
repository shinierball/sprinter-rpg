import { findTokenByActorUuid, resolveActorByUuid } from '../../utils/actor-uuid.mjs';

/**
 * Targets for a chat-card effect: the user's targets, else the token whose actor has `targetUuid`,
 * else controlled tokens with an actor, else the actor `targetUuid` (world or token actor).
 * @param {string} [targetUuid] actor UUID from the card's data-target-uuid
 * @returns {Actor[]}
 */
export function resolveTargetActors(targetUuid) {
  let targetTokens = Array.from(game.user?.targets || []);
  if (!targetTokens.length && targetUuid && canvas?.tokens?.placeables) {
    const found = findTokenByActorUuid(canvas.tokens.placeables, targetUuid);
    if (found) targetTokens = [found];
  }
  if (!targetTokens.length && canvas?.tokens?.controlled) {
    targetTokens = canvas.tokens.controlled.filter(t => t.actor);
  }
  let targetActors = targetTokens.map(t => t.actor).filter(Boolean);
  if (!targetActors.length && targetUuid) {
    const directActor = resolveActorByUuid(targetUuid);
    if (directActor) targetActors = [directActor];
  }
  return targetActors;
}
