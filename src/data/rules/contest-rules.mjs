/**
 * src/data/rules/contest-rules.mjs
 * Registries for racing and chasing contests (Core Rulebook pp. 74-75). No Foundry
 * globals. `CONFIG.COG.contestKinds === CONTEST_KINDS` and `CONFIG.COG.chaseGround === CHASE_GROUND`; a module adds a
 * kind or changes the Ground a degree is worth with the register functions (or by writing the record directly).
 */
import { COG_ROLL_OUTCOMES } from '../../apps/session-manager/roll-outcomes.mjs';
import { CONTEST_TAGS } from '../tag-vocabulary.mjs';

export const DEFAULT_CONTEST_KIND = 'race';

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

/** A single trimmed id from user input (CONTRIBUTING §4). */
function firstString(raw) {
  let val = raw ?? '';
  if (Array.isArray(val)) val = val[0] ?? '';
  if (typeof val !== 'string') return '';
  if (val.includes(',')) val = val.split(',')[0];
  return val.trim();
}

/** A registered kind id for `raw`; an unregistered or malformed id becomes the default kind. */
export function sanitizeContestKind(raw) {
  const id = firstString(raw);
  return Object.hasOwn(CONTEST_KINDS, id) ? id : DEFAULT_CONTEST_KIND;
}

/** The kind's definition; an unregistered or malformed id falls back to the default kind. */
export function contestKindInfo(raw) {
  return CONTEST_KINDS[sanitizeContestKind(raw)];
}

/** Select options in registry order, `selected` precomputed (CONTRIBUTING §5). */
export function contestKindOptions(selected) {
  const current = sanitizeContestKind(selected);
  return Object.values(CONTEST_KINDS).map((k) => ({ value: k.id, label: k.label, hint: k.hint ?? '', selected: k.id === current }));
}

registerContestKind({
  id: 'race', label: 'Race', hint: 'Everyone races to a fixed point; placements are summed across the legs.',
  roles: ['racer'], tag: CONTEST_TAGS.race
});
registerContestKind({
  id: 'chase', label: 'Chase', hint: 'Chasers gain or lose Ground on a moving quarry; +4 catches early, -4 loses it.',
  roles: ['chaser', 'quarry'], tag: CONTEST_TAGS.chase
});

const O = COG_ROLL_OUTCOMES;
registerChaseGround(O.CRITICAL_SUCCESS, { ground: 2 });
registerChaseGround(O.AMAZING_SUCCESS, { ground: 2 });
registerChaseGround(O.SUCCESS, { ground: 1 });
registerChaseGround(O.NEAR_MISS, { ground: 0 });
registerChaseGround(O.FAILURE, { ground: -1 });
registerChaseGround(O.MAJOR_FAILURE, { ground: -2 });
registerChaseGround(O.CRITICAL_FAILURE, { ground: 0, out: true });
