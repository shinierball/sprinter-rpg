/**
 * src/data/rules/pet-rules.mjs
 * Pure pet and mount rules. No Foundry globals, no document code, nothing here blocks anything (Directive 2).
 */
import { normalizeTagList } from '../../utils/tag/tag-query.mjs';
import { firstScalar } from '../../utils/first-scalar.mjs';
import { PET_TAGS, VEHICLE_TAGS } from '../tag-vocabulary.mjs';
import { registerRollPenalty } from './vehicle-rules.mjs';
import { opposedDifficulty, unopposedDifficulty } from './difficulty-rules.mjs';
import { COG_ROLL_OUTCOMES } from '../../documents/session/roll-outcomes.mjs';

/** A pet's Health Bar slots never pass this number, however many Levels it gains (core book p. 231). */
export const PET_MAX_HEALTH_BARS = 10;

/**
 * The base pet (core book p. 231): Level 1 and these stats, Move 20 plus its size value, DR 0. A pet's Level starts at 1 whatever
 * a spec says; the stats and Move are what a spec may override.
 */
export const BASE_PET = Object.freeze({
  level: 1,
  stats: Object.freeze({ str: 2, int: 1, con: 2, dex: 2, cha: 1 }),
  moveBase: 20,
  step: 10,
  dr: 0
});

/** A dedicated mount's base (core book p. 232): Large, Move 30, Step 10. */
export const BASE_MOUNT = Object.freeze({ size: 'large', move: 30, step: 10 });

/**
 * A pet's attitude toward its handler (core book p. 229), each with its rank on the ladder from Hostile to Bonded. The registry
 * is `CONFIG.COG.petAttitudes`; the attitude is data and a sheet select, and taming moves it (9.7e). An id not listed reads as `DEFAULT_PET_ATTITUDE`.
 * @type {Record<string, { id: string, rank: number, label: string }>}
 */
export const PET_ATTITUDES = {
  hostile: { id: 'hostile', rank: 0, label: 'Hostile' },
  calm: { id: 'calm', rank: 1, label: 'Calm' },
  friendly: { id: 'friendly', rank: 2, label: 'Friendly' },
  bonded: { id: 'bonded', rank: 3, label: 'Bonded' }
};

/** What an unknown or missing attitude reads as: the attitude a new pet starts with. */
export const DEFAULT_PET_ATTITUDE = 'calm';

/** Where a pet comes from: an Earth-born pet or one born in the dungeon. A pet's origin is a label the GM reads; its tag is `pet.origin.<id>`. */
const PET_ORIGINS = Object.freeze(['dungeon', 'earth']);

/** The default origin of a new pet. */
export const DEFAULT_PET_ORIGIN = 'dungeon';

/** An attitude id from user input: a registered id, else the default. */
export function sanitizePetAttitude(raw) {
  const id = String(firstScalar(raw, '')).trim();
  return Object.hasOwn(PET_ATTITUDES, id) ? id : DEFAULT_PET_ATTITUDE;
}

/** An origin id from user input: `dungeon` or `earth`, else the default. */
export function sanitizePetOrigin(raw) {
  const id = String(firstScalar(raw, '')).trim();
  return PET_ORIGINS.includes(id) ? id : DEFAULT_PET_ORIGIN;
}

/** Select options in ladder order with `selected` precomputed; an unknown id selects Calm. */
export function petAttitudeOptions(selectedId) {
  const selected = sanitizePetAttitude(selectedId);
  return Object.values(PET_ATTITUDES).sort((a, b) => a.rank - b.rank).map(({ id, label }) => ({ id, label, selected: id === selected }));
}

/** Origin select options with `selected` precomputed. */
export function petOriginOptions(selectedId) {
  const selected = sanitizePetOrigin(selectedId);
  return PET_ORIGINS.map((id) => ({ id, label: id === 'earth' ? 'Earth-born' : 'Dungeon-born', selected: id === selected }));
}

/** The derived tags a pet carries for its attitude and origin: `pet.attitude.<id>` and `pet.origin.<id>`. */
export function petStateTags({ attitude, origin } = {}) {
  return [`${PET_TAGS.attitudePrefix}${sanitizePetAttitude(attitude)}`, `${PET_TAGS.originPrefix}${sanitizePetOrigin(origin)}`];
}

const whole = (value, fallback) => {
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) ? n : fallback;
};

/**
 * Health Bar slots of a pet or a dedicated mount.
 * A pet has its starting size value at Level 1 and one more per Level gained, at most `PET_MAX_HEALTH_BARS`
 * (so a size 3 pet has 3 slots at Level 1, 5 at Level 3). A pet's size growing later adds nothing: only the Level does.
 * A dedicated mount never levels and has slots equal to its current size value.
 * @param {{startingSize?: number, sizeNumber?: number, level?: number, isMount?: boolean}} args
 * @returns {number} at least 1
 */
export function petHealthBars({ startingSize, sizeNumber, level, isMount = false } = {}) {
  if (isMount) return Math.max(1, whole(sizeNumber, 1));
  const start = whole(startingSize ?? sizeNumber, 1);
  const lvl = Math.max(1, whole(level, 1));
  return Math.max(1, Math.min(PET_MAX_HEALTH_BARS, start + lvl - 1));
}

/** A pet gains this many Levels for each Level its crawler gains, until it reaches `PET_MATURE_LEVEL` (core book p. 231). */
const PET_LEVELS_PER_CRAWLER_LEVEL = 2;

/** At this Level a pet is mature: from here it gains one Level per crawler Level. */
export const PET_MATURE_LEVEL = 15;

/**
 * A pet's Level after its crawler gains Levels. Each crawler Level is taken one at a time: two pet Levels while the pet
 * is below 15 (a step never carries it past 15, so 14 lands on 15), one from Level 15 on.
 * @param {{petLevel?: number, crawlerLevels?: number}} args
 * @returns {{newLevel: number, levelsGained: number}}
 */
export function petLevelsFor({ petLevel, crawlerLevels } = {}) {
  const start = Math.max(1, whole(petLevel, 1));
  let level = start;
  for (let i = Math.max(0, whole(crawlerLevels, 0)); i > 0; i--) {
    level = level < PET_MATURE_LEVEL ? Math.min(PET_MATURE_LEVEL, level + PET_LEVELS_PER_CRAWLER_LEVEL) : level + 1;
  }
  return { newLevel: level, levelsGained: level - start };
}

/** The id a `waive` row names to lift the rider's Disadvantage on attacks (the Riding skill at Rank 5). */
const RIDER_PENALTY = 'rider';
registerRollPenalty({ id: RIDER_PENALTY, label: 'COG.Vehicle.Penalty.rider' });

/**
 * Whether a roll made by someone in control of a mount carries Disadvantage (core book p. 197): the roll's context has
 * `situation.riding`, the roll is an Attack Skill Check, and no matched `waive` row names the rider penalty. Unlike the
 * driver's, a mounted-only weapon does not lift it.
 * @param {{tags?: Iterable<string>, isAttack?: boolean, waived?: boolean|Iterable<string>}} args
 * @returns {boolean}
 */
export function riderPenalty({ tags = [], isAttack = false, waived = false } = {}) {
  if (isAttack !== true) return false;
  if (!new Set(normalizeTagList(tags)).has(VEHICLE_TAGS.riding)) return false;
  if (waived === true) return false;
  if (waived && typeof waived !== 'string' && typeof waived[Symbol.iterator] === 'function' && [...waived].includes(RIDER_PENALTY)) return false;
  return true;
}

// ---------------------------------------------------------------------------------------------------------------
// Taming (core book p. 230)

/** One attempt to change a pet's attitude needs this much direct contact; a second attempt before it has passed is a Rule Break. */
export const TAMING_ATTEMPT = Object.freeze({ value: 20, unit: 'minutes' });

/** After a Major Fail or worse no attempt to change that pet's attitude for 1 week: seven dungeon days of 30 hours (Question 1171). */
export const TAMING_LOCKOUT = Object.freeze({ value: 7, unit: 'day' });

/** Animal Handling Rank 10 halves the time each step needs (p. 185). */
const TAMING_FAST_RANK = 10;

/** A crawler has one pet unless a benefit says otherwise (p. 228). */
const PET_LIMIT_BASE = 1;

/** Animal Handling Rank 15 allows a second pet (p. 185). */
const SECOND_PET_RANK = 15;

/** The minutes a taming attempt takes at this Rank of the handling skill: half at `TAMING_FAST_RANK`. */
export function tamingAttemptMinutes(handlingRank) {
  return (Number(handlingRank) || 0) >= TAMING_FAST_RANK ? TAMING_ATTEMPT.value / 2 : TAMING_ATTEMPT.value;
}

/**
 * The Difficulty of an Int-Opposed check against a pet (p. 230): 10 + the pet's Int Mod + the Floor. A base pet's Int Mod is +1.
 * @param {{intMod?: number, floor?: number}} args
 * @returns {number}
 */
function tamingDifficulty({ intMod = 0, floor = 0 } = {}) {
  return opposedDifficulty({ mod: intMod, floor });
}

const AMAZING_OR_BETTER = new Set([COG_ROLL_OUTCOMES.AMAZING_SUCCESS, COG_ROLL_OUTCOMES.CRITICAL_SUCCESS]);
const SUCCESS_OR_BETTER = new Set([COG_ROLL_OUTCOMES.SUCCESS, ...AMAZING_OR_BETTER]);

/**
 * What a taming check does (p. 230). Hostile to Calm needs an Amazing Success or better; Calm to Friendly a Standard Success
 * or better; Friendly to Bonded an Amazing Success or better. A Major Fail or worse starts the lockout; a Critical Fail also
 * sets the animal Hostile and it attacks. A Near Miss is a Fail. Pure.
 * @param {{attitude?: string, outcome?: string}} args
 * @returns {{attitude: string, changed: boolean, lockout: boolean, attacks: boolean}}
 */
export function tamingResult({ attitude, outcome } = {}) {
  const from = sanitizePetAttitude(attitude);
  if (outcome === COG_ROLL_OUTCOMES.CRITICAL_FAILURE) return { attitude: 'hostile', changed: from !== 'hostile', lockout: true, attacks: true };
  if (outcome === COG_ROLL_OUTCOMES.MAJOR_FAILURE) return { attitude: from, changed: false, lockout: true, attacks: false };
  const needs = from === 'calm' ? SUCCESS_OR_BETTER : AMAZING_OR_BETTER;
  const next = Object.values(PET_ATTITUDES).find((a) => a.rank === PET_ATTITUDES[from].rank + 1);
  if (!next || !needs.has(outcome)) return { attitude: from, changed: false, lockout: false, attacks: false };
  return { attitude: next.id, changed: true, lockout: false, attacks: false };
}

/**
 * How many pets a crawler may have (p. 228): one, one more at Animal Handling Rank 15, one more for a benefit that says so
 * (the `extra-pet` rule flag). A dedicated mount is not counted by the caller.
 * @param {{handlingRank?: number, extraPet?: boolean}} args
 * @returns {number}
 */
export function petLimit({ handlingRank = 0, extraPet = false } = {}) {
  return PET_LIMIT_BASE + ((Number(handlingRank) || 0) >= SECOND_PET_RANK ? 1 : 0) + (extraPet === true ? 1 : 0);
}

/**
 * How well a pet is guided in a fight (core book p. 232): unguided and hiding pets stay out, a guided one fights with two
 * Actions of Evade, Move or Attack and one attack a round, a frenzied one with two Actions of any kind. The registry is
 * `CONFIG.COG.petGuidance`; `badge` is the tracker's state badge.
 * @type {Record<string, { id: string, label: string, badge: string }>}
 */
export const PET_GUIDANCE = {
  none: { id: 'none', label: 'Unguided', badge: '[UNGUIDED]' },
  limited: { id: 'limited', label: 'Guided', badge: '[GUIDED]' },
  free: { id: 'free', label: 'Frenzied', badge: '[FRENZIED]' },
  hiding: { id: 'hiding', label: 'Hiding', badge: '[HIDING]' }
};

/** The guidance every pet starts a combat with. */
const DEFAULT_PET_GUIDANCE = 'none';

/** A guidance id from stored data: a registered id, else the default. */
export function sanitizePetGuidance(raw) {
  const id = String(firstScalar(raw, '')).trim();
  return Object.hasOwn(PET_GUIDANCE, id) ? id : DEFAULT_PET_GUIDANCE;
}

/**
 * What a guiding check settles (p. 232): a Success lets the pet fight, an Amazing Success or better frees its Actions, a Fail
 * (a Near Miss is a Fail) leaves it out so its owner may try again, a Major Fail or worse sends it hiding. Pure.
 * @param {string} outcome a `COG_ROLL_OUTCOMES` id
 * @returns {'limited'|'free'|'none'|'hiding'}
 */
export function guidanceFromOutcome(outcome) {
  if (AMAZING_OR_BETTER.has(outcome)) return 'free';
  if (outcome === COG_ROLL_OUTCOMES.SUCCESS) return 'limited';
  if (outcome === COG_ROLL_OUTCOMES.MAJOR_FAILURE || outcome === COG_ROLL_OUTCOMES.CRITICAL_FAILURE) return 'hiding';
  return 'none';
}

/** The ledger Action types a guided (limited) pet may take: Evade, Move or Attack. */
const GUIDED_ACTION_TYPES = Object.freeze(['evade', 'move', 'attack']);

/**
 * The Rule Break reasons an Action of this type has for a pet in this guidance state (p. 232). Empty when the Action is within
 * the rule. Pure.
 * @param {{ state?: string, actionType?: string, hasAttacked?: boolean }} args
 * @returns {string[]}
 */
export function guidanceCauses({ state, actionType, hasAttacked = false } = {}) {
  const id = sanitizePetGuidance(state);
  if (id === 'none') return ['Not guided: it stays out of the fight until its handler guides it'];
  if (id === 'hiding') return ['Hiding: it ran and hid and stays out until found after the fight'];
  if (id === 'free') return [];
  if (!GUIDED_ACTION_TYPES.includes(actionType)) return ['Guided: it takes only Evade, Move or Attack Actions'];
  if (actionType === 'attack' && hasAttacked === true) return ['Guided: it makes one Attack a round'];
  return [];
}

/** A dedicated mount has one Action a round, used when its rider chooses in the crawlers' phase (core book p. 233). A pet has two. */
export const MOUNT_ACTIONS_PER_ROUND = 1;

/** A thrown rider takes one die of damage for each full 10 ft of the mount's Move (core book p. 232). */
const THROWN_FEET_PER_DIE = 10;

/** The die a thrown rider takes. */
const THROWN_DIE = 'd6';

/** The damage type of a fall from a mount. */
export const THROWN_DAMAGE_TYPE = 'Bludgeoning';

/**
 * What a rider thrown from a mount takes (core book p. 232): 1d6 Bludgeoning per 10 ft of the mount's Move, plus its size value.
 * Move 30 on a Large (5) mount is `3d6 + 5`; a Move under 10 ft has no dice and the formula is the size value alone. Pure.
 * @param {{ move?: number, sizeNumber?: number }} args
 * @returns {string}
 */
export function thrownFormula({ move, sizeNumber } = {}) {
  const dice = Math.max(0, Math.floor((Number(move) || 0) / THROWN_FEET_PER_DIE));
  const bonus = Math.max(0, Math.trunc(Number(sizeNumber)) || 0);
  if (!dice) return String(bonus);
  return bonus ? `${dice}${THROWN_DIE} + ${bonus}` : `${dice}${THROWN_DIE}`;
}

/**
 * Whether a riding check's degree lets the GM throw the rider (p. 232): any Fail, a Near Miss included. Pure.
 * @param {string} outcome a `COG_ROLL_OUTCOMES` id
 * @returns {boolean}
 */
export function riderMayBeThrown(outcome) {
  return [COG_ROLL_OUTCOMES.NEAR_MISS, COG_ROLL_OUTCOMES.FAILURE, COG_ROLL_OUTCOMES.MAJOR_FAILURE, COG_ROLL_OUTCOMES.CRITICAL_FAILURE].includes(outcome);
}

/** The engine flows that settle a pet check card. */
const PET_RESOLVE_FLOWS = Object.freeze(['attitude', 'guidance', 'thrown', 'none']);

/**
 * @typedef {object} PetCheckKindDef
 * @property {string} id
 * @property {string} label
 * @property {'handling'|'riding'} skill which skill tag the roller's skill is found by
 * @property {boolean} opposed Int-Opposed against the pet (else Unopposed)
 * @property {string} resolve one of the flows
 */
/** @type {Record<string, PetCheckKindDef>} The registry. `CONFIG.COG.petCheckKinds === PET_CHECK_KINDS`. */
export const PET_CHECK_KINDS = {};

/**
 * Add a pet check kind. A bad id, a missing label or an unknown skill or flow is refused with a warning.
 * @param {Partial<PetCheckKindDef>} def
 * @returns {boolean}
 */
function registerPetCheckKind(def) {
  const id = def?.id;
  const label = typeof def?.label === 'string' ? def.label.trim() : '';
  if (typeof id !== 'string' || !/^[A-Za-z][\w.-]*$/.test(id) || !label || !['handling', 'riding'].includes(def.skill) || !PET_RESOLVE_FLOWS.includes(def.resolve)) {
    console.warn(`Sprinter RPG | Pet check kind ${String(id)} was not registered: it needs a well-formed id, a label, a skill (handling or riding) and a resolve flow.`);
    return false;
  }
  PET_CHECK_KINDS[id] = { id, label, skill: def.skill, opposed: def.opposed === true, resolve: def.resolve };
  return true;
}

registerPetCheckKind({ id: 'tame', label: 'Tame', skill: 'handling', opposed: true, resolve: 'attitude' });
registerPetCheckKind({ id: 'guide', label: 'Guide', skill: 'handling', opposed: true, resolve: 'guidance' });
registerPetCheckKind({ id: 'ride', label: 'Ride', skill: 'riding', opposed: false, resolve: 'thrown' });
registerPetCheckKind({ id: 'command', label: 'Command', skill: 'handling', opposed: false, resolve: 'none' });

/**
 * The Difficulty of a pet check by its kind: Int-Opposed kinds 10 + the pet's Int Mod + Floor, the rest Unopposed (10 + 2 x Floor).
 * An unregistered kind is null (the dialog asks).
 * @param {string} kind
 * @param {{intMod?: number, floor?: number}} state
 * @returns {number|null}
 */
export function petCheckDifficulty(kind, { intMod = 0, floor = 0 } = {}) {
  const def = PET_CHECK_KINDS[kind];
  if (!def) return null;
  return def.opposed ? tamingDifficulty({ intMod, floor }) : unopposedDifficulty({ floor });
}

/** At `PET_MATURE_LEVEL` every pet may take one more special ability, whatever its role (core book p. 231). */
const MATURE_ABILITY_PICKS = 1;

/**
 * @typedef {object} PetRoleDef
 * @property {string} id
 * @property {string} label
 * @property {number} abilityPicks how many special abilities the role may pick (core book p. 232)
 * @property {string} buff the `system.identifier` of the role's buff; the buff is tagged `pet.role.<id>`
 */
/** @type {Record<string, PetRoleDef>} A pet's roles. `CONFIG.COG.petRoles === PET_ROLES`; homebrew adds one entry and one buff. */
export const PET_ROLES = {};

/**
 * Add a pet role. A bad id, a missing label or buff identifier or a pick count that is not a whole number of 0 or more is refused with a warning.
 * @param {Partial<PetRoleDef>} def
 * @returns {boolean}
 */
function registerPetRole(def) {
  const id = def?.id;
  const label = typeof def?.label === 'string' ? def.label.trim() : '';
  const buff = typeof def?.buff === 'string' ? def.buff.trim() : '';
  const picks = Number(def?.abilityPicks);
  if (typeof id !== 'string' || !/^[a-z][a-z0-9_]*$/.test(id) || !label || !buff || !Number.isInteger(picks) || picks < 0) {
    console.warn(`Sprinter RPG | Pet role ${String(id)} was not registered: it needs a lowercase id, a label, a buff identifier and a whole number of ability picks.`);
    return false;
  }
  PET_ROLES[id] = { id, label, abilityPicks: picks, buff };
  return true;
}

registerPetRole({ id: 'tank', label: 'Tank', abilityPicks: 1, buff: 'stand-in' });
registerPetRole({ id: 'aggressive', label: 'Aggressive', abilityPicks: 0, buff: 'ratings-stunt' });
registerPetRole({ id: 'utility', label: 'Utility', abilityPicks: 2, buff: 'utility-player' });

/** The role id a buff's tags name (`pet.role.<id>`), or null. */
export function roleIdFromTags(tags) {
  for (const tag of normalizeTagList(tags)) if (tag.startsWith(PET_TAGS.rolePrefix)) return tag.slice(PET_TAGS.rolePrefix.length);
  return null;
}

/** True when a buff's tags mark it a special ability (`pet.ability.<id>`). */
export function isAbilityTags(tags) {
  return normalizeTagList(tags).some((tag) => tag.startsWith(PET_TAGS.abilityPrefix));
}

/**
 * How many special abilities a pet may have: its role's picks, plus one from `PET_MATURE_LEVEL`. A dedicated mount has no role
 * and no abilities; a pet with no role has only the Level 15 pick.
 * @param {{ role?: string|null, level?: number, isMount?: boolean }} pet
 * @returns {number}
 */
export function petAbilityPicks({ role = null, level = 1, isMount = false } = {}) {
  if (isMount) return 0;
  const owed = Object.hasOwn(PET_ROLES, role ?? '') ? PET_ROLES[role].abilityPicks : 0;
  return owed + (Number(level) >= PET_MATURE_LEVEL ? MATURE_ABILITY_PICKS : 0);
}
