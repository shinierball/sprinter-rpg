import { resolveActor } from './actor-constants.mjs';
import { resolveActorByUuid } from '../../utils/actor-uuid.mjs';
import { syncActorOwnership } from './ownership-relay.mjs';
import { rideProblems } from '../../utils/pet/pet-combat.mjs';
import { confirmRuleBreak, ruleBreakUpdate } from '../../utils/rule-break.mjs';
import { petLimitFor } from './pet-checks.mjs';
import { escapeAttr } from '../../utils/escape-attr.mjs';
import { combatantOfActor } from '../combat/combatants.mjs';


/* -------------------------------------------- */
/*  Companions, Mounts & Vehicles Management    */
/* -------------------------------------------- */

/**
 * The Rule Break question when this crawler already has as many pets as it may (p. 228), else null. Dedicated mounts are not counted.
 * @param {COGActor} actor
 * @returns {string|null}
 */
function petLimitExceeded(actor) {
  const ids = Array.isArray(actor.system?.companions?.pets) ? actor.system.companions.pets : [];
  const have = ids.map((id) => resolveActor(id)).filter((p) => p && p.system?.details?.isMount !== true).length;
  const limit = petLimitFor(actor);
  if (have < limit) return null;
  return `${actor.name || 'This crawler'} already has ${have} pet${have === 1 ? '' : 's'} (limit ${limit}). Bond anyway as a Rule Break?`;
}

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
    // Bonding one pet past the limit (p. 228) asks a Rule Break; a dedicated mount is not counted.
    const overLimit = !existing.includes(compActor.id) && compActor.system?.details?.isMount !== true
      ? petLimitExceeded(actor) : null;
    if (overLimit) {
      const verdict = await confirmRuleBreak({ title: 'Pet limit', message: escapeAttr(overLimit), reason: overLimit });
      if (!verdict.confirmed) return false;
    }
    if (!existing.includes(compActor.id)) existing.push(compActor.id);
    await actor.update({ 'system.companions.pets': existing });

    await compActor.update({ 'system.details.ownerId': actor.id, ...(overLimit ? ruleBreakUpdate('Bonded past the pet limit') : {}) });
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
 * - Pets can be ridden when nothing in `rideProblems` stands in the way (size, saddle, mount marks).
 * @param {COGActor|object} crawlerActor
 * @returns {boolean}
 */
export function canBeRiddenBy(actor, crawlerActor) {
  if (!crawlerActor) return false;
  if (actor.type === 'mount_vehicle') return true;
  if (actor.type === 'pet') {
    // By the book, a pet can be ridden when nothing in `rideProblems` stands in the way.
    return rideProblems(actor, crawlerActor).length === 0;
  }
  return false;
}


/**
 * Record the Move Action that mounting or dismounting costs the rider (core book p. 233): on the rider's combatant in the
 * running combat. Nothing is recorded outside a started combat or for a rider who is not in it. The mount moving its rider
 * costs nothing, so nothing is ever recorded for the mount. Over budget asks the ledger's Rule Break confirm.
 * @param {COGActor|null} rider
 * @param {string} label the ledger line
 * @returns {Promise<boolean>} false when the Rule Break was declined (the mount or dismount does not happen)
 */
async function recordMountAction(rider, label) {
  const combat = globalThis.game?.combat;
  if (!rider || !combat || !(combat.started ?? Number(combat.round) > 0)) return true;
  const combatant = combatantOfActor(combat, rider);
  if (!combatant) return true;
  const recorded = await combat.recordCombatantAction(combatant, { type: 'move', label });
  return recorded?.success === true;
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
  // A mount the book says cannot be ridden asks a Rule Break (never a block).
  const rider = typeof crawler === 'string' ? resolveActor(crawler) : crawler;
  const problems = rider ? rideProblems(actor, rider) : [];
  if (problems.length) {
    const verdict = await confirmRuleBreak({
      title: 'Ride this pet?',
      message: `${problems.map(escapeAttr).join(' ')} Ride anyway as a Rule Break?`,
      reason: `${problems.join(' ')} Ride anyway as a Rule Break?`
    });
    if (!verdict.confirmed) return false;
  }
  // Mounting costs the crawler a Move Action in a running combat (core book p. 233); over budget asks the ledger's Rule Break.
  if (!(await recordMountAction(rider, `Mount ${actor.name || 'pet'}`))) return false;
  await actor.update({ 'system.details.riderId': crawlerId });
  return true;
}


/**
 * Dismounts the rider from this pet.
 * @returns {Promise<boolean>}
 */
export async function dismountRider(actor) {
  if (actor.type !== 'pet') return false;
  // Dismounting costs the rider a Move Action in a running combat (core book p. 233).
  if (!(await recordMountAction(getRiderActor(actor), `Dismount ${actor.name || 'pet'}`))) return false;
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
