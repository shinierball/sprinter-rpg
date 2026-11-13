/**
 * Keep open actor sheets in step across actors. Foundry re-renders a sheet only when its own
 * document changes, but a companion's update (pilot, rider, owner, employers) changes what the
 * related crawler's sheet shows. There is no built-in dependency tracking, so on `updateActor`
 * we re-render the other open actor sheets that reference the updated actor, and also when one of
 * its embedded items changes (a personal space shows its owner's belongings; embedded item changes
 * do not fire `updateActor`).
 */
import { openApplications } from '../../compat.mjs';

/** Ids (or, for personal spaces, uuids) of the actors a companion or space points at. */
export function referencedActorIds(actor) {
  const sys = actor?.system ?? {};
  const ids = [
    sys.ownerId, sys.details?.ownerId, sys.pilotUuid, sys.details?.riderId,
    sys.ownerUuid,
    ...(Array.isArray(sys.occupants) ? sys.occupants.map((o) => o?.uuid) : []),
    ...(Array.isArray(sys.occupantUuids) ? sys.occupantUuids : []),
    ...(Array.isArray(sys.details?.employerIds) ? sys.details.employerIds : [])
  ];
  return new Set(ids.filter((id) => typeof id === 'string' && id));
}

/** True when `other` lists `actor` among its bonded companions. */
function lists(other, actor) {
  const companions = other?.system?.companions ?? {};
  return ['pets', 'vehicles', 'mercenaries'].some((key) => Array.isArray(companions[key]) && companions[key].includes(actor.id));
}

/**
 * Re-render every other open actor sheet related to `actor`.
 * @param {Actor} actor the actor that just changed
 * @returns {Promise<number>} how many sheets were re-rendered
 */
async function refreshRelatedSheets(actor) {
  if (!actor) return 0;
  const referenced = referencedActorIds(actor);
  let count = 0;
  for (const app of openApplications()) {
    const doc = app?.actor ?? app?.document;
    if (!doc || doc.documentName !== 'Actor' || doc === actor || (doc.uuid && doc.uuid === actor.uuid)) continue;
    if (app.rendered === false) continue;
    const pointsBack = [actor.id, actor.uuid].some((id) => id && referencedActorIds(doc).has(id));
    if (!referenced.has(doc.id) && !referenced.has(doc.uuid) && !lists(doc, actor) && !pointsBack) continue;
    await app.render();
    count++;
  }
  return count;
}

/**
 * Re-render every open actor sheet of one actor type: a world setting the sheet reads changed (the personal space prices).
 * @param {string} type the actor type
 * @returns {Promise<number>} how many sheets were re-rendered
 */
export async function refreshOpenActorSheets(type) {
  let count = 0;
  for (const app of openApplications()) {
    const doc = app?.actor ?? app?.document;
    if (doc?.documentName !== 'Actor' || doc.type !== type || app.rendered === false) continue;
    await app.render();
    count++;
  }
  return count;
}

/** `updateActor` hook handler. */
export function onUpdateActorRefreshRelated(actor) {
  return refreshRelatedSheets(actor);
}

/** `createItem` / `updateItem` / `deleteItem` hook handler: an embedded item change refreshes the owning actor's related sheets. */
export function onItemChangeRefreshRelated(item) {
  return item?.parent?.documentName === 'Actor' ? refreshRelatedSheets(item.parent) : 0;
}
