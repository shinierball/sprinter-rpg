/**
 * Vehicle crew: who is aboard a `mount_vehicle` and who drives.
 *
 * The vehicle is the single source of truth: `system.pilotUuid` and `system.occupants[{ uuid, role, ruleBreak }]`
 * hold actor UUIDs (never ids, so unlinked token actors can ride). The pure rules live in
 * `vehicle-crew-rules.mjs`; this file is the document layer. Every change goes through `changeVehicleCrew`, which asks
 * for a Rule Break confirm when a seat limit would be exceeded, then through the GM relay action `vehicleCrew`, so a
 * player can change a vehicle they do not own. The GM derives `ruleBreak` from the documents, never from the payload.
 *
 * Access follows membership: after the membership writes, `syncActorOwnership` grants OBSERVER (OWNER for a driver and
 * for a bonded owner) to the occupant's players and revokes what they are no longer entitled to. A revoke only lowers
 * levels the system granted (the vehicle's grant record, `ownership-relay.mjs`), and an op that would revoke never runs
 * on the `direct` path: with no GM connected it is refused rather than leaving a stale grant behind.
 *
 * The GM applies one crew change at a time (`runCrewWrite`), so two boards that arrive together both land.
 *
 * A vehicle placed as an unlinked token is its own vehicle: its synthetic actor carries its own crew
 * and access in the token's ActorDelta, every lookup sees it (`allVehicles`), and its identity is its token uuid
 * (`vehicleUuidOf`).
 *
 * Imports no sheet and not `actor.mjs`, so the actor mixin can import it without a cycle.
 */
import { ruleBreakMessageData } from '../../utils/rule-break-visibility.mjs';
import { isNoGmReason, registerRelayAction, requestRelay } from '../../utils/gm-relay.mjs';
import { resolveActorByUuid } from '../../utils/actor-uuid.mjs';
import { confirmRuleBreak, RULE_BREAK_REFUSALS } from '../../utils/rule-break.mjs';
import { hasRecordedAccess, reconcileRecordedAccess, syncActorOwnership } from './ownership-relay.mjs';
import { userOwnsActor } from './personal-space-links.mjs';
import { SYSTEM_ID } from '../../constants.mjs';
import {
  CREW_OPS, crewCapacity, planCrewChange, readCrew, sanitizeVehicleRole, vehicleRoleInfo, wouldOverfill
} from '../../data/rules/vehicle-crew-rules.mjs';

export const RELAY_ACTION_VEHICLE_CREW = 'vehicleCrew';

const OPS = new Set(Object.values(CREW_OPS));
const ADDING_OPS = new Set([CREW_OPS.EMBARK, CREW_OPS.TAKE_WHEEL]);
const ROLE_OPS = new Set([CREW_OPS.EMBARK, CREW_OPS.TAKE_WHEEL, CREW_OPS.SET_ROLE]);
/** Actor types that cannot be aboard (section 5.2), with the word shown in the notification. */
export const REFUSED_TYPES = Object.freeze({ mount_vehicle: 'vehicle', personal_space: 'personal space', marker: 'marker' });

const asString = (v) => (typeof v === 'string' ? v.trim() : '');

/* -------------------------------------------- */
/*  Lookups                                     */
/* -------------------------------------------- */

const listOf = (c) => {
  if (!c) return [];
  return Array.isArray(c) ? c : (Array.isArray(c.contents) ? c.contents : Array.from(c.values?.() || c));
};

/** World actors of type `mount_vehicle`. */
export function worldVehicles() {
  return listOf(globalThis.game?.actors).filter((x) => x?.type === 'mount_vehicle');
}

/**
 * Vehicles that exist only as unlinked tokens: the synthetic actor of every unlinked
 * `mount_vehicle` token on every scene. Each copy carries its own crew (in its ActorDelta). A linked token's actor is
 * the world actor, already in `worldVehicles()`.
 */
export function tokenVehicles() {
  const out = [];
  for (const scene of listOf(globalThis.game?.scenes)) {
    for (const token of listOf(scene?.tokens)) {
      if (token?.actorLink !== false) continue;
      const actor = token.actor;
      if (actor?.type === 'mount_vehicle') out.push(actor);
    }
  }
  return out;
}

/** Every vehicle that can carry crew: world vehicles, then unlinked vehicle tokens' synthetic actors. */
export function allVehicles() {
  return [...worldVehicles(), ...tokenVehicles()];
}

/**
 * A vehicle's stable identity: its token's uuid for a synthetic (unlinked token) actor, else its actor uuid. Every crew
 * payload and comparison uses it; `resolveActorByUuid` turns a token uuid back into the synthetic actor.
 */
export function vehicleUuidOf(vehicle) {
  if (vehicle?.isToken) {
    const token = vehicle.token ?? vehicle.parent;
    if (typeof token?.uuid === 'string' && token.uuid) return token.uuid;
  }
  return asString(vehicle?.uuid);
}

const sameVehicle = (a, b) => Boolean(a && b) && vehicleUuidOf(a) === vehicleUuidOf(b);

/** Vehicles whose crew lists `ref` (an actor uuid). */
export function vehiclesCarrying(ref) {
  const uuid = asString(ref);
  if (!uuid) return [];
  return allVehicles().filter((v) => readCrew(v.system).occupants.some((o) => o.uuid === uuid));
}

/** The first vehicle this actor is aboard, or null. */
export function vehicleOf(actor) {
  return vehiclesCarrying(actor?.uuid)[0] ?? null;
}

/**
 * The vehicle's crew with documents resolved.
 * @returns {{ pilot: Actor|null, occupants: object[], missing: { uuid: string, role: string }[] }}
 */
export function crewMembers(vehicle) {
  const crew = readCrew(vehicle?.system);
  const occupants = [];
  const missing = [];
  for (const entry of crew.occupants) {
    const actor = resolveActorByUuid(entry.uuid);
    if (!actor) {
      missing.push({ uuid: entry.uuid, role: entry.role });
      continue;
    }
    occupants.push({
      actor, uuid: entry.uuid, role: entry.role, roleLabel: vehicleRoleInfo(entry.role).label,
      ruleBreak: entry.ruleBreak, isPilot: entry.uuid === crew.pilotUuid
    });
  }
  return { pilot: occupants.find((o) => o.isPilot)?.actor ?? null, occupants, missing };
}

/** This actor's `{ uuid, role, ruleBreak, isPilot }` in `vehicle`, or null when not aboard. */
export function crewEntryOf(vehicle, actor) {
  const ref = asString(actor?.uuid);
  const crew = readCrew(vehicle?.system);
  const entry = ref ? crew.occupants.find((o) => o.uuid === ref) : null;
  return entry ? { ...entry, isPilot: entry.uuid === crew.pilotUuid } : null;
}

/* -------------------------------------------- */
/*  Client entry point                          */
/* -------------------------------------------- */

function notify(level, message) {
  globalThis.ui?.notifications?.[level]?.(message);
}

/**
 * Change one actor's place or role in a vehicle. Asks for a Rule Break when the op would overfill the vehicle.
 * @param {Actor} vehicle  a mount_vehicle
 * @param {Actor|string} actorOrUuid  the occupant
 * @param {'embark'|'disembark'|'takeWheel'|'stepDown'|'setRole'} op
 * @param {{ role?: string, interactive?: boolean, ruleBreak?: boolean }} [options]
 *   role: for setRole (required) and embark/takeWheel (optional, default 'passenger'). interactive and ruleBreak
 *   go to confirmRuleBreak.
 * @returns {Promise<boolean>} true when applied
 */
export async function changeVehicleCrew(vehicle, actorOrUuid, op, options = {}) {
  if (vehicle?.type !== 'mount_vehicle' || !OPS.has(op)) return false;
  const opts = options || {};
  const role = sanitizeVehicleRole(opts.role);
  const actor = typeof actorOrUuid === 'string' ? resolveActorByUuid(actorOrUuid) : actorOrUuid;
  const ref = asString(actor?.uuid ?? (typeof actorOrUuid === 'string' ? actorOrUuid : ''));
  if (!ref) return false;
  if (vehicle.pack || actor?.pack) {
    notify('warn', 'Import this actor from its compendium before changing a vehicle crew.');
    return false;
  }
  // An unresolved ref (a "Missing actor" row) can still be removed or re-roled, never added.
  if (!actor && ADDING_OPS.has(op)) return false;
  const refused = REFUSED_TYPES[actor?.type];
  if (refused) {
    notify('warn', `A vehicle can't carry a ${refused}.`);
    return false;
  }
  const crew = readCrew(vehicle.system);
  if (op === CREW_OPS.SET_ROLE && !crew.occupants.some((o) => o.uuid === ref)) return false;

  const capacity = crewCapacity(vehicle.system);
  if (wouldOverfill(crew, op, ref, capacity)) {
    const result = await confirmRuleBreak({
      title: 'Vehicle Occupancy',
      message: `${vehicle.name} seats ${capacity.total} and ${crew.occupants.length} are aboard. Board ${actor?.name ?? 'this actor'} anyway as a Rule Break?`,
      options: { interactive: opts.interactive, ruleBreak: opts.ruleBreak }
    });
    if (!result.confirmed) {
      if (result.refusal !== RULE_BREAK_REFUSALS.CANCELLED) notify('warn', result.reason);
      return false;
    }
  }

  const user = globalThis.game?.user;
  const others = otherVehiclesCarrying(ref, vehicle, op);
  const plan = planCrewChange(crew, op, ref, capacity, { role });
  // Direct only when the user can write every vehicle AND nothing would be revoked: a deferred revoke never runs.
  const { revokes } = accessChanges(vehicle, crew, plan, ref, actor, others);
  const direct = Boolean(user?.isGM || ([vehicle, ...others].every((v) => userOwnsActor(v, user))
    && !revokes.some(([v, a]) => hasRecordedAccess(v, a))));
  const payload = { vehicleUuid: vehicleUuidOf(vehicle), actorUuid: ref, op };
  if (ROLE_OPS.has(op)) payload.role = role;
  const reply = await requestRelay(RELAY_ACTION_VEHICLE_CREW, payload, { direct });
  if (reply.ok === true && reply.result?.ok === true) return true;
  // The relay already warned about a missing GM or socket; say why for everything else.
  if (!isNoGmReason(reply.reason)) {
    notify('warn', reply.reason === 'rejected'
      ? `You don't have permission to change the crew of ${vehicle.name}.`
      : `The crew change on ${vehicle.name} could not be applied.`);
  }
  return false;
}

/** The other vehicles an embark or take-the-wheel removes `ref` from (section 5.3); none for other ops. */
function otherVehiclesCarrying(ref, vehicle, op) {
  if (!ADDING_OPS.has(op)) return [];
  return vehiclesCarrying(ref).filter((v) => !sameVehicle(v, vehicle));
}

/**
 * The access syncs one crew change implies, as [vehicle, actor] pairs (section 5.5).
 * @param {Actor[]} left the other vehicles `ref` leaves
 * @returns {{ grants: Array<[Actor, Actor]>, revokes: Array<[Actor, Actor]> }}
 */
function accessChanges(vehicle, crew, plan, ref, actor, left) {
  const grants = [];
  const revokes = left.map((other) => [other, actor]);
  if (plan.removed) revokes.push([vehicle, actor]);
  if (plan.added) grants.push([vehicle, actor]);
  if (plan.crew.pilotUuid !== crew.pilotUuid) {
    const resolve = (uuid) => (uuid === ref ? actor : resolveActorByUuid(uuid));
    const newPilot = plan.crew.pilotUuid;
    if (newPilot && !(plan.added && newPilot === ref)) grants.push([vehicle, resolve(newPilot)]);
    const old = plan.previousPilot;
    if (old && !(plan.removed && old === ref)) revokes.push([vehicle, resolve(old)]);
  }
  const real = ([v, a]) => Boolean(v && a);
  return { grants: grants.filter(real), revokes: revokes.filter(real) };
}

/* -------------------------------------------- */
/*  GM relay                                    */
/* -------------------------------------------- */

const esc = (text) => (globalThis.foundry?.utils?.escapeHTML ? globalThis.foundry.utils.escapeHTML(String(text)) : String(text));

async function postLine(vehicle, content, ruleBreak) {
  const data = { speaker: globalThis.ChatMessage?.getSpeaker?.({ actor: vehicle }), content: `<p>${content}</p>` };
  if (ruleBreak) data.flags = { [SYSTEM_ID]: { ruleBreak: true } };
  try {
    await globalThis.ChatMessage?.create?.(ruleBreak ? ruleBreakMessageData(data) : data);
  } catch (err) {
    console.warn('Sprinter RPG | Could not post the vehicle crew line:', err);
  }
}

/** Grant or revoke, never failing the crew change: membership is the fact; reconcile repairs a missed grant. */
async function syncAccess(vehicle, actor, revoke) {
  if (!actor) return;
  try {
    await syncActorOwnership(vehicle, actor, { revoke });
  } catch (err) {
    console.warn('Sprinter RPG | Vehicle access sync failed:', err);
  }
}

let crewQueue = Promise.resolve();

/**
 * Run one crew write after every earlier one on this client has settled (the GM's apply and the deletion hooks).
 * Two relayed boards read and write the same `occupants` array; serialised, neither overwrites the other.
 * @template T
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
export function runCrewWrite(fn) {
  const run = crewQueue.then(fn);
  crewQueue = run.catch(() => {});
  return run;
}

const fromCompendium = (...docs) => docs.some((d) => Boolean(d?.pack));

async function applyCrewChange(payload) {
  const vehicle = resolveActorByUuid(payload?.vehicleUuid);
  const op = payload?.op;
  if (vehicle?.type !== 'mount_vehicle' || !OPS.has(op)) return { ok: false };
  const ref = asString(payload.actorUuid);
  const actor = resolveActorByUuid(ref);
  if (!ref || (!actor && ADDING_OPS.has(op)) || REFUSED_TYPES[actor?.type]) return { ok: false };
  if (fromCompendium(vehicle, actor)) return { ok: false };
  const role = sanitizeVehicleRole(payload.role);

  const crew = readCrew(vehicle.system);
  if (op === CREW_OPS.SET_ROLE && !crew.occupants.some((o) => o.uuid === ref)) return { ok: false };
  const others = otherVehiclesCarrying(ref, vehicle, op);
  const plan = planCrewChange(crew, op, ref, crewCapacity(vehicle.system), { role });
  const overCapacity = plan.added && plan.overCapacity;

  // Membership first (the GM judges "still aboard" from the documents): the target, then the section 5.3 removal, so
  // a failed removal leaves the actor in two vehicles, never in none. Access syncs run for whatever was written.
  const left = [];
  let wroteTarget = false;
  try {
    if (plan.changed) {
      await vehicle.update({ 'system.occupants': plan.crew.occupants, 'system.pilotUuid': plan.crew.pilotUuid });
    }
    wroteTarget = true;
    for (const other of others) {
      const out = planCrewChange(readCrew(other.system), CREW_OPS.DISEMBARK, ref, crewCapacity(other.system));
      if (!out.changed) continue;
      await other.update({ 'system.occupants': out.crew.occupants, 'system.pilotUuid': out.crew.pilotUuid });
      left.push(other);
    }

    const who = actor?.name ?? 'Someone';
    if (overCapacity) {
      await postLine(vehicle, `${esc(who)} boards ${esc(vehicle.name)} past its occupancy (${plan.aboard}/${plan.total}). Rule Break.`, true);
    }
    if (plan.replacedPilot) {
      const old = resolveActorByUuid(plan.replacedPilot)?.name ?? 'the previous driver';
      await postLine(vehicle, `${esc(who)} takes the wheel of ${esc(vehicle.name)} from ${esc(old)}.`, false);
    }
  } finally {
    if (wroteTarget) {
      const { grants, revokes } = accessChanges(vehicle, crew, plan, ref, actor, left);
      for (const [v, a] of grants) await syncAccess(v, a, false);
      for (const [v, a] of revokes) await syncAccess(v, a, true);
    }
  }

  return { ok: true, overCapacity, replacedPilot: plan.replacedPilot };
}

registerRelayAction(RELAY_ACTION_VEHICLE_CREW, {
  authorize: (payload, user) => {
    if (!user) return false;
    if (user.isGM) return true;
    const op = payload?.op;
    if (!OPS.has(op)) return false;
    const vehicle = resolveActorByUuid(payload?.vehicleUuid);
    if (vehicle?.type !== 'mount_vehicle') return false;
    const ref = asString(payload.actorUuid);
    const actor = resolveActorByUuid(ref);
    if (fromCompendium(vehicle, actor)) return false;
    // (ii) any op on an actor the user owns (boarding elsewhere only moves their own actor).
    if (actor && userOwnsActor(actor, user)) return true;
    // (i) the vehicle's owner, on any actor, but never pulling someone else's actor out of a vehicle they do not own.
    if (!userOwnsActor(vehicle, user)) return false;
    return otherVehiclesCarrying(ref, vehicle, op).every((v) => userOwnsActor(v, user));
  },
  apply: (payload) => runCrewWrite(() => applyCrewChange(payload))
});

/* -------------------------------------------- */
/*  Login reconcile                             */
/* -------------------------------------------- */

/**
 * Active GM only: grant every vehicle's occupants the access they should have, then lower recorded (system) grants
 * nobody is entitled to any more; ownership set by hand is never lowered. Repairs memberships and deletions applied
 * while no GM was connected.
 * @returns {Promise<number>} how many vehicles changed
 */
export async function reconcileVehicleOwnership() {
  if (!globalThis.game?.user?.isGM) return 0;
  let touched = 0;
  for (const vehicle of allVehicles()) {
    const before = JSON.stringify(vehicle.ownership || {});
    for (const { actor } of crewMembers(vehicle).occupants) await syncActorOwnership(vehicle, actor);
    await reconcileRecordedAccess(vehicle);
    if (JSON.stringify(vehicle.ownership || {}) !== before) touched++;
  }
  return touched;
}
