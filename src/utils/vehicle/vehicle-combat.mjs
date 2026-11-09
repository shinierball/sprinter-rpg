/**
 * Vehicle combat lookups (3.44e): the document-side readers that the vehicle rules in
 * `src/data/rules/vehicle-rules.mjs` need. Where an actor is aboard, whether it is driving, what a vehicle's
 * Difficulty is for an attack, what moving adds to an occupant's Evade, which DR protects an occupant, and when a
 * driver's hand is needed on the controls. Pure arithmetic stays in the rules file; nothing here writes or blocks.
 *
 * Imports the crew lookups only (no sheet, no `actor.mjs`), so roll-context and the damage collectors can use it.
 */
import { crewEntryOf, vehicleOf } from './vehicle-lookup.mjs';
import {
  attackDifficulty, occupantEvadeBuff, vehicleKindInfo, sanitizeVehicleKind
} from '../../data/rules/vehicle-rules.mjs';
import { VEHICLE_TAGS } from '../../data/tag-vocabulary.mjs';
import { getItemAllTags } from '../../documents/active-tags.mjs';
import { hasRuleFlag, RULE_FLAGS } from '../tag/tag-behaviour.mjs';
import { CHECK_TAGS } from '../tag/tag-mechanics.mjs';
import { calculateItemHandsRequired } from '../gear/wielding.mjs';
import { confirmRuleBreak } from '../rule-break.mjs';

const whole = (v) => {
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

const tagSetOf = (contextOrTags) => {
  const raw = contextOrTags && typeof contextOrTags === 'object' && !(contextOrTags instanceof Set) && !Array.isArray(contextOrTags)
    ? contextOrTags.tags
    : contextOrTags;
  return raw instanceof Set ? raw : new Set(Array.isArray(raw) ? raw : []);
};

/** The speed a vehicle declared: whole feet, 0 or more. */
function vehicleSpeedOf(vehicle) {
  return whole(vehicle?.system?.drive?.currentMove);
}

/** True when a context (or tag list) carries `situation.head_on`. */
export function isHeadOn(contextOrTags) {
  return tagSetOf(contextOrTags).has(VEHICLE_TAGS.headOn);
}

/**
 * Where an actor is in a vehicle.
 * @param {Actor|null} actor
 * @returns {{ vehicle: Actor, entry: { uuid: string, role: string, isPilot: boolean }, speed: number, driving: boolean }|null}
 *   null when the actor is not aboard (or is itself a vehicle); `driving` is the pilot of a vehicle whose speed is above 0 (554 a)
 */
export function aboardState(actor) {
  if (!actor || actor.type === 'mount_vehicle') return null;
  const vehicle = vehicleOf(actor);
  if (!vehicle) return null;
  const entry = crewEntryOf(vehicle, actor);
  if (!entry) return null;
  const speed = vehicleSpeedOf(vehicle);
  return { vehicle, entry, speed, driving: entry.isPilot === true && speed > 0 };
}

/**
 * The engine tags a roll by this actor carries because of the vehicle it is aboard: `situation.driving` for the driver
 * of a moving vehicle (554 a), and `role.<crew role>` (`role.pilot` for the driver) for anyone aboard.
 * @param {Actor|null} actor
 * @returns {string[]}
 */
export function vehicleRollTags(actor) {
  const state = aboardState(actor);
  if (!state) return [];
  const out = [];
  if (state.driving) out.push(VEHICLE_TAGS.driving);
  if (state.entry.role) out.push(`${VEHICLE_TAGS.rolePrefix}${state.entry.role}`);
  if (state.entry.isPilot) out.push(VEHICLE_TAGS.rolePilot);
  return [...new Set(out)];
}

/** The name the driver Disadvantage line carries: "Driving (vehicle name)". */
export function drivingLabel(actor) {
  const state = aboardState(actor);
  return `Driving (${state?.vehicle?.name || 'vehicle'})`;
}

/**
 * Whether an item belongs to the vehicle itself (a built-in weapon): its parent document is a `mount_vehicle`.
 * @param {object|null} item
 */
export function itemOwnedByVehicle(item) {
  return item?.parent?.type === 'mount_vehicle' || item?.actor?.type === 'mount_vehicle';
}

/**
 * The Difficulty an attack must meet against a vehicle (549 a, 546 a: 10 + speed / 5, 10 head-on).
 * @param {Actor} vehicle
 * @param {{ headOn?: boolean }} [options]
 */
export function vehicleEvadeDifficulty(vehicle, { headOn = false } = {}) {
  return attackDifficulty({ currentMove: vehicleSpeedOf(vehicle), headOn });
}

/**
 * What a moving vehicle adds to the Evade of someone aboard it: `{ amount, label, vehicle }`, or null when the actor is
 * not aboard or the Buff is 0 (stopped, slow, or head-on).
 * @param {Actor} actor
 * @param {{ headOn?: boolean }} [options]
 */
export function occupantEvadeLine(actor, { headOn = false } = {}) {
  const state = aboardState(actor);
  if (!state) return null;
  const amount = occupantEvadeBuff({ currentMove: state.speed, headOn });
  if (amount <= 0) return null;
  return { amount, label: `+${amount} moving vehicle`, vehicle: state.vehicle };
}

/**
 * The DR the vehicle gives someone aboard it, as a defense source: `{ dr, label, vehicle }`, or null. The explosion
 * (`vehicle.explosion` in the defense context) ignores it, since the occupants are inside the blast.
 * @param {Actor} actor
 * @param {Set<string>|string[]|object} [contextOrTags]
 */
export function vehicleDrFor(actor, contextOrTags = []) {
  if (!actor || actor.type === 'mount_vehicle') return null;
  if (tagSetOf(contextOrTags).has(VEHICLE_TAGS.explosion)) return null;
  const vehicle = vehicleOf(actor);
  if (!vehicle) return null;
  const dr = whole(vehicle.system?.attributes?.dr?.total);
  if (dr <= 0) return null;
  return { dr, label: `In ${vehicle.name || 'vehicle'}`, vehicle };
}


/**
 * A vehicle or an occupant as the target of an attack: the vehicle that decides its Difficulty.
 * @param {Actor|null} target
 * @returns {{ kind: 'vehicle'|'occupant', vehicle: Actor }|null}
 */
export function vehicleTargetOf(target) {
  if (!target) return null;
  if (target.type === 'mount_vehicle') return { kind: 'vehicle', vehicle: target };
  const vehicle = target.uuid ? vehicleOf(target) : null;
  return vehicle ? { kind: 'occupant', vehicle } : null;
}

/** The Evade Near Miss of 548 a: the occupant missed the Difficulty by 1 or 2 (a Natural 1 is a Critical Fail, not a near miss). */
export function isEvadeNearMiss({ total, dc, d20 = null } = {}) {
  if (d20 === 1) return false;
  const short = Number(dc) - Number(total);
  return Number.isFinite(short) && short >= 1 && short <= 2;
}

/**
 * The driver who "needs a hand on the controls" (a `oneHanded` kind) for a two-handed attack: the vehicle and kind label,
 * or null when no confirmation is owed (not a pilot, a kind that allows two hands, a one-handed or mounted-only weapon,
 * a weapon the vehicle itself carries).
 * @param {Actor} actor
 * @param {object} item the attack item
 * @param {{ handsRequired: number, wieldedOneHanded?: boolean }} info `handsRequired` from `calculateItemHandsRequired`
 * @returns {{ vehicle: Actor, kind: string, kindLabel: string }|null}
 */
export function driverHandsNeeded(actor, item, { handsRequired = 0, wieldedOneHanded = false } = {}) {
  if (handsRequired < 2 || wieldedOneHanded === true) return null;
  const state = aboardState(actor);
  if (!state?.entry.isPilot) return null;
  if (itemOwnedByVehicle(item)) return null;
  let tags;
  try { tags = new Set(getItemAllTags(item)); } catch { tags = new Set(); }
  if (hasRuleFlag(tags, RULE_FLAGS.mountedOnly)) return null;
  const kind = sanitizeVehicleKind(state.vehicle.system?.kind);
  const info = vehicleKindInfo(kind);
  if (!info?.oneHanded) return null;
  return { vehicle: state.vehicle, kind, kindLabel: info.label };
}

const localize = (key, fallback) => {
  const text = globalThis.game?.i18n?.localize?.(key);
  return text && text !== key ? text : fallback;
};

/** The actors an attack roll is aimed at: `options.targets`, `options.target`, else the user's targeted tokens. */
function attackTargetActors(options = {}) {
  let raw = [];
  if (Array.isArray(options.targets)) raw = options.targets;
  else if (options.target) raw = [options.target];
  else if (globalThis.game?.user?.targets) raw = [...globalThis.game.user.targets];
  return raw.filter(Boolean).map((t) => t.actor ?? t);
}

/**
 * The `situation.head_on` toggle a roll dialog offers (D11 a): an Evade made aboard a moving vehicle, or an attack with
 * a moving vehicle or one of its occupants among the targets. Shaped like `getOfferedSituations` entries.
 * @param {Actor|null} actor the roller
 * @param {object} context the roll's RollContext
 * @param {object} [options] the roll's options (explicit targets)
 * @returns {Array<{ tag: string, label: string, source: string, used: boolean }>}
 */
export function headOnOfferFor(actor, context, options = {}) {
  const tags = tagSetOf(context);
  if (tags.has(VEHICLE_TAGS.headOn)) return [];
  let relevant = false;
  if (tags.has(CHECK_TAGS.evade)) {
    relevant = (aboardState(actor)?.speed ?? 0) > 0;
  } else if (tags.has(CHECK_TAGS.attack) || tags.has(CHECK_TAGS.spell)) {
    relevant = attackTargetActors(options).some((t) => {
      const found = vehicleTargetOf(t);
      return found && vehicleSpeedOf(found.vehicle) > 0;
    });
  }
  if (!relevant) return [];
  return [{ tag: VEHICLE_TAGS.headOn, label: localize('COG.Vehicle.HeadOn.Label', 'Head-on or from behind (speed does not count)'), source: '', used: false }];
}

/**
 * The Rule Break gate for a two-handed attack by the driver of a `oneHanded` kind (never a block, GEMINI rule 2).
 * @param {Actor} actor the attacker
 * @param {object} item the attack item
 * @param {{ options?: object }} [params] the attack's options (`ruleBreak`, `interactive`, `wieldedOneHanded`)
 * @returns {Promise<{ proceed: boolean, ruleBreak: boolean, flags: object }>}
 */
export async function gateDriverHands(actor, item, { options = {} } = {}) {
  const need = driverHandsNeeded(actor, item, { handsRequired: calculateItemHandsRequired(item), wieldedOneHanded: options?.wieldedOneHanded === true });
  if (!need) return { proceed: true, ruleBreak: false, flags: {} };
  const i18n = globalThis.game?.i18n;
  const message = i18n?.format?.('COG.Vehicle.OneHanded.Message', { name: actor.name, kind: localize(need.kindLabel, need.kindLabel) })
    ?? `${actor.name} is driving a ${need.kindLabel} and needs a hand on the controls. Attack two-handed anyway as a Rule Break?`;
  const verdict = await confirmRuleBreak({ title: localize('COG.Vehicle.OneHanded.Title', 'Hand on the controls'), message, reason: message, options });
  if (!verdict.confirmed) return { proceed: false, ruleBreak: false, flags: {} };
  return { proceed: true, ruleBreak: true, flags: { ruleBreak: true } };
}

/**
 * The `data-item-uuid` attribute an attack card's damage button carries when the weapon belongs to another document than the
 * roller (a mounted weapon on the vehicle), so the button finds it. Empty for the roller's own item.
 * @param {Actor} actor the roller
 * @param {object} item the attack item
 * @returns {string}
 */
export function foreignItemAttr(actor, item) {
  const owner = item?.parent ?? item?.actor ?? null;
  if (!item?.uuid || !owner || owner === actor || (owner.uuid && owner.uuid === actor?.uuid)) return '';
  return ` data-item-uuid="${item.uuid}"`;
}
