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
import { confirmRuleBreak, getRuleBreakMode, RULE_BREAK_MODES, RULE_BREAK_REFUSALS } from '../../utils/rule-break.mjs';
import { readCheckRecord, effectiveCheck, isSuccessOutcome } from '../../utils/roll/check-assists.mjs';
import { hasRecordedAccess, reconcileRecordedAccess, syncActorOwnership } from './ownership-relay.mjs';
import { userOwnsActor } from './personal-space-links.mjs';
import { SYSTEM_ID } from '../../constants.mjs';
import {
  CREW_OPS, crewCapacity, planCrewChange, readCrew, sanitizeVehicleRole, vehicleRoleInfo, wouldOverfill
} from '../../data/rules/vehicle-crew-rules.mjs';
import { boardDifficulty } from '../../data/rules/vehicle-rules.mjs';

export const RELAY_ACTION_VEHICLE_CREW = 'vehicleCrew';

const OPS = new Set(Object.values(CREW_OPS));
const ADDING_OPS = new Set([CREW_OPS.EMBARK, CREW_OPS.TAKE_WHEEL]);
const ROLE_OPS = new Set([CREW_OPS.EMBARK, CREW_OPS.TAKE_WHEEL, CREW_OPS.SET_ROLE]);
/** Actor types that cannot be aboard (section 5.2), with the word shown in the notification. */
export const REFUSED_TYPES = Object.freeze({ mount_vehicle: 'vehicle', personal_space: 'personal space', marker: 'marker' });

const asString = (v) => (typeof v === 'string' ? v.trim() : '');

import { allVehicles, crewEntryOf, vehicleOf, vehicleUuidOf, vehiclesCarrying } from '../../utils/vehicle/vehicle-lookup.mjs';

export { crewEntryOf, vehicleOf, vehicleUuidOf, vehiclesCarrying };

/** The actor driving this vehicle, or null (no pilot, an unresolved uuid, or a pilot that is itself a vehicle). */
export function driverOf(vehicle) {
  const uuid = typeof vehicle?.system?.pilotUuid === 'string' ? vehicle.system.pilotUuid.trim() : '';
  if (!uuid) return null;
  const driver = resolveActorByUuid(uuid);
  return driver && driver.type !== 'mount_vehicle' ? driver : null;
}

const sameVehicle = (a, b) => Boolean(a && b) && vehicleUuidOf(a) === vehicleUuidOf(b);

/* -------------------------------------------- */
/*  Lookups                                     */
/* -------------------------------------------- */

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

/* -------------------------------------------- */
/*  Client entry point                          */
/* -------------------------------------------- */

function notify(level, message) {
  globalThis.ui?.notifications?.[level]?.(message);
}

const BOARD_CHOICES = Object.freeze(['roll', 'waive', 'cancel']);

/** Ask how to board a moving vehicle: roll Dex, board without a check (a Rule Break), or cancel. A preset `boardCheck` answers. */
async function askBoardChoice(vehicle, actor, speed, dc, preset) {
  if (BOARD_CHOICES.includes(preset)) return preset;
  const DialogV2 = globalThis.foundry?.applications?.api?.DialogV2;
  if (typeof DialogV2?.wait !== 'function') return 'cancel';
  const i18n = globalThis.game?.i18n;
  const text = (key, fallback, data) => {
    const s = data ? i18n?.format?.(key, data) : i18n?.localize?.(key);
    return typeof s === 'string' && s && s !== key ? s : fallback;
  };
  try {
    const answer = await DialogV2.wait({
      window: { title: text('COG.VehicleBoard.Title', 'Board a moving vehicle') },
      content: `<p>${esc(text('COG.VehicleBoard.Message', `${vehicle.name} is moving (${speed} ft). Board with a Dex check (Difficulty ${dc})?`, { name: vehicle.name, speed, dc }))}</p>`,
      buttons: [
        { action: 'roll', label: text('COG.VehicleBoard.Roll', 'Roll Dex'), default: true },
        { action: 'waive', label: text('COG.VehicleBoard.Waive', 'Board without a check (Rule Break)') },
        { action: 'cancel', label: text('COG.VehicleBoard.Cancel', 'Cancel') }
      ],
      rejectClose: false,
      modal: true
    });
    return BOARD_CHOICES.includes(answer) ? answer : 'cancel';
  } catch {
    return 'cancel';
  }
}

/**
 * Boarding a moving vehicle (3.44d): a stationary vehicle boards as ever; a moving one asks for a Dex check (Difficulty
 * 10 + half the speed), or lets the boarder come aboard as a Rule Break. A failed check leaves them off and the card offers
 * the GM "Board anyway". Never a hard block.
 * @returns {Promise<{ proceed: boolean, ruleBreak: boolean }>}
 */
async function boardingGate(vehicle, actor, op, crew, ref, opts) {
  const aboard = crew.occupants.some((o) => o.uuid === ref);
  const dc = ADDING_OPS.has(op) && !aboard ? boardDifficulty(vehicle.system?.drive?.currentMove) : null;
  if (dc === null) return { proceed: true, ruleBreak: false };
  if (opts.boardCheck === 'skip') return { proceed: true, ruleBreak: opts.boardRuleBreak === true };
  const choice = await askBoardChoice(vehicle, actor, vehicle.system.drive.currentMove, dc, opts.boardCheck);
  if (choice === 'cancel') return { proceed: false, ruleBreak: false };
  if (choice === 'waive') {
    if (getRuleBreakMode() === RULE_BREAK_MODES.REFUSE) {
      notify('warn', `The GM does not allow boarding ${vehicle.name} without a check.`);
      return { proceed: false, ruleBreak: false };
    }
    return { proceed: true, ruleBreak: true };
  }
  const message = await actor.rollStat?.('dex', { vehicle: { vehicleUuid: vehicleUuidOf(vehicle), kind: 'board', dc } });
  const record = message ? readCheckRecord(message) : null;
  const made = Boolean(record) && isSuccessOutcome(effectiveCheck(record)?.outcome);
  if (!made) {
    if (message) notify('warn', `${actor.name} did not make it aboard ${vehicle.name}. The GM may let them board anyway.`);
    return { proceed: false, ruleBreak: false };
  }
  return { proceed: true, ruleBreak: false };
}

/**
 * Change one actor's place or role in a vehicle. Asks for a Rule Break when the op would overfill the vehicle.
 * @param {Actor} vehicle  a mount_vehicle
 * @param {Actor|string} actorOrUuid  the occupant
 * @param {'embark'|'disembark'|'takeWheel'|'stepDown'|'setRole'} op
 * @param {{ role?: string, interactive?: boolean, ruleBreak?: boolean, boardCheck?: string, boardRuleBreak?: boolean }} [options]
 *   role: for setRole (required) and embark/takeWheel (optional, default 'passenger'). interactive and ruleBreak
 *   go to confirmRuleBreak. boardCheck: 'roll' | 'waive' | 'cancel' answers the moving-vehicle prompt, 'skip' (with
 *   boardRuleBreak) is the GM's "Board anyway".
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

  const boarding = await boardingGate(vehicle, actor, op, crew, ref, opts);
  if (!boarding.proceed) return false;

  const user = globalThis.game?.user;
  const others = otherVehiclesCarrying(ref, vehicle, op);
  const plan = planCrewChange(crew, op, ref, capacity, { role });
  // Direct only when the user can write every vehicle AND nothing would be revoked: a deferred revoke never runs.
  const { revokes } = accessChanges(vehicle, crew, plan, ref, actor, others);
  const direct = Boolean(user?.isGM || ([vehicle, ...others].every((v) => userOwnsActor(v, user))
    && !revokes.some(([v, a]) => hasRecordedAccess(v, a))));
  const payload = { vehicleUuid: vehicleUuidOf(vehicle), actorUuid: ref, op };
  if (ROLE_OPS.has(op)) payload.role = role;
  if (boarding.ruleBreak) payload.boardRuleBreak = true;
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
    // A moving vehicle (the GM reads its speed from the document) and a boarder as large as the vehicle get a line of their own.
    const speed = Number(vehicle.system?.drive?.currentMove) || 0;
    const tight = plan.added && Number(actor?.system?.attributes?.sizeNumber) >= Number(vehicle.system?.attributes?.sizeNumber);
    if (plan.added && (speed > 0 || tight)) {
      const parts = [];
      if (speed > 0) {
        parts.push(`${esc(who)} boards ${esc(vehicle.name)} while it is moving (${speed} ft).`);
        if (globalThis.game?.combat?.started) parts.push('Boarding uses 10 ft of Move (a Step will do).');
        if (payload.boardRuleBreak === true) parts.push('Boarded without a passing check. Rule Break.');
      }
      if (tight) parts.push(`${esc(who)} is as large as ${esc(vehicle.name)}: it is going to be a tight fit.`);
      await postLine(vehicle, parts.join(' '), speed > 0 && payload.boardRuleBreak === true);
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
