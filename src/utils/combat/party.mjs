/**
 * The party roster. Pure reads of world actors.
 */

/** The normalised party key: `details.party`, trimmed and lower-cased; '' when none. */
function partyKey(actor) {
  const raw = actor?.system?.details?.party;
  return typeof raw === 'string' ? raw.trim().toLowerCase() : '';
}

/** Whether two actors are in the same party: both party keys non-empty and equal. */
export function sameParty(a, b) {
  const key = partyKey(a);
  return key !== '' && key === partyKey(b);
}

const idOf = (actor) => actor?.uuid ?? actor?.id ?? null;

/** The world actors as an array (`game.actors` is a Collection). */
function worldActors() {
  const all = globalThis.game?.actors;
  if (!all) return [];
  return Array.from(all.values());
}

/**
 * The owner's party roster: world actors with the owner's party key (the owner included), plus pets whose
 * `details.ownerId` is a member's id and mercenaries for which `system.isEmployedBy(memberId)` holds. With no
 * party key: the owner and its own companions. Deduplicated by `uuid ?? id`.
 * @param {object|null} actor the row owner
 * @param {{ actors?: object[] }} [options] `actors` replaces the world actors (tests)
 * @returns {object[]}
 */
export function partyMembers(actor, { actors } = {}) {
  if (!actor) return [];
  const all = Array.isArray(actors) ? actors : worldActors();
  const seen = new Set();
  const members = [];
  const add = (a) => {
    const id = idOf(a);
    if (!a || (id !== null && seen.has(id))) return;
    if (id !== null) seen.add(id);
    members.push(a);
  };

  add(actor);
  const key = partyKey(actor);
  if (key) for (const a of all) if (partyKey(a) === key) add(a);

  const memberIds = new Set(members.map(m => m.id).filter(Boolean));
  for (const a of all) {
    if (a.type === 'pet') {
      if (memberIds.has(a.system?.details?.ownerId)) add(a);
    } else if (a.type === 'mercenary') {
      if ([...memberIds].some(id => a.system?.isEmployedBy?.(id))) add(a);
    }
  }
  return members;
}
