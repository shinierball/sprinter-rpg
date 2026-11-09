/**
 * src/data/rules/vehicle-rules.mjs
 * Pure vehicle rules. No Foundry globals, no document code.
 *
 * Registries (each is also `CONFIG.COG.<name>`, the same object, so a module adds to it with the register functions):
 * vehicle kinds (`vehicleKinds`), check results by degree (`vehicleCheckResults`), vehicle check kinds
 * (`vehicleCheckKinds`), upgrade kinds (`vehicleUpgradeKinds`) and the roll penalties a `waive` row may name
 * (`rollPenalties`). Then the arithmetic of the vehicle rules. Nothing here blocks anything (CONTRIBUTING rule 2).
 */
import { COG_ROLL_OUTCOMES } from '../../documents/session/roll-outcomes.mjs';
import { matchesTagQuery, normalizeTagList } from '../../utils/tag/tag-query.mjs';
import { VEHICLE_TAGS } from '../tag-vocabulary.mjs';
import { addWaivableRollPenalty } from '../../utils/row-kinds.mjs';
import { firstScalar } from '../../utils/first-scalar.mjs';

export const DEFAULT_VEHICLE_KIND = 'wheeled';
const DEFAULT_VEHICLE_SIZE_NUMBER = 4;
const VEHICLE_HEALTH_BARS = 10;
const EXPLOSION_DAMAGE_TYPE = 'fire';
/** The engine flows a vehicle check kind may resolve through (the sheet and card code switch on these ids). */
const VEHICLE_RESOLVE_FLOWS = Object.freeze(['table6', 'stop', 'ram', 'board', 'evade', 'none']);

const ID_PATTERN = /^[a-z][a-z0-9_.-]*$/;

/** First entry of an array, first item of a comma string, trimmed; anything else is ''. (CONTRIBUTING rule 4.) */
function trimmedScalar(raw) {
  const val = firstScalar(raw);
  return typeof val === 'string' ? val.trim() : '';
}

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const cleanLabel = (v) => (typeof v === 'string' ? v.trim() : '');
/** A whole number of feet or points, 0 or more; anything unreadable is 0. */
const wholeNumber = (v) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

function refuse(what, id, why) {
  console.warn(`Sprinter RPG | ${what} ${String(id)} was not registered: ${why}.`);
  return false;
}

// ---------------------------------------------------------------------------------------------------------------
// Vehicle kinds
// ---------------------------------------------------------------------------------------------------------------

/**
 * @typedef {object} VehicleKindDef
 * @property {string} id         /^[a-z][a-z0-9_.-]*$/ ; modules prefix theirs
 * @property {string} label      lang key or text
 * @property {string} [hint]
 * @property {object} skills     tag query for the skill that drives it (matchesTagQuery over the skill item's tags)
 * @property {boolean} [oneHanded] the driver keeps one hand on the controls: a two-handed attack while driving asks a Rule Break
 */
/** @type {Record<string, VehicleKindDef>} The registry. `CONFIG.COG.vehicleKinds === VEHICLE_KINDS`. */
export const VEHICLE_KINDS = {};

/** Why a definition is not a vehicle kind, or '' when it is valid. */
export function vehicleKindProblem(def) {
  if (!isPlainObject(def)) return 'the definition is not an object';
  if (typeof def.id !== 'string' || !ID_PATTERN.test(def.id)) return 'the id is not a valid vehicle kind id';
  if (!cleanLabel(def.label)) return 'a label is required';
  if (!isPlainObject(def.skills) && !(typeof def.skills === 'string' && def.skills.trim())) return 'skills must be a tag query';
  return '';
}

/**
 * Add (or replace) a vehicle kind. A bad definition is refused with one warning.
 * @param {VehicleKindDef} def
 * @returns {boolean} whether it was registered
 */
export function registerVehicleKind(def) {
  const problem = vehicleKindProblem(def);
  if (problem) return refuse('Vehicle kind', def?.id, problem);
  VEHICLE_KINDS[def.id] = {
    id: def.id,
    label: cleanLabel(def.label),
    ...(def.hint ? { hint: String(def.hint) } : {}),
    skills: def.skills,
    oneHanded: def.oneHanded === true
  };
  return true;
}

registerVehicleKind({ id: 'wheeled', label: 'COG.Vehicle.Kind.wheeled', hint: 'COG.Vehicle.Kind.wheeledHint', skills: { any: [VEHICLE_TAGS.skillDriving] } });
registerVehicleKind({ id: 'two_wheeled', label: 'COG.Vehicle.Kind.two_wheeled', hint: 'COG.Vehicle.Kind.two_wheeledHint', skills: { any: [VEHICLE_TAGS.skillChopper] }, oneHanded: true });
registerVehicleKind({ id: 'other', label: 'COG.Vehicle.Kind.other', hint: 'COG.Vehicle.Kind.otherHint', skills: { any: [VEHICLE_TAGS.skillDriving, VEHICLE_TAGS.skillChopper] } });

/** A kind id from user input: sanitised, and an unregistered id becomes the default ('wheeled'). @returns {string} a registered id */
export function sanitizeVehicleKind(raw) {
  const id = trimmedScalar(raw);
  if (Object.hasOwn(VEHICLE_KINDS, id)) return id;
  return Object.hasOwn(VEHICLE_KINDS, DEFAULT_VEHICLE_KIND) ? DEFAULT_VEHICLE_KIND : (Object.keys(VEHICLE_KINDS)[0] ?? DEFAULT_VEHICLE_KIND);
}

/** The definition to show or apply; an unregistered id reads as the default kind. */
export function vehicleKindInfo(id) {
  return VEHICLE_KINDS[sanitizeVehicleKind(id)];
}

/** The derived tag a vehicle of this kind carries: `vehicle.kind.<id>` (the id is sanitised first). */
export function vehicleKindTag(id) {
  return `${VEHICLE_TAGS.kindPrefix}${sanitizeVehicleKind(id)}`;
}

/** Select options in registry order, `selected` precomputed (CONTRIBUTING rule 5). */
export function vehicleKindOptions(selectedId) {
  const selected = sanitizeVehicleKind(selectedId);
  return Object.values(VEHICLE_KINDS).map(({ id, label, hint }) => ({ id, label, hint: hint ?? '', selected: id === selected }));
}

/**
 * The tag query that finds the skill driving a vehicle: its own override when it has one, else its kind's.
 * @param {{ kind?: string, operateSkills?: object|null }} vehicleSystem a vehicle's `system` (or the two fields)
 * @returns {object|string}
 */
export function operateQueryFor(vehicleSystem) {
  const own = vehicleSystem?.operateSkills;
  if (isPlainObject(own) && Object.keys(own).length) return own;
  return vehicleKindInfo(vehicleSystem?.kind).skills;
}

// ---------------------------------------------------------------------------------------------------------------
// Table 6: vehicle check results
// ---------------------------------------------------------------------------------------------------------------

/**
 * @typedef {object} VehicleResultDef
 * @property {string} label           our words (lang key)
 * @property {{ multiply?: number, add?: number }} [move]   applied to the rated Move this round; default { multiply: 1 }
 * @property {number} [damagePercent]  share of max HP the vehicle loses
 * @property {boolean} [nextAdvantage] the driver's next check to operate this vehicle has Advantage
 * @property {number} [aiFavor]        AI Favor the driver gains
 * @property {Array<{ id: string, label: string, move?: object, aiFavor?: number }>} [choices]  the driver picks one; the first is the default
 */
/** @type {Record<string, VehicleResultDef>} Keyed by `COG_ROLL_OUTCOMES` id. `CONFIG.COG.vehicleCheckResults === VEHICLE_CHECK_RESULTS`. */
export const VEHICLE_CHECK_RESULTS = {};

const DEGREES = new Set(Object.values(COG_ROLL_OUTCOMES).filter((d) => d !== COG_ROLL_OUTCOMES.PENDING));

function cleanMove(move) {
  if (!isPlainObject(move)) return null;
  const out = {};
  if (move.multiply !== undefined) {
    const m = Number(move.multiply);
    if (!(Number.isFinite(m) && m >= 0)) return undefined;
    out.multiply = m;
  }
  if (move.add !== undefined) {
    const a = Number(move.add);
    if (!Number.isFinite(a)) return undefined;
    out.add = a;
  }
  return out;
}

/**
 * Set what a check result does to the vehicle.
 * @param {string} degree a COG_ROLL_OUTCOMES id (not pending)
 * @param {VehicleResultDef} def
 * @returns {boolean} whether it was registered
 */
export function registerVehicleCheckResult(degree, def) {
  const label = cleanLabel(def?.label);
  if (typeof degree !== 'string' || !DEGREES.has(degree)) return refuse('Vehicle check result', degree, 'the degree is not a roll outcome');
  if (!label) return refuse('Vehicle check result', degree, 'a label is required');
  const entry = { label };
  if (def.move !== undefined) {
    const move = cleanMove(def.move);
    if (!move) return refuse('Vehicle check result', degree, 'move must be { multiply, add } with finite numbers');
    entry.move = move;
  }
  if (def.damagePercent !== undefined) {
    const pct = Number(def.damagePercent);
    if (!(Number.isFinite(pct) && pct >= 0 && pct <= 100)) return refuse('Vehicle check result', degree, 'damagePercent must be 0 to 100');
    entry.damagePercent = pct;
  }
  if (def.nextAdvantage !== undefined) entry.nextAdvantage = def.nextAdvantage === true;
  if (def.aiFavor !== undefined) entry.aiFavor = wholeNumber(def.aiFavor);
  if (def.choices !== undefined) {
    const seen = new Set();
    const choices = [];
    for (const c of Array.isArray(def.choices) ? def.choices : []) {
      const id = typeof c?.id === 'string' ? c.id.trim() : '';
      const cl = cleanLabel(c?.label);
      if (!id || !cl || seen.has(id)) return refuse('Vehicle check result', degree, 'every choice needs a unique id and a label');
      const move = c.move === undefined ? undefined : cleanMove(c.move);
      if (c.move !== undefined && !move) return refuse('Vehicle check result', degree, 'a choice move must be { multiply, add } with finite numbers');
      seen.add(id);
      choices.push({ id, label: cl, ...(move ? { move } : {}), ...(c.aiFavor !== undefined ? { aiFavor: wholeNumber(c.aiFavor) } : {}) });
    }
    if (!choices.length) return refuse('Vehicle check result', degree, 'choices must not be empty');
    entry.choices = choices;
  }
  VEHICLE_CHECK_RESULTS[degree] = entry;
  return true;
}

const R = 'COG.Vehicle.Result.';
registerVehicleCheckResult(COG_ROLL_OUTCOMES.CRITICAL_SUCCESS, {
  label: `${R}critical_success`,
  choices: [{ id: 'boost', label: `${R}boost`, move: { multiply: 1.5 } }, { id: 'favor', label: `${R}favor`, aiFavor: 1 }]
});
registerVehicleCheckResult(COG_ROLL_OUTCOMES.AMAZING_SUCCESS, { label: `${R}amazing_success`, move: { multiply: 1 }, nextAdvantage: true });
registerVehicleCheckResult(COG_ROLL_OUTCOMES.SUCCESS, { label: `${R}success`, move: { multiply: 1 } });
registerVehicleCheckResult(COG_ROLL_OUTCOMES.NEAR_MISS, { label: `${R}near_miss`, move: { add: -5 } });
registerVehicleCheckResult(COG_ROLL_OUTCOMES.FAILURE, { label: `${R}failure`, move: { multiply: 0.5 } });
registerVehicleCheckResult(COG_ROLL_OUTCOMES.MAJOR_FAILURE, { label: `${R}major_failure`, move: { multiply: 0.5 }, damagePercent: 10 });
registerVehicleCheckResult(COG_ROLL_OUTCOMES.CRITICAL_FAILURE, { label: `${R}critical_failure`, move: { multiply: 0 }, damagePercent: 30 });

const warnedDegrees = new Set();

/**
 * What a result does, with a Critical choice applied. An unknown or missing degree reads as `success` (one warning per
 * id); an unknown choice reads as the first one.
 * @returns {{ outcome: string, label: string, move: { multiply: number, add: number }, damagePercent: number,
 *   nextAdvantage: boolean, aiFavor: number, choice: string, choices: object[] }}
 */
export function resultEffect(outcome, choice) {
  let id = trimmedScalar(outcome);
  if (!Object.hasOwn(VEHICLE_CHECK_RESULTS, id)) {
    if (id && !warnedDegrees.has(id)) {
      warnedDegrees.add(id);
      console.warn(`Sprinter RPG | No vehicle check result is registered for "${id}"; reading it as success.`);
    }
    id = 'success';
  }
  const def = VEHICLE_CHECK_RESULTS[id] ?? { label: `${R}success`, move: { multiply: 1 } };
  const choices = def.choices ?? [];
  const wanted = trimmedScalar(choice);
  const picked = choices.length ? (choices.find((c) => c.id === wanted) ?? choices[0]) : null;
  const move = picked?.move ?? def.move ?? { multiply: 1 };
  return {
    outcome: id,
    label: def.label,
    move: { multiply: move.multiply ?? 1, add: move.add ?? 0 },
    damagePercent: def.damagePercent ?? 0,
    nextAdvantage: def.nextAdvantage === true,
    aiFavor: picked?.aiFavor ?? def.aiFavor ?? 0,
    choice: picked?.id ?? '',
    choices
  };
}

/**
 * Whether a stored Table 6 result is still in force. A result made in combat applies in that combat's round only; one
 * made out of combat (combatId '') applies while no combat runs, until it is replaced or cleared.
 * @param {{ outcome?: string, combatId?: string, round?: number|null }} result `drive.result`
 * @param {{ combatId?: string, round?: number|null }|null} now the actor's running combat, or null / `{}` when none
 */
export function resultApplies(result, now) {
  if (!result || !trimmedScalar(result.outcome)) return false;
  const resultCombat = typeof result.combatId === 'string' ? result.combatId : '';
  const nowCombat = typeof now?.combatId === 'string' ? now.combatId : '';
  if (!resultCombat) return !nowCombat;
  if (resultCombat !== nowCombat) return false;
  return Number(result.round) === Number(now?.round);
}

/**
 * The rated Move with the stored Table 6 result applied while it is in force. Never below 0, whole feet.
 * @param {{ rated: number, result?: object|null, now?: object|null }} args
 */
export function availableMove({ rated, result = null, now = null } = {}) {
  const base = wholeNumber(rated);
  if (!resultApplies(result, now)) return base;
  const { move } = resultEffect(result.outcome, result.choice);
  return Math.max(0, Math.floor(base * move.multiply + move.add));
}

/**
 * What to write when a stored result changes (a Critical choice switched, a degree shifted, a reroll): the signed
 * change against what the GM already applied. Positive damage is more damage, negative is healed back; the same for
 * AI Favor. Damage is the share of max HP rounded up and DR never touches it.
 * @param {{ damage?: number, aiFavor?: number }} applied `drive.result.applied`
 * @param {{ damagePercent?: number, aiFavor?: number }} effect a `resultEffect(...)`
 * @param {number} maxHp the vehicle's max HP
 * @returns {{ damage: number, aiFavor: number, next: { damage: number, aiFavor: number } }}
 */
export function resultDelta(applied, effect, maxHp) {
  const nextDamage = Math.ceil((wholeNumber(maxHp) * Math.max(0, Number(effect?.damagePercent) || 0)) / 100);
  const nextFavor = wholeNumber(effect?.aiFavor);
  return {
    damage: nextDamage - wholeNumber(applied?.damage),
    aiFavor: nextFavor - wholeNumber(applied?.aiFavor),
    next: { damage: nextDamage, aiFavor: nextFavor }
  };
}

const FAIL_DEGREES = ['critical_failure', 'major_failure', 'failure'];
const LADDER = ['critical_failure', 'major_failure', 'failure', 'near_miss', 'success', 'amazing_success', 'critical_success'];

/**
 * Shift a check degree by a number of steps (the book's "reduce the level of a Fail by 1"). Upward from a Fail
 * degree it stops at Near Miss: a shift never turns a fail into a success. With `failOnly` (the default) only a Fail
 * degree moves; without it Near Miss and the successes move too, and negative steps move down.
 * @param {string} outcome a COG_ROLL_OUTCOMES id
 * @param {number} steps
 * @param {{ failOnly?: boolean }} [opts]
 * @returns {string} the new degree id (the same id when nothing moves or the id is unknown)
 */
export function shiftDegree(outcome, steps, { failOnly = true } = {}) {
  const id = trimmedScalar(outcome);
  const at = LADDER.indexOf(id);
  const n = Math.trunc(Number(steps));
  if (at < 0 || !Number.isFinite(n) || n === 0) return id;
  if (failOnly && !FAIL_DEGREES.includes(id)) return id;
  let to = Math.max(0, Math.min(LADDER.length - 1, at + n));
  const nearMiss = LADDER.indexOf('near_miss');
  if (FAIL_DEGREES.includes(id) && n > 0) to = Math.min(to, nearMiss);
  return LADDER[to];
}

// ---------------------------------------------------------------------------------------------------------------
// Vehicle check kinds
// ---------------------------------------------------------------------------------------------------------------

/**
 * @typedef {object} VehicleCheckKindDef
 * @property {string} id
 * @property {string} label
 * @property {string} tag        `vehicle.check.<id>`, the engine context tag a check of this kind carries
 * @property {string} resolve    one of VEHICLE_RESOLVE_FLOWS: the engine flow that settles the card
 * @property {(state: { currentMove: number, floor: number }) => number|null} difficulty  null: the dialog asks
 */
/** @type {Record<string, VehicleCheckKindDef>} The registry. `CONFIG.COG.vehicleCheckKinds === VEHICLE_CHECK_KINDS`. */
export const VEHICLE_CHECK_KINDS = {};

/**
 * Add a vehicle check kind. A bad id, a missing label or an unknown resolve flow is refused with a warning.
 * @param {Partial<VehicleCheckKindDef>} def
 * @returns {boolean}
 */
export function registerVehicleCheckKind(def) {
  const id = def?.id;
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) return refuse('Vehicle check kind', id, 'the id is not valid');
  if (!cleanLabel(def.label)) return refuse('Vehicle check kind', id, 'a label is required');
  if (!VEHICLE_RESOLVE_FLOWS.includes(def.resolve)) return refuse('Vehicle check kind', id, `resolve must be one of ${VEHICLE_RESOLVE_FLOWS.join(', ')}`);
  if (def.difficulty !== undefined && def.difficulty !== null && typeof def.difficulty !== 'function') return refuse('Vehicle check kind', id, 'difficulty must be a function or null');
  VEHICLE_CHECK_KINDS[id] = {
    id,
    label: cleanLabel(def.label),
    tag: `${VEHICLE_TAGS.checkPrefix}${id}`,
    resolve: def.resolve,
    difficulty: def.difficulty ?? (() => null)
  };
  return true;
}

/** A check kind id from user input; an unregistered id is ''. */
export function sanitizeVehicleCheckKind(raw) {
  const id = trimmedScalar(raw);
  return Object.hasOwn(VEHICLE_CHECK_KINDS, id) ? id : '';
}

/** Unopposed default Difficulty (p. 59): 10 + 2 x Floor. */
const unopposedDifficulty = ({ floor } = {}) => 10 + 2 * wholeNumber(floor);

const C = 'COG.Vehicle.Check.';
registerVehicleCheckKind({ id: 'performance', label: `${C}performance`, resolve: 'table6', difficulty: unopposedDifficulty });
registerVehicleCheckKind({ id: 'decelerate', label: `${C}decelerate`, resolve: 'stop', difficulty: ({ currentMove } = {}) => decelerateDifficulty(currentMove) });
registerVehicleCheckKind({ id: 'ram', label: `${C}ram`, resolve: 'ram' });
registerVehicleCheckKind({ id: 'board', label: `${C}board`, resolve: 'board', difficulty: ({ currentMove } = {}) => boardDifficulty(currentMove) });
registerVehicleCheckKind({ id: 'contest', label: `${C}contest`, resolve: 'none' });
registerVehicleCheckKind({ id: 'weapon', label: `${C}weapon`, resolve: 'none' });
// The driver's choice to dodge a mob's hit on the vehicle (the driver chooses to swerve): a Driving check against the mob's attack Difficulty.
registerVehicleCheckKind({ id: 'evade', label: `${C}evade`, resolve: 'evade' });

// ---------------------------------------------------------------------------------------------------------------
// Upgrade kinds
// ---------------------------------------------------------------------------------------------------------------

/**
 * @typedef {object} VehicleUpgradeKindDef
 * @property {string} id
 * @property {string} label
 * @property {string} tag         `vehicle.upgrade.<id>`
 * @property {object} craftSkills tag query for the crafting skills when a blueprint whose output carries the tag names none
 */
/** @type {Record<string, VehicleUpgradeKindDef>} The registry. `CONFIG.COG.vehicleUpgradeKinds === VEHICLE_UPGRADE_KINDS`. */
export const VEHICLE_UPGRADE_KINDS = {};

/**
 * Add an upgrade kind. A bad id, a missing label or a craftSkills that is not a tag query is refused with a warning.
 * @param {Partial<VehicleUpgradeKindDef>} def
 * @returns {boolean}
 */
export function registerVehicleUpgradeKind(def) {
  const id = def?.id;
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) return refuse('Vehicle upgrade kind', id, 'the id is not valid');
  if (!cleanLabel(def.label)) return refuse('Vehicle upgrade kind', id, 'a label is required');
  if (!isPlainObject(def.craftSkills) && !(typeof def.craftSkills === 'string' && def.craftSkills.trim())) {
    return refuse('Vehicle upgrade kind', id, 'craftSkills must be a tag query');
  }
  VEHICLE_UPGRADE_KINDS[id] = { id, label: cleanLabel(def.label), tag: `${VEHICLE_TAGS.upgradePrefix}${id}`, craftSkills: def.craftSkills };
  return true;
}

registerVehicleUpgradeKind({ id: 'armor', label: 'COG.Vehicle.Upgrade.armor', craftSkills: { any: ['id.skill.smithing'] } });
registerVehicleUpgradeKind({ id: 'mounted_weapon', label: 'COG.Vehicle.Upgrade.mounted_weapon', craftSkills: { any: ['id.skill.engineering'] } });
registerVehicleUpgradeKind({ id: 'speed', label: 'COG.Vehicle.Upgrade.speed', craftSkills: { any: ['id.skill.gear-head'] } });
registerVehicleUpgradeKind({ id: 'magic', label: 'COG.Vehicle.Upgrade.magic', craftSkills: { any: ['id.skill.arcane'] } });
registerVehicleUpgradeKind({ id: 'style', label: 'COG.Vehicle.Upgrade.style', craftSkills: { any: ['id.skill.gear-head'] } });

/**
 * The upgrade kinds a tag list names (`vehicle.upgrade.<id>` for a registered id), in registry order.
 * @param {Iterable<string>|string[]} tags
 * @returns {VehicleUpgradeKindDef[]}
 */
export function upgradeKindsOf(tags) {
  const set = tags instanceof Set ? tags : new Set(normalizeTagList(tags));
  return Object.values(VEHICLE_UPGRADE_KINDS).filter((k) => set.has(k.tag));
}

// ---------------------------------------------------------------------------------------------------------------
// Roll penalties a `waive` row may name
// ---------------------------------------------------------------------------------------------------------------

/** @typedef {{ id: string, label: string }} RollPenaltyDef */
/** @type {Record<string, RollPenaltyDef>} The registry. `CONFIG.COG.rollPenalties === ROLL_PENALTIES`. */
export const ROLL_PENALTIES = {};

/**
 * Add an engine-applied roll penalty that a `waive` row may name.
 * @param {RollPenaltyDef} def
 * @returns {boolean}
 */
export function registerRollPenalty(def) {
  const id = def?.id;
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) return refuse('Roll penalty', id, 'the id is not valid');
  if (!cleanLabel(def.label)) return refuse('Roll penalty', id, 'a label is required');
  ROLL_PENALTIES[id] = { id, label: cleanLabel(def.label) };
  addWaivableRollPenalty(id, ROLL_PENALTIES[id].label);
  return true;
}

const DRIVER_PENALTY = 'driver';
registerRollPenalty({ id: DRIVER_PENALTY, label: 'COG.Vehicle.Penalty.driver' });

// ---------------------------------------------------------------------------------------------------------------
// Arithmetic
// ---------------------------------------------------------------------------------------------------------------

/**
 * Ten Health Bar slots of the vehicle's size value each. A size that is not a positive number reads as 4 (Medium).
 * @param {number} sizeNumber the size registry number (1 to 8, or a module's)
 * @returns {{ max: number, hpPerBar: number, bars: number }}
 */
export function vehicleHealth(sizeNumber) {
  const n = Math.floor(Number(sizeNumber));
  const size = Number.isFinite(n) && n > 0 ? n : DEFAULT_VEHICLE_SIZE_NUMBER;
  return { max: VEHICLE_HEALTH_BARS * size, hpPerBar: size, bars: VEHICLE_HEALTH_BARS };
}

/**
 * The inherent Difficulty of an attack on a vehicle: 10 + speed / 5 (rounded down); head-on or from behind the speed
 * is not added. No Floor is added.
 */
export function attackDifficulty({ currentMove = 0, headOn = false } = {}) {
  return headOn === true ? 10 : 10 + Math.floor(wholeNumber(currentMove) / 5);
}

/** An occupant's Evade Buff: speed / 10 (rounded down); none from straight ahead or behind. */
export function occupantEvadeBuff({ currentMove = 0, headOn = false } = {}) {
  return headOn === true ? 0 : Math.floor(wholeNumber(currentMove) / 10);
}

/** The Dex Stat Check Difficulty to board a moving vehicle: 10 + speed / 2. A stationary vehicle needs no check: null. */
export function boardDifficulty(currentMove) {
  const speed = wholeNumber(currentMove);
  return speed > 0 ? 10 + Math.floor(speed / 2) : null;
}

/** The Difficulty to stop a vehicle where the driver wants: 10 + speed / 5. */
export function decelerateDifficulty(currentMove) {
  return 10 + Math.floor(wholeNumber(currentMove) / 5);
}

/** How many d6 a ram rolls: the vehicle's size value plus speed / 10. (Size 4 at 50 is 9.) */
export function ramDice({ size, currentMove = 0 } = {}) {
  return wholeNumber(size) + Math.floor(wholeNumber(currentMove) / 10);
}

/**
 * The shares of a ram. The rammer takes half the rolled damage (the full amount when the target's size number is
 * larger) and its Move halves (drops to 0 when the target is larger). Occupants take half their vehicle's share
 * before that vehicle's DR, then lose their own DR and the vehicle's DR, each once, never below 0.
 * When the target is a vehicle it takes the ram damage itself; its occupants follow the same rule from the full damage.
 * Halving rounds down (the system's half-damage rounding, `damage-math.mjs`).
 * @param {object} args
 * @param {number} args.damage        the rolled ram damage
 * @param {number} args.ramSize       size number of the ramming vehicle
 * @param {number} args.targetSize    size number of the target
 * @param {number} [args.ramDr]       the ramming vehicle's DR
 * @param {number[]} [args.occupantDrs]  DR of each occupant of the ramming vehicle, in order
 * @param {boolean} [args.targetIsVehicle]
 * @param {number} [args.targetDr]    the target vehicle's DR
 * @param {number[]} [args.targetOccupantDrs]  DR of each occupant of the target vehicle
 * @returns {{ larger: boolean, rammerShare: number, rammerTaken: number, moveMultiplier: number,
 *   occupants: { share: number, taken: number }[], targetTaken: number|null, targetOccupants: { share: number, taken: number }[] }}
 */
export function ramCollision({ damage, ramSize, targetSize, ramDr = 0, occupantDrs = [], targetIsVehicle = false, targetDr = 0, targetOccupantDrs = [] } = {}) {
  const dmg = wholeNumber(damage);
  const larger = Number(targetSize) > Number(ramSize);
  const rammerShare = larger ? dmg : Math.floor(dmg / 2);
  const shares = (vehicleShare, vehicleDr, drs) => (Array.isArray(drs) ? drs : []).map((d) => {
    const share = Math.floor(vehicleShare / 2);
    return { share, taken: Math.max(0, share - wholeNumber(d) - wholeNumber(vehicleDr)) };
  });
  return {
    larger,
    rammerShare,
    rammerTaken: Math.max(0, rammerShare - wholeNumber(ramDr)),
    moveMultiplier: larger ? 0 : 0.5,
    occupants: shares(rammerShare, ramDr, occupantDrs),
    targetTaken: targetIsVehicle === true ? Math.max(0, dmg - wholeNumber(targetDr)) : null,
    targetOccupants: targetIsVehicle === true ? shares(dmg, targetDr, targetOccupantDrs) : []
  };
}

/**
 * The explosion at 0%: size d6 + Floor Fire to every occupant, the vehicle's DR not protecting.
 * @returns {{ count: number, bonus: number, formula: string, type: string }}
 */
export function explosionFormula({ size, floor = 0 } = {}) {
  const count = wholeNumber(size);
  const bonus = wholeNumber(floor);
  return { count, bonus, formula: bonus ? `${count}d6 + ${bonus}` : `${count}d6`, type: EXPLOSION_DAMAGE_TYPE };
}

/**
 * Full Move after the vehicle's and its driver's Move rows: (full + the adds) x the multipliers, rounded down.
 * @param {{ full: number, adds?: number[], multipliers?: number[] }} args
 */
export function ratedMove({ full, adds = [], multipliers = [] } = {}) {
  const sum = (Array.isArray(adds) ? adds : []).reduce((t, a) => t + (Number.isFinite(Number(a)) ? Number(a) : 0), wholeNumber(full));
  const total = (Array.isArray(multipliers) ? multipliers : []).reduce((t, m) => t * (Number.isFinite(Number(m)) && Number(m) >= 0 ? Number(m) : 1), sum);
  return Math.max(0, Math.floor(total));
}

// ---------------------------------------------------------------------------------------------------------------
// The operating skill and the driver's penalty
// ---------------------------------------------------------------------------------------------------------------

const tagsOf = (entry) => entry?.tags ?? entry?.system?.tags ?? [];
const rankOf = (entry) => Number(entry?.rank ?? entry?.modifiedRank ?? entry?.system?.modifiedRank ?? entry?.system?.rank) || 0;

/**
 * Among skills, the one that drives a vehicle: those whose tags match the kind's query, the highest Modified Rank wins
 * (the first of equals). No match, or no query, is null. A skill is found by its tags, never by name.
 * @param {Array<{ tags?: Iterable<string>, rank?: number, system?: object }>} skills entries or skill items
 * @param {object|string|null} query a tag query (`operateQueryFor(...)`)
 */
export function pickOperateSkill(skills, query) {
  if (!query || !Array.isArray(skills)) return null;
  let best = null;
  for (const entry of skills) {
    if (!matchesTagQuery(new Set(normalizeTagList(tagsOf(entry))), query)) continue;
    if (!best || rankOf(entry) > rankOf(best)) best = entry;
  }
  return best;
}

/**
 * Whether a roll made by a vehicle's driver carries Disadvantage: the roll's context has `situation.driving` unless it
 * is a vehicle check (driving), uses a mounted-only weapon, uses a weapon built into the vehicle, or a matched `waive`
 * row names the driver penalty.
 * @param {object} args
 * @param {Iterable<string>} args.tags            the roll context's tags
 * @param {Iterable<string>} [args.itemTags]      the rolled item's tags
 * @param {boolean} [args.mountedOnly]            the caller already read the `mounted-only` rule flag on the item (`hasRuleFlag`)
 * @param {boolean} [args.itemOwnedByVehicle]
 * @param {boolean|Iterable<string>} [args.waived] true, or the penalty ids the matched `waive` rows name
 * @returns {boolean}
 */
export function driverPenalty({ tags = [], itemTags = [], mountedOnly = false, itemOwnedByVehicle = false, waived = false } = {}) {
  const ctx = new Set(normalizeTagList(tags));
  if (!ctx.has(VEHICLE_TAGS.driving)) return false;
  if (ctx.has(VEHICLE_TAGS.check)) return false;
  if (mountedOnly === true || new Set(normalizeTagList(itemTags)).has(VEHICLE_TAGS.mountedOnly)) return false;
  if (itemOwnedByVehicle === true) return false;
  if (waived === true) return false;
  if (waived && typeof waived !== 'string' && typeof waived[Symbol.iterator] === 'function' && [...waived].includes(DRIVER_PENALTY)) return false;
  return true;
}
