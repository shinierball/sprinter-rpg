/**
 * Vehicle lookups: which vehicles exist, which carry an actor, and where an actor stands in a crew. Split out of
 * `vehicle-crew.mjs` (3.44e) because the roll collectors need them and must not import the crew writers, whose imports
 * reach the data models before the test harness has defined its Foundry globals. `vehicle-crew.mjs` re-exports them.
 *
 * Imports only the pure crew rules.
 */
import { readCrew } from '../../data/rules/vehicle-crew-rules.mjs';

const asString = (v) => (typeof v === 'string' ? v.trim() : '');

const listOf = (c) => {
  if (!c) return [];
  return Array.isArray(c) ? c : (Array.isArray(c.contents) ? c.contents : Array.from(c.values?.() || c));
};

/** World actors of type `mount_vehicle`. */
function worldVehicles() {
  return listOf(globalThis.game?.actors).filter((x) => x?.type === 'mount_vehicle');
}

/**
 * Vehicles that exist only as unlinked tokens: the synthetic actor of every unlinked
 * `mount_vehicle` token on every scene. Each copy carries its own crew (in its ActorDelta). A linked token's actor is
 * the world actor, already in `worldVehicles()`.
 */
function tokenVehicles() {
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

/** This actor's `{ uuid, role, ruleBreak, isPilot }` in `vehicle`, or null when not aboard. */
export function crewEntryOf(vehicle, actor) {
  const ref = asString(actor?.uuid);
  const crew = readCrew(vehicle?.system);
  const entry = ref ? crew.occupants.find((o) => o.uuid === ref) : null;
  return entry ? { ...entry, isPilot: entry.uuid === crew.pilotUuid } : null;
}
