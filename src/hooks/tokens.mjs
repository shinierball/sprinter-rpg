/**
 * Token placement hooks: crawler, pet, mercenary and mount tokens are placed linked to their actor, and mob tokens
 * are placed unlinked with a numbered name.
 */

import { LINKED_ACTOR_TYPES } from '../utils/document-types.mjs';
import { numberMobToken } from '../utils/token/mob-token-name.mjs';
import { relinkCharacterTokens } from '../documents/actor/token-link.mjs';

/**
 * Link the token of a crawler, pet, mercenary or mount (`LINKED_ACTOR_TYPES`) to its actor,
 * and place a mob's token unlinked with a sequential name.
 */
function onPreCreateToken(tokenDoc, createData, options, userId) {
  const actor = tokenDoc.actor || game.actors?.get(tokenDoc.actorId);
  if (actor && LINKED_ACTOR_TYPES.includes(actor.type)) {
    tokenDoc.updateSource({ actorLink: true });
  } else if (actor && actor.type === 'mob') {
    const updates = { actorLink: false };

    // Sequential unique naming upon placement or pasting onto a scene:
    // "Goblin" -> "Goblin 1", "Goblin 2", etc.
    // If copying/pasting "Goblin 2", base name is extracted as "Goblin" and increments to "Goblin 3".
    const rawName = tokenDoc.name || actor.name || 'Mob';
    const scene = tokenDoc.parent || canvas?.scene;
    const sceneNames = [];
    for (const t of scene?.tokens ?? []) {
      if (t.id && t.id === tokenDoc.id) continue;
      sceneNames.push(t.name);
    }
    // `options` is the one operation every token of a batch shares, so each counts the ones before it.
    updates.name = numberMobToken(rawName, sceneNames, options);
    tokenDoc.updateSource(updates);
  }
}

/**
 * A scene was created (an import, an adventure, a module): the active GM links any crawler, pet or mercenary token that
 * arrived unlinked inside it.
 * @param {Scene} scene
 */
async function onCreateSceneRelink(scene) {
  if (scene?.pack) return [];
  try {
    return await relinkCharacterTokens([scene]);
  } catch (err) {
    console.warn('Sprinter RPG | Token relink of a created scene failed:', err);
    return [];
  }
}

/** On `ready` the active GM does the same for every scene the world already holds. */
export async function relinkAtReady() {
  return relinkCharacterTokens();
}

export function registerTokenHooks() {
  Hooks.on('preCreateToken', onPreCreateToken);
  Hooks.on('createScene', onCreateSceneRelink);
}
