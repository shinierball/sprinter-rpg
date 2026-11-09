/**
 * src/utils/vehicle/vehicle-check.mjs
 * `options.vehicle` on `rollSkill` / `rollStat`: a check made to drive, brake, board or ram a vehicle (3.44d).
 *
 * The reference is sanitised here (`sanitizeVehicleRef`), the roll adds the engine context tags (`check.vehicle` and
 * `vehicle.check.<kind>`), the vehicle's installed gear and active buffs join the roll's rows as extra sources (an
 * upgrade's check rows apply to this vehicle's checks, conditioned by their authors on `check.vehicle`), and the
 * check record is stamped with the reference so the GM can ingest the card (Table 6, braking, boarding).
 *
 * Imports no sheet and no Foundry global beyond the actor uuid lookup.
 */
import { resolveActorByUuid } from '../actor-uuid.mjs';
import { getActiveModifierSources } from '../roll/damage-modifiers.mjs';
import { shiftDegree, sanitizeVehicleCheckKind, VEHICLE_CHECK_KINDS, vehicleKindTag } from '../../data/rules/vehicle-rules.mjs';

const MAX_TARGETS = 20;

const text = (raw) => {
  let val = raw ?? '';
  if (Array.isArray(val)) val = val[0] ?? '';
  return typeof val === 'string' ? val.trim().slice(0, 160) : '';
};

/**
 * The vehicle reference of a roll's options, or null when the roll is not a vehicle check (an unknown kind or no
 * vehicle named).
 * @param {unknown} raw `options.vehicle`
 * @returns {{ vehicleUuid: string, kind: string, dc: number|null, targetUuids: string[], headOn: boolean, ram: boolean,
 *   skill: string, stat: string, rerollOf: string, rerollKey: string, tag: string }|null}
 */
export function sanitizeVehicleRef(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const kind = sanitizeVehicleCheckKind(text(raw.kind));
  const vehicleUuid = text(raw.vehicleUuid);
  if (!kind || !vehicleUuid) return null;
  const dcRaw = raw.dc === null || raw.dc === '' || typeof raw.dc === 'boolean' ? NaN : Number(raw.dc);
  const targets = Array.isArray(raw.targetUuids) ? raw.targetUuids : [];
  return {
    vehicleUuid,
    kind,
    dc: Number.isFinite(dcRaw) ? Math.trunc(dcRaw) : null,
    targetUuids: targets.filter((t) => typeof t === 'string' && t).slice(0, MAX_TARGETS),
    headOn: raw.headOn === true,
    ram: raw.ram === true,
    skill: text(raw.skill),
    stat: text(raw.stat),
    rerollOf: text(raw.rerollOf),
    rerollKey: text(raw.rerollKey),
    tag: VEHICLE_CHECK_KINDS[kind].tag
  };
}

/**
 * What a vehicle check adds to its roll, read at roll time.
 * @param {object} actor the roller
 * @param {ReturnType<typeof sanitizeVehicleRef>} ref
 * @returns {{ vehicle: object|null, tags: string[], extraSources: object[], advantage: string|null }} `advantage` is the
 *   Advantage line owed to the roller (the vehicle's `drive.advantageFor`), else null
 */
export function vehicleCheckSetup(actor, ref) {
  const vehicle = ref ? resolveActorByUuid(ref.vehicleUuid) : null;
  if (!vehicle || vehicle.type !== 'mount_vehicle') return { vehicle: null, tags: ref ? [ref.tag] : [], extraSources: [], advantage: null };
  // Boarding is a Dex Stat Check to get in, not a check to operate: the vehicle's gear and the owed Advantage stay out of it.
  if (ref.kind === 'board') return { vehicle, tags: [ref.tag], extraSources: [], advantage: null };
  const ramTag = VEHICLE_CHECK_KINDS.ram?.tag;
  const owed = typeof vehicle.system?.drive?.advantageFor === 'string' ? vehicle.system.drive.advantageFor : '';
  return {
    vehicle,
    tags: [ref.tag, ...(ref.ram && ref.tag !== ramTag ? [ramTag] : []), vehicleKindTag(vehicle.system?.kind)],
    extraSources: getActiveModifierSources(vehicle),
    advantage: owed && owed === actor?.uuid ? 'Amazing Success last time' : null
  };
}

/** The check tags of a vehicle check: `check.vehicle` joins the roll's own check key (boarding enters the vehicle, it does not operate it, so it has none). */
export function vehicleCheckKeys(base, ref) {
  const keys = Array.isArray(base) ? [...base] : [base];
  return ref && ref.kind !== 'board' ? [...keys, 'vehicle'] : keys;
}

/** The context fields a vehicle check adds (the extra row sources); spread onto the built context. */
export function withVehicleSources(context, setup) {
  return setup?.extraSources?.length ? { ...context, extraSources: setup.extraSources } : context;
}

/** The Difficulty a kind suggests for the dialog, or null when it asks. */
export function vehicleCheckDifficulty(kindId, state = {}) {
  const def = VEHICLE_CHECK_KINDS[sanitizeVehicleCheckKind(kindId)];
  if (!def) return null;
  const dc = def.difficulty(state);
  return Number.isFinite(dc) ? dc : null;
}

/**
 * The stored shifts of a card applied to its rolled degree, in order. A shift is `{ rowKey, steps, failOnly }`.
 * @param {string} outcome a COG_ROLL_OUTCOMES id
 * @param {Array<{ steps?: number, failOnly?: boolean }>} shifts
 */
export function applyShifts(outcome, shifts) {
  let id = outcome;
  for (const s of Array.isArray(shifts) ? shifts : []) id = shiftDegree(id, Number(s?.steps) || 1, { failOnly: s?.failOnly !== false });
  return id;
}

/** A shift list from a stored flag: plain objects with a row key, at most 10. */
export function sanitizeShifts(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((s) => s && typeof s === 'object' && typeof s.rowKey === 'string' && s.rowKey)
    .map((s) => ({ rowKey: s.rowKey.slice(0, 200), steps: Math.max(1, Math.trunc(Number(s.steps)) || 1), failOnly: s.failOnly !== false }))
    .slice(0, 10);
}
