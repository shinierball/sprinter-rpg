/**
 * src/data/rules/vehicle-crew-rules.mjs
 * Pure rules for who is aboard a `mount_vehicle`. No Foundry globals.
 *
 * Membership lives on the vehicle by actor UUID: `pilotUuid` plus `occupants: [{ uuid, role, ruleBreak }]`. The driver
 * is always one of the occupants (the book's occupancy counts the driver); who drives is `pilotUuid` alone, never a
 * role. A role is a registry id (`VEHICLE_ROLES`, exposed as `CONFIG.COG.vehicleRoles`): shown and stored, read by no
 * mechanic yet. Nothing here throws or blocks (CONTRIBUTING rule 2): over-capacity is reported, the caller asks for a Rule Break.
 */
import { firstScalar } from '../../utils/first-scalar.mjs';

export const DEFAULT_VEHICLE_ROLE = 'passenger';

/** @typedef {{ id: string, label: string, hint?: string }} VehicleRoleDef */

/** @type {Record<string, VehicleRoleDef>} The registry. `CONFIG.COG.vehicleRoles === VEHICLE_ROLES`. */
export const VEHICLE_ROLES = {};

const ROLE_ID = /^[A-Za-z][\w.-]*$/;

/** First entry of an array, first item of a comma string, trimmed; anything else is ''. (CONTRIBUTING §4.) */
function trimmedScalar(raw) {
  const val = firstScalar(raw);
  return typeof val === 'string' ? val.trim() : '';
}

/**
 * Add a role. Modules prefix theirs ('my-module.navigator'). A bad id or a missing label is refused with a warning.
 * @param {VehicleRoleDef} def
 * @returns {boolean} whether it was registered
 */
export function registerVehicleRole(def) {
  const id = def?.id;
  const label = typeof def?.label === 'string' ? def.label.trim() : '';
  if (typeof id !== 'string' || !ROLE_ID.test(id) || !label) {
    console.warn(`Sprinter RPG | Vehicle role ${String(id)} was not registered: it needs a well-formed id and a label.`);
    return false;
  }
  VEHICLE_ROLES[id] = { ...def, id, label };
  return true;
}

registerVehicleRole({ id: DEFAULT_VEHICLE_ROLE, label: 'Passenger', hint: 'Anybody aboard who is not driving.' });
registerVehicleRole({ id: 'gunner', label: 'Gunner', hint: 'No rule effect yet; reserved for mounted weapons.' });

/** A role id from user input: sanitised, and an unregistered id becomes 'passenger'. @returns {string} a registered id */
export function sanitizeVehicleRole(raw) {
  const id = trimmedScalar(raw);
  return Object.hasOwn(VEHICLE_ROLES, id) ? id : DEFAULT_VEHICLE_ROLE;
}

/** The definition to show or apply; an unregistered or malformed id falls back to the 'passenger' definition. */
export function vehicleRoleInfo(id) {
  const key = trimmedScalar(id);
  return VEHICLE_ROLES[Object.hasOwn(VEHICLE_ROLES, key) ? key : DEFAULT_VEHICLE_ROLE];
}

/** Select options in registry order, `selected` precomputed (CONTRIBUTING §5). */
export function vehicleRoleOptions(selectedId) {
  const selected = sanitizeVehicleRole(selectedId);
  return Object.values(VEHICLE_ROLES).map(({ id, label, hint }) => ({ id, label, hint: hint ?? '', selected: id === selected }));
}

/**
 * The options of a role `<select>` for a stored role id. A well-formed id that is not registered (its module is
 * disabled) gets an extra disabled "Unknown role" option that carries `selected`, so the stored value stays visible.
 */
export function vehicleRoleSelectOptions(storedId) {
  const id = trimmedScalar(storedId);
  if (!id || !ROLE_ID.test(id) || Object.hasOwn(VEHICLE_ROLES, id)) return vehicleRoleOptions(id);
  const known = vehicleRoleOptions(id).map((o) => ({ ...o, selected: false, disabled: false }));
  return [...known, { id, label: `Unknown role (${id})`, hint: '', selected: true, disabled: true }];
}

export const CREW_OPS = Object.freeze({
  EMBARK: 'embark', DISEMBARK: 'disembark', TAKE_WHEEL: 'takeWheel', STEP_DOWN: 'stepDown', SET_ROLE: 'setRole'
});

const OP_IDS = new Set(Object.values(CREW_OPS));

/** A stored role: a well-formed id is kept as is (even unregistered); missing or malformed becomes 'passenger'. */
function storedRole(raw) {
  const id = trimmedScalar(raw);
  return ROLE_ID.test(id) ? id : DEFAULT_VEHICLE_ROLE;
}

/** @returns {{ pilotUuid: string, occupants: { uuid: string, role: string, ruleBreak: boolean }[] }} */
function cleanCrew(source) {
  const seen = new Set();
  const occupants = [];
  const raw = Array.isArray(source?.occupants) ? source.occupants : [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const uuid = typeof entry.uuid === 'string' ? entry.uuid.trim() : '';
    if (!uuid || seen.has(uuid)) continue;
    seen.add(uuid);
    occupants.push({ uuid, role: storedRole(entry.role), ruleBreak: entry.ruleBreak === true });
  }
  const pilot = typeof source?.pilotUuid === 'string' ? source.pilotUuid.trim() : '';
  return { pilotUuid: seen.has(pilot) ? pilot : '', occupants };
}

/**
 * Sanitised crew from a vehicle's system data: unique non-empty uuids, pilot cleared unless aboard.
 * @param {object} system a `mount_vehicle`'s `system`
 */
export function readCrew(system) {
  return cleanCrew(system);
}

function count(raw) {
  const n = Math.floor(Number(raw));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Seat limits. seats 0 = no limit. @returns {{ seats: number, cargo: number, total: number, limited: boolean }} */
export function crewCapacity(system) {
  const seats = count(system?.attributes?.occupancy);
  const cargo = count(system?.attributes?.cargoOccupancy);
  return { seats, cargo, total: seats + cargo, limited: seats > 0 };
}

/**
 * The crew after one op for one ref. Never throws, never blocks.
 * embark: add if absent with role = sanitizeVehicleRole(opts.role); an aboard ref is a no-op (use setRole).
 * takeWheel: add if absent (same role rule), then pilot = ref; the old driver stays aboard with their role.
 * stepDown: pilot = '' if ref is the pilot. disembark: remove ref; pilot = '' if it was ref.
 * setRole: role = sanitizeVehicleRole(opts.role) if ref is aboard; an absent ref or the same role is a no-op.
 * A newly added entry gets ruleBreak = (limited && aboard after the add > total). Roles never affect the seat count.
 * @returns {{ crew: object, changed: boolean, added: boolean, removed: boolean, overCapacity: boolean, aboard: number,
 *   total: number, replacedPilot: string, previousPilot: string }}
 */
export function planCrewChange(crew, op, ref, capacity, opts = {}) {
  const before = cleanCrew(crew);
  const uuid = trimmedScalar(ref);
  const cap = capacity && typeof capacity === 'object' ? capacity : crewCapacity(null);
  const limited = cap.limited === true;
  const total = count(cap.total);
  const next = { pilotUuid: before.pilotUuid, occupants: before.occupants.map((o) => ({ ...o })) };
  const state = { changed: false, added: false, removed: false, replacedPilot: '', previousPilot: '' };
  const index = () => next.occupants.findIndex((o) => o.uuid === uuid);
  const addIfAbsent = () => {
    if (index() !== -1) return;
    next.occupants.push({ uuid, role: sanitizeVehicleRole(opts?.role), ruleBreak: limited && next.occupants.length + 1 > total });
    state.added = true;
    state.changed = true;
  };
  const setPilot = (pilot) => {
    if (next.pilotUuid === pilot) return;
    state.previousPilot = next.pilotUuid;
    next.pilotUuid = pilot;
    state.changed = true;
  };

  if (uuid && OP_IDS.has(op)) {
    if (op === CREW_OPS.EMBARK) addIfAbsent();
    else if (op === CREW_OPS.TAKE_WHEEL) {
      addIfAbsent();
      if (next.pilotUuid !== uuid) {
        const old = next.pilotUuid;
        setPilot(uuid);
        state.replacedPilot = old;
      }
    } else if (op === CREW_OPS.STEP_DOWN) {
      if (next.pilotUuid === uuid) setPilot('');
    } else if (op === CREW_OPS.DISEMBARK) {
      const i = index();
      if (i !== -1) {
        next.occupants.splice(i, 1);
        state.removed = true;
        state.changed = true;
        if (next.pilotUuid === uuid) setPilot('');
      }
    } else if (op === CREW_OPS.SET_ROLE) {
      const i = index();
      const role = sanitizeVehicleRole(opts?.role);
      if (i !== -1 && next.occupants[i].role !== role) {
        next.occupants[i].role = role;
        state.changed = true;
      }
    }
  }

  const aboard = next.occupants.length;
  return { crew: next, ...state, overCapacity: limited && aboard > total, aboard, total };
}

/** True when op would add ref past the limit (the client asks for a Rule Break first). setRole never overfills. */
export function wouldOverfill(crew, op, ref, capacity) {
  if (op !== CREW_OPS.EMBARK && op !== CREW_OPS.TAKE_WHEEL) return false;
  const plan = planCrewChange(crew, op, ref, capacity);
  return plan.added && plan.overCapacity;
}
