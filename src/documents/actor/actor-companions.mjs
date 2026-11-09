import { resolveActor } from './actor-constants.mjs';
import { resolveActorByUuid } from '../../utils/actor-uuid.mjs';
import { getSizeInfo } from '../../data/sizes.mjs';
import { syncActorOwnership } from './ownership-relay.mjs';


/* -------------------------------------------- */
/*  Companions, Mounts & Vehicles Management    */
/* -------------------------------------------- */

/**
 * Bonds a companion actor (pet or vehicle) to this crawler.
 * Updates ownerId on companion and companion list on this crawler.
 * Also synchronizes player ownership from crawler to companion through the GM relay (players never write ownership).
 * @param {COGActor|string} companion
 * @returns {Promise<boolean>}
 */
export async function bondCompanion(actor, companion) {
  const compActor = typeof companion === 'string'
    ? resolveActor(companion)
    : companion;
  if (!compActor) return false;

  if (compActor.type === 'pet') {
    const existing = Array.isArray(actor.system?.companions?.pets) ? [...actor.system.companions.pets] : [];
    if (!existing.includes(compActor.id)) existing.push(compActor.id);
    await actor.update({ 'system.companions.pets': existing });

    await compActor.update({ 'system.details.ownerId': actor.id });
    await syncActorOwnership(compActor, actor);
    return true;
  } else if (compActor.type === 'mercenary') {
    const existing = Array.isArray(actor.system?.companions?.mercenaries) ? [...actor.system.companions.mercenaries] : [];
    if (!existing.includes(compActor.id)) existing.push(compActor.id);
    await actor.update({ 'system.companions.mercenaries': existing });

    const employers = Array.isArray(compActor.system?.details?.employerIds) ? [...compActor.system.details.employerIds] : [];
    if (!employers.includes(actor.id)) employers.push(actor.id);

    await compActor.update({
      'system.details.ownerId': compActor.system?.details?.ownerId || actor.id,
      'system.details.employerIds': employers,
      'system.details.hired': true
    });
    await syncActorOwnership(compActor, actor);
    return true;
  } else if (compActor.type === 'mount_vehicle') {
    const existing = Array.isArray(actor.system?.companions?.vehicles) ? [...actor.system.companions.vehicles] : [];
    if (!existing.includes(compActor.id)) existing.push(compActor.id);
    await actor.update({ 'system.companions.vehicles': existing });

    await compActor.update({ 'system.ownerId': actor.id });
    await syncActorOwnership(compActor, actor);
    return true;
  }
  return false;
}


/**
 * Unbonds a companion actor from this crawler, then (through the GM relay) revokes this crawler's players'
 * ownership of it unless they still own another crawler linked to it.
 * @param {COGActor|string} companion
 * @returns {Promise<boolean>}
 */
export async function unbondCompanion(actor, companion) {
  const compId = typeof companion === 'string' ? companion : companion?.id;
  if (!compId) return false;

  const compActor = typeof companion === 'object' ? companion : resolveActor(compId);

  const pets = Array.isArray(actor.system?.companions?.pets) ? actor.system.companions.pets.filter(id => id !== compId) : [];
  const vehicles = Array.isArray(actor.system?.companions?.vehicles) ? actor.system.companions.vehicles.filter(id => id !== compId) : [];
  const mercenaries = Array.isArray(actor.system?.companions?.mercenaries) ? actor.system.companions.mercenaries.filter(id => id !== compId) : [];

  await actor.update({
    'system.companions.pets': pets,
    'system.companions.vehicles': vehicles,
    'system.companions.mercenaries': mercenaries
  });

  if (compActor) {
    if (compActor.type === 'pet') {
      await compActor.update({ 'system.details.ownerId': '' });
    } else if (compActor.type === 'mount_vehicle') {
      await compActor.update({ 'system.ownerId': '' });
    } else if (compActor.type === 'mercenary') {
      const employers = Array.isArray(compActor.system?.details?.employerIds)
        ? compActor.system.details.employerIds.filter(id => id !== actor.id)
        : [];
      await compActor.update({
        'system.details.employerIds': employers,
        'system.details.ownerId': employers[0] || '',
        'system.details.hired': employers.length > 0
      });
    }
    await syncActorOwnership(compActor, actor, { revoke: true });
  }
  return true;
}


/**
 * Retrieves all resolved Pet Actor documents bonded to this crawler.
 * @returns {Array<COGActor>}
 */
export function getBondedPets(actor) {
  const petIds = Array.isArray(actor.system?.companions?.pets) ? actor.system.companions.pets : [];
  const actors = [];
  for (const id of petIds) {
    const act = resolveActor(id);
    if (act) actors.push(act);
  }
  return actors;
}


/**
 * Retrieves all resolved Vehicle Actor documents bonded to this crawler.
 * @returns {Array<COGActor>}
 */
export function getBondedVehicles(actor) {
  const vehicleIds = Array.isArray(actor.system?.companions?.vehicles) ? actor.system.companions.vehicles : [];
  const actors = [];
  for (const id of vehicleIds) {
    const act = resolveActor(id);
    if (act) actors.push(act);
  }
  return actors;
}


/**
 * Retrieves the owner Crawler Actor of this companion (pet, mercenary, or vehicle).
 * @returns {COGActor|null}
 */
export function getOwnerActor(actor) {
  let ownerId = '';
  if (actor.type === 'pet') {
    ownerId = actor.system?.details?.ownerId || actor.system?.ownerId || '';
  } else if (actor.type === 'mount_vehicle') {
    ownerId = actor.system?.ownerId || '';
  } else if (actor.type === 'mercenary') {
    ownerId = actor.system?.details?.ownerId || actor.system?.details?.employerIds?.[0] || '';
  }
  if (!ownerId) return null;
  return resolveActor(ownerId);
}

/**
 * Retrieves all employer Crawler Actors of this mercenary.
 * @returns {Array<COGActor>}
 */
export function getEmployerActors(actor) {
  if (actor.type !== 'mercenary') return [];
  const empIds = Array.isArray(actor.system?.details?.employerIds) ? actor.system.details.employerIds : [];
  const employers = [];
  for (const id of empIds) {
    const act = resolveActor(id);
    if (act) employers.push(act);
  }
  return employers;
}


/**
 * Checks whether this actor can be mounted or ridden by a crawler.
 * - Mount/vehicles can always be boarded/ridden.
 * - Pets can be ridden if explicitly marked as isMount, or if the pet's size
 *   is larger than the rider crawler's size (e.g. Size 4 Medium or Size 5 Large pet
 *   ridden by Size 3 Petite or Size 2 Small crawler).
 * @param {COGActor|object} crawlerActor
 * @returns {boolean}
 */
export function canBeRiddenBy(actor, crawlerActor) {
  if (!crawlerActor) return false;
  if (actor.type === 'mount_vehicle') return true;
  if (actor.type === 'pet') {
    if (typeof actor.system?.canBeRiddenBy === 'function') {
      return actor.system.canBeRiddenBy(crawlerActor);
    }
    if (actor.system?.details?.isMount) return true;
    const petSize = actor.system?.attributes?.sizeNumber ?? (getSizeInfo(actor.system?.attributes?.size)?.size || 4);
    const crawlerSize = crawlerActor.system?.attributes?.sizeNumber ?? (getSizeInfo(crawlerActor.system?.attributes?.size)?.size || 4);
    return petSize > crawlerSize;
  }
  return false;
}


/**
 * Assigns a crawler as rider on this pet.
 * @param {COGActor|string} crawler
 * @returns {Promise<boolean>}
 */
export async function assignRider(actor, crawler) {
  if (actor.type !== 'pet') return false;
  const crawlerId = typeof crawler === 'string' ? crawler : crawler?.id;
  if (!crawlerId) return false;
  await actor.update({ 'system.details.riderId': crawlerId });
  return true;
}


/**
 * Dismounts the rider from this pet.
 * @returns {Promise<boolean>}
 */
export async function dismountRider(actor) {
  if (actor.type !== 'pet') return false;
  await actor.update({ 'system.details.riderId': '' });
  return true;
}


/**
 * Gets the active rider Actor on this pet.
 * @returns {COGActor|null}
 */
export function getRiderActor(actor) {
  const riderId = actor.system?.details?.riderId;
  if (!riderId) return null;
  return resolveActor(riderId);
}


/**
 * Gets the active pilot Actor of this vehicle.
 * @returns {COGActor|null}
 */
export function getPilotActor(actor) {
  const pilotUuid = actor.system?.pilotUuid;
  if (!pilotUuid) return null;
  return resolveActorByUuid(pilotUuid);
}
