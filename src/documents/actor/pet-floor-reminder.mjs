/**
 * The floor change reminder (core book p. 230): a pet that is not Bonded when the floor collapses does not come to the next
 * floor. Nothing is deleted or moved; the GM gets one whispered line naming the crawlers' pets that are not Bonded.
 */
import { escapeAttr } from '../../utils/escape-attr.mjs';
import { sanitizePetAttitude } from '../../data/rules/pet-rules.mjs';
import { gmWhisper } from './vehicle-drive-common.mjs';

/**
 * Pets owned by a crawler whose attitude is not Bonded.
 * @returns {Actor[]}
 */
function unbondedOwnedPets() {
  const actors = Array.from(globalThis.game?.actors?.values?.() ?? []);
  const crawlerIds = new Set(actors.filter((a) => a?.type === 'crawler').map((a) => a.id));
  return actors.filter((a) => a?.type === 'pet' && crawlerIds.has(a.system?.details?.ownerId) && sanitizePetAttitude(a.system?.details?.attitude) !== 'bonded');
}

/**
 * Whisper the GM the pets that will not follow to the next floor. Posts nothing when every owned pet is Bonded.
 * @returns {Promise<ChatMessage|null>}
 */
export async function postFloorPetReminder() {
  if (globalThis.game?.user?.isGM === false) return null;
  const pets = unbondedOwnedPets();
  if (!pets.length) return null;
  const names = pets.map((p) => escapeAttr(p.name || 'A pet')).join(', ');
  return globalThis.ChatMessage?.create?.({
    content: `<p>A pet that is not Bonded when the floor collapses does not come to the next floor. Not Bonded: ${names}.</p>`,
    whisper: gmWhisper()
  }) ?? null;
}
