/**
 * Token placement hooks: crawler, pet, mercenary and mount tokens are placed linked to their actor, and mob tokens
 * are placed unlinked with a numbered name.
 */

import { LINKED_ACTOR_TYPES } from '../utils/document-types.mjs';
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
    const baseMatch = rawName.match(/^(.*?)(?:\s+(\d+))?$/);
    const baseName = (baseMatch ? baseMatch[1] : rawName).trim();

    const scene = tokenDoc.parent || canvas?.scene;
    let nextNum = 1;
    if (scene?.tokens) {
      const escaped = baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`^${escaped}(?:\\s+(\\d+))?$`, 'i');
      const numbers = [];
      for (const t of scene.tokens) {
        if (t.id && t.id === tokenDoc.id) continue;
        const match = (t.name || '').match(regex);
        if (match) {
          numbers.push(match[1] ? parseInt(match[1], 10) : 1);
        }
      }
      if (numbers.length > 0) {
        nextNum = Math.max(...numbers) + 1;
      }
    }
    updates.name = `${baseName} ${nextNum}`;
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
