/**
 * src/data/rules/contest-rules.mjs
 * Registries for racing, chasing and skill-challenge contests (Core Rulebook pp. 74-75, 258). No Foundry
 * globals. `CONFIG.COG.contestKinds === CONTEST_KINDS`, `CONFIG.COG.chaseGround === CHASE_GROUND` and
 * `CONFIG.COG.challengeDegrees === CHALLENGE_DEGREES`; a module adds a kind or changes the Ground a degree is worth with
 * the register functions, and changes what a degree is worth on a challenge stage by writing the record directly.
 */
import { COG_ROLL_OUTCOMES } from '../../documents/session/roll-outcomes.mjs';
import { CONTEST_TAGS } from '../tag-vocabulary.mjs';
import { firstScalar } from '../../utils/first-scalar.mjs';

const DEFAULT_CONTEST_KIND = 'race';

const ID_PATTERN = /^[A-Za-z][\w.-]*$/;

/**
 * @typedef {object} ContestKindDef
 * @property {string} id /^[A-Za-z][\w.-]*$/ ; modules prefix theirs ('my-module.relay')
 * @property {string} label
 * @property {string} [hint]
 * @property {string[]} roles participant roles the kind allows; the first is the default
 * @property {string} tag the engine context tag a roll made inside this kind carries
 */
/** @type {Record<string, ContestKindDef>} The registry. `CONFIG.COG.contestKinds === CONTEST_KINDS`. */
export const CONTEST_KINDS = {};

/**
 * @typedef {object} ChaseGroundDef
 * @property {number} ground Ground gained (negative: lost) on a leg that ends in this degree
 * @property {boolean} [out] the chaser is out of the chase (Critical Failure)
 */
/** @type {Record<string, ChaseGroundDef>} Keyed by `COG_ROLL_OUTCOMES` id. `CONFIG.COG.chaseGround === CHASE_GROUND`. */
export const CHASE_GROUND = {};

/**
 * @typedef {object} ChallengeDegreeDef
 * @property {boolean} pass the stage is passed
 * @property {-1|0|1} net safety nets earned (negative: lost) on a stage that ends in this degree
 */
/** @type {Record<string, ChallengeDegreeDef>} Keyed by `COG_ROLL_OUTCOMES` id. `CONFIG.COG.challengeDegrees === CHALLENGE_DEGREES`. */
export const CHALLENGE_DEGREES = {};

/**
 * Add a contest kind. A bad id, a missing label or an empty role list is refused with a warning.
 * @param {ContestKindDef} def
 * @returns {boolean} whether it was registered
 */
export function registerContestKind(def) {
  const id = def?.id;
  const label = typeof def?.label === 'string' ? def.label.trim() : '';
  const roles = Array.isArray(def?.roles) ? def.roles.filter((r) => typeof r === 'string' && ID_PATTERN.test(r)) : [];
  if (typeof id !== 'string' || !ID_PATTERN.test(id) || !label || !roles.length) {
    console.warn(`Sprinter RPG | Contest kind ${String(id)} was not registered: it needs a well-formed id, a label and at least one role.`);
    return false;
  }
  const tag = typeof def.tag === 'string' ? def.tag.trim() : '';
  CONTEST_KINDS[id] = { ...def, id, label, roles, tag };
  return true;
}

/**
 * Set the Ground a degree is worth in a chase.
 * @param {string} degree a COG_ROLL_OUTCOMES id
 * @param {ChaseGroundDef} def
 * @returns {boolean} whether it was registered
 */
export function registerChaseGround(degree, def) {
  const ground = Number(def?.ground);
  if (typeof degree !== 'string' || !ID_PATTERN.test(degree) || !Number.isFinite(ground)) {
    console.warn(`Sprinter RPG | Chase Ground for ${String(degree)} was not registered: it needs a degree id and a numeric ground.`);
    return false;
  }
  CHASE_GROUND[degree] = { ground: Math.trunc(ground), out: def?.out === true };
  return true;
}

/**
 * Set what a degree is worth on a skill-challenge stage: whether it passes, and the safety net it earns or loses.
 * @param {string} degree a COG_ROLL_OUTCOMES id
 * @param {ChallengeDegreeDef} def
 * @returns {boolean} whether it was registered
 */
function registerChallengeDegree(degree, def) {
  const net = Number(def?.net);
  if (typeof degree !== 'string' || !ID_PATTERN.test(degree) || ![-1, 0, 1].includes(net)) {
    console.warn(`Sprinter RPG | Challenge degree ${String(degree)} was not registered: it needs a degree id and a net of -1, 0 or 1.`);
    return false;
  }
  CHALLENGE_DEGREES[degree] = { pass: def?.pass === true, net };
  return true;
}

/** A single trimmed id from user input (CONTRIBUTING §4). */
function trimmedScalar(raw) {
  const val = firstScalar(raw);
  return typeof val === 'string' ? val.trim() : '';
}

/** A registered kind id for `raw`; an unregistered or malformed id becomes the default kind. */
export function sanitizeContestKind(raw) {
  const id = trimmedScalar(raw);
  return Object.hasOwn(CONTEST_KINDS, id) ? id : DEFAULT_CONTEST_KIND;
}

/** The kind's definition; an unregistered or malformed id falls back to the default kind. */
export function contestKindInfo(raw) {
  return CONTEST_KINDS[sanitizeContestKind(raw)];
}

registerContestKind({
  id: 'race', label: 'Race', hint: 'Everyone races to a fixed point; placements are summed across the legs.',
  roles: ['racer'], tag: CONTEST_TAGS.race
});
registerContestKind({
  id: 'chase', label: 'Chase', hint: 'Chasers gain or lose Ground on a moving quarry; +4 catches early, -4 loses it.',
  roles: ['chaser', 'quarry'], tag: CONTEST_TAGS.chase
});

registerContestKind({
  id: 'challenge', label: 'Skill Challenge', hint: 'One roll decides each stage. A success by 10 or more earns a safety net; a fail by 10 or more loses one.',
  roles: ['solver'], tag: CONTEST_TAGS.challenge
});

const O = COG_ROLL_OUTCOMES;
registerChaseGround(O.CRITICAL_SUCCESS, { ground: 2 });
registerChaseGround(O.AMAZING_SUCCESS, { ground: 2 });
registerChaseGround(O.SUCCESS, { ground: 1 });
registerChaseGround(O.NEAR_MISS, { ground: 0 });
registerChaseGround(O.FAILURE, { ground: -1 });
registerChaseGround(O.MAJOR_FAILURE, { ground: -2 });
registerChaseGround(O.CRITICAL_FAILURE, { ground: 0, out: true });

registerChallengeDegree(O.CRITICAL_SUCCESS, { pass: true, net: 1 });
registerChallengeDegree(O.AMAZING_SUCCESS, { pass: true, net: 1 });
registerChallengeDegree(O.SUCCESS, { pass: true, net: 0 });
registerChallengeDegree(O.NEAR_MISS, { pass: false, net: 0 });
registerChallengeDegree(O.FAILURE, { pass: false, net: 0 });
registerChallengeDegree(O.MAJOR_FAILURE, { pass: false, net: -1 });
registerChallengeDegree(O.CRITICAL_FAILURE, { pass: false, net: -1 });
