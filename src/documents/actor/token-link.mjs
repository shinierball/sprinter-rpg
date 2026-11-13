import { isOneCharacterActor } from '../../utils/document-types.mjs';
import { isActiveGM } from '../../utils/gm-relay.mjs';

/**
 * The one link rule: a crawler, pet or mercenary token is linked to its actor, so a token that would be
 * unlinked and whose actor is one-character must be linked.
 * @param {Actor|null|undefined} actor the actor the token will have
 * @param {boolean|undefined} actorLink whether the token will be linked (`undefined` counts as linked)
 * @returns {boolean}
 */
export function tokenMustBeLinked(actor, actorLink) {
  return isOneCharacterActor(actor) && actorLink === false;
}

/**
 * The active GM links every crawler, pet or mercenary token of the given scenes that is unlinked, and says what it did.
 * @param {Iterable<Scene>} [scenes] defaults to every world scene
 * @returns {Promise<{ scene: string, token: string, name: string }[]>} the tokens it relinked
 */
export async function relinkCharacterTokens(scenes = globalThis.game?.scenes ?? []) {
  if (!isActiveGM()) return [];
  const relinked = [];
  for (const scene of scenes) {
    const updates = [];
    for (const token of scene?.tokens ?? []) {
      // Linked tokens are skipped before `token.actor` is read: for an unlinked one Foundry builds a synthetic actor.
      if (token.actorLink !== false) continue;
      const actor = globalThis.game?.actors?.get?.(token.actorId) ?? token.actor;
      if (!tokenMustBeLinked(actor, token.actorLink)) continue;
      updates.push({ _id: token.id, actorLink: true });
      relinked.push({ scene: scene.id, token: token.id, name: token.name ?? actor.name });
    }
    if (updates.length) await scene.updateEmbeddedDocuments('Token', updates);
  }
  if (relinked.length) {
    globalThis.ui?.notifications?.info(`Sprinter RPG | Linked ${relinked.length} crawler, pet or mercenary token(s) that arrived unlinked: ${relinked.map((r) => r.name).join(', ')}.`);
  }
  return relinked;
}
