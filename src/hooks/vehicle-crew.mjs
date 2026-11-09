/**
 * Vehicle crew hooks: drop an actor on a vehicle token to board
 * it, and keep crews and access clean when an actor, a vehicle or an unlinked token is deleted. Crew rules live in
 * `documents/actor/vehicle-crew.mjs`; this file only wires Foundry events to them.
 */
import { changeVehicleCrew, runCrewWrite, vehicleUuidOf, vehiclesCarrying, REFUSED_TYPES } from '../documents/actor/vehicle-crew.mjs';
import { applyOwnershipSync } from '../documents/actor/ownership-relay.mjs';
import { CREW_OPS, crewCapacity, planCrewChange, readCrew } from '../data/rules/vehicle-crew-rules.mjs';
import { onVehicleTokenMove } from '../documents/actor/vehicle-follow.mjs';
import { isActiveGM } from '../utils/gm-relay.mjs';
import { openApplications } from '../compat.mjs';

const asString = (v) => (typeof v === 'string' ? v.trim() : '');
const isNumber = (v) => typeof v === 'number' && Number.isFinite(v);

/* -------------------------------------------- */
/*  Drop onto a vehicle token                   */
/* -------------------------------------------- */

/** True when the canvas point lies inside the token's square footprint. */
function tokenContains(token, x, y) {
  const grid = Number(globalThis.canvas?.grid?.size) || 100;
  const width = (Number(token?.document?.width) || 1) * grid;
  const height = (Number(token?.document?.height) || 1) * grid;
  const left = Number(token?.x ?? token?.document?.x);
  const top = Number(token?.y ?? token?.document?.y);
  if (!Number.isFinite(left) || !Number.isFinite(top)) return false;
  return x >= left && x < left + width && y >= top && y < top + height;
}

/**
 * `dropCanvasData`: dropping a sidebar actor on a vehicle token boards it. Returns false (no new token) only when
 * the actor already has a token on this scene; otherwise undefined, so Foundry places the token on the vehicle.
 */
export function onDropCanvasData(canvas, data) {
  if (data?.type !== 'Actor' || !isNumber(data.x) || !isNumber(data.y)) return undefined;
  const uuid = asString(data.uuid);
  if (!uuid) return undefined;
  let actor = null;
  try {
    actor = globalThis.fromUuidSync?.(uuid) ?? null;
  } catch {
    return undefined; // not a UUID
  }
  if (!actor || actor.documentName !== 'Actor' || actor.pack || REFUSED_TYPES[actor.type]) return undefined;

  const placeables = Array.isArray(canvas?.tokens?.placeables) ? canvas.tokens.placeables : [];
  const target = placeables.find((t) => t?.actor?.type === 'mount_vehicle' && tokenContains(t, data.x, data.y));
  if (!target) return undefined;

  changeVehicleCrew(target.actor, actor, CREW_OPS.EMBARK).catch((err) => {
    console.warn('Sprinter RPG | Boarding a vehicle by drop failed:', err);
  });
  return placeables.some((t) => t?.actor?.uuid === actor.uuid) ? false : undefined;
}

/* -------------------------------------------- */
/*  Deletion cleanup                            */
/* -------------------------------------------- */

/**
 * Remove every ref from every vehicle that carries it (membership first), then lower access for `actor`'s players
 * through the in-memory document. Runs in the crew write queue so it never interleaves with a relayed crew change.
 * @param {string[]} refs actor uuids the deleted thing could have been listed under
 * @param {Actor|null} actor the deleted actor, when still in memory
 */
async function removeFromVehicles(refs, actor) {
  const seen = new Set();
  const touched = [];
  for (const ref of refs.map(asString).filter(Boolean)) {
    for (const vehicle of vehiclesCarrying(ref)) {
      const plan = planCrewChange(readCrew(vehicle.system), CREW_OPS.DISEMBARK, ref, crewCapacity(vehicle.system));
      if (!plan.changed) continue;
      await vehicle.update({ 'system.occupants': plan.crew.occupants, 'system.pilotUuid': plan.crew.pilotUuid });
      if (!seen.has(vehicleUuidOf(vehicle))) {
        seen.add(vehicleUuidOf(vehicle));
        touched.push(vehicle);
      }
    }
  }
  if (!actor) return;
  for (const vehicle of touched) {
    try {
      await applyOwnershipSync(vehicle, actor, { revoke: true });
    } catch (err) {
      console.warn('Sprinter RPG | Revoking vehicle access after a deletion failed:', err);
    }
  }
}

/** A deleted vehicle leaves every crawler's `companions.vehicles`. */
async function forgetVehicle(vehicle) {
  const a = globalThis.game?.actors;
  const all = !a ? [] : Array.from(a.values());
  for (const crawler of all.filter((x) => x?.type === 'crawler')) {
    const list = crawler.system?.companions?.vehicles;
    if (!Array.isArray(list) || !list.includes(vehicle.id)) continue;
    await crawler.update({ 'system.companions.vehicles': list.filter((id) => id !== vehicle.id) });
  }
}

/** `deleteActor`: active GM only. */
export async function onDeleteActor(actor) {
  if (!isActiveGM() || !actor) return;
  try {
    if (actor.type === 'mount_vehicle') await forgetVehicle(actor);
    await runCrewWrite(() => removeFromVehicles([actor.uuid], actor));
  } catch (err) {
    console.warn('Sprinter RPG | Vehicle cleanup after an actor deletion failed:', err);
  }
}

/** `deleteToken`: active GM only; only an unlinked token's synthetic actor is removed from crews. */
async function onDeleteToken(tokenDoc) {
  if (!isActiveGM() || !tokenDoc || tokenDoc.actorLink !== false) return;
  const actor = tokenDoc.actor ?? null;
  try {
    await runCrewWrite(() => removeFromVehicles([actor?.uuid, tokenDoc.uuid], actor));
  } catch (err) {
    console.warn('Sprinter RPG | Vehicle cleanup after a token deletion failed:', err);
  }
}

/* -------------------------------------------- */
/*  Stale sheets (Q232 a, section 5.7)          */
/* -------------------------------------------- */

/**
 * `updateActor` / `updateToken`: Foundry leaves an open sheet standing after its viewer loses access. Close every
 * open sheet of a vehicle on this client once the current user is below OBSERVER on it. GMs are never affected.
 * @param {object} actorOrToken a vehicle actor (also an unlinked token's synthetic actor), or a token document
 * @returns {number} sheets closed
 */
function closeSheetsOfVehicleLostAccess(actorOrToken) {
  const user = globalThis.game?.user;
  if (!user || user.isGM) return 0;
  const actor = actorOrToken?.documentName === 'Token' ? actorOrToken.actor : actorOrToken;
  if (actor?.type !== 'mount_vehicle' || actor.testUserPermission?.(user, 'OBSERVER') !== false) return 0;
  let closed = 0;
  for (const app of openApplications()) {
    const doc = app?.document;
    if (!doc || (doc !== actor && (!actor.uuid || doc.uuid !== actor.uuid))) continue;
    app.close?.();
    closed += 1;
  }
  return closed;
}

/* -------------------------------------------- */
/*  Registration                                */
/* -------------------------------------------- */

export function registerVehicleCrewHooks() {
  Hooks.on('dropCanvasData', onDropCanvasData);
  Hooks.on('deleteActor', onDeleteActor);
  Hooks.on('deleteToken', onDeleteToken);
  Hooks.on('moveToken', onVehicleTokenMove);
  Hooks.on('updateActor', closeSheetsOfVehicleLostAccess);
  Hooks.on('updateToken', closeSheetsOfVehicleLostAccess);
}
