/**
 * Pet lookups: which pets a crawler owns, and which pet a crawler is riding. Reads the world's actors only (no writers), so the Level follow, the roll
 * collectors and the sheets can all import it without reaching the data models.
 */

/**
 * The world's pets (and dedicated mounts, which are pets) whose `details.ownerId` is this crawler.
 * @param {{id?: string}|null} crawler
 * @returns {Actor[]}
 */
export function petsOwnedBy(crawler) {
  const id = crawler?.id;
  const all = globalThis.game?.actors;
  if (!id || !all) return [];
  return Array.from(all.values()).filter(a => a?.type === 'pet' && a.system?.details?.ownerId === id);
}

const listOf = (c) => {
  if (!c) return [];
  return Array.isArray(c) ? c : (Array.isArray(c.contents) ? c.contents : Array.from(c.values?.() || c));
};

/** Every pet that can carry a rider: the world's pets, then the synthetic actors of unlinked pet tokens on any scene. */
function allPets() {
  const out = listOf(globalThis.game?.actors).filter((a) => a?.type === 'pet');
  for (const scene of listOf(globalThis.game?.scenes)) {
    for (const token of listOf(scene?.tokens)) {
      if (token?.actorLink !== false) continue;
      const actor = token.actor;
      if (actor?.type === 'pet') out.push(actor);
    }
  }
  return out;
}

/**
 * The pet this actor is riding: the one whose `details.riderId` is the actor's id, or null. The pet's `riderId` is the one
 * source of truth (the crawler stores nothing).
 * @param {{id?: string}|null} actor
 * @returns {Actor|null}
 */
export function mountOf(actor) {
  const id = actor?.id;
  if (!id) return null;
  return allPets().find((p) => p.system?.details?.riderId === id) ?? null;
}

/**
 * A dedicated mount (core book p. 233): a pet marked `details.isMount`. It never levels and has one Action a round.
 * @param {Actor|null} actor
 * @returns {boolean}
 */
export function isDedicatedMount(actor) {
  return actor?.type === 'pet' && actor.system?.details?.isMount === true;
}
