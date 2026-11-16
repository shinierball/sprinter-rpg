/**
 * Sprinter RPG - Standard Popularity changes
 *
 * The book's checklist of Popularity changes a GM weighs at three moments: once per 2-hour session, once per dungeon
 * day, and at the end of each floor (core p. 280, from the Third Floor), plus the Second Floor's own list (Atlas p. 16).
 * `CONFIG.COG.popularityChanges` is the keyed registry (`POPULARITY_CHANGES`); a module adds, replaces or removes a
 * change through `ContentRegistry.registerPopularityChange`.
 *
 * A definition is `{ id, label, moment, value, floors: { min, max }, oncePer, pretick }`:
 *   label: a lang key, or plain text from a module
 *   moment: which checklist lists it (`POPULARITY_MOMENTS`)
 *   value: the integer the change pays; 0 hides the change (a module re-registers a core id with value 0)
 *   floors: inclusive bounds, `null` = no bound
 *   oncePer: the period one payment covers (a moment); defaults to `moment`
 *   pretick: optional `(facts) => ({ ticked, hint })`, a pure read of one crawler's facts (below)
 *
 * `facts` is plain data, one per crawler:
 *   { actorId, name, floor, cha, popularity, hasPet, partySize,
 *     crits: [{ d20, name }],         session moment: ledger hits since the last Session application
 *     exit: { timer, time } | null,   floor moment: the floor-exit snapshot, or the live timer and time
 *     grindHours: number | null,      clock hours ground in the last GRIND_FINAL_WINDOW_HOURS before exit.time
 *     dayGain: number | null }        day moment: the ended day's gain
 *
 * The Fan Box milestone rule (core p. 280) lives here too: `CONFIG.COG.fanBoxMilestones = { list, factor }`.
 *
 * Pure module: imports only the clock constants (`day-clock.mjs`, a leaf, so this file adds no import cycle).
 */
import { DAY_HOURS } from '../../utils/time/day-clock.mjs';

/** The moments the checklist is checked at, in the order the book lists them (core p. 280). */
export const POPULARITY_MOMENTS = Object.freeze(['session', 'day', 'floor']);

/** Charisma at or above this times the floor number gains a point at the end of a floor (core p. 280). */
const CHA_HIGH_PER_FLOOR = 5;
/** Charisma at or below this times the floor number loses a point at the end of a floor (core p. 280). */
const CHA_LOW_PER_FLOOR = 2;
/** Second Floor: Charisma at or above this gains a point (Atlas p. 16). */
const TUTORIAL_CHA_HIGH = 10;
/** Second Floor: Charisma at or below this loses a point (Atlas p. 16). */
const TUTORIAL_CHA_LOW = 5;
/** Entering the stairwell with more than this many hours left on the floor timer is "early" (core p. 280; a day is 30 hours, core p. 63). */
const EARLY_STAIRWELL_HOURS = DAY_HOURS;
/** The grind check looks at this many hours before leaving the floor (core p. 280). */
export const GRIND_FINAL_WINDOW_HOURS = DAY_HOURS;
/** More than this many hours ground inside the final window loses a point (core p. 280). The book's own number, not derived from the day. */
const GRIND_FINAL_LIMIT_HOURS = 15;
/** From this party size on, only the crawlers the recap featured gain its point (core p. 281). */
const RECAP_FEATURED_PARTY_SIZE = 4;
/** One Session check covers two hours of play (core p. 280); a Session change counts again after this many real hours. */
export const POPULARITY_SESSION_HOURS = 2;
/** A gain of this many Popularity in one dungeon day can earn a Fan Box (core p. 280). */
export const FAN_BOX_DAY_JUMP = 10;
/** The audience votes on a Fan Box's contents for one dungeon day (core p. 280). */
export const FAN_BOX_VOTE_HOURS = DAY_HOURS;
/** The first Fan Box milestone (core p. 280). */
const FAN_BOX_FIRST_MILESTONE = 25;
/** Each milestone after the listed ones is the last times this: 25 doubled is the book's 50 and 100, and it goes on. */
const FAN_BOX_MILESTONE_FACTOR = 2;

/** The core Fan Box milestone rule, the default of `CONFIG.COG.fanBoxMilestones`: 25, 50, 100, 200, 400 and on without end. */
export const FAN_BOX_MILESTONE_RULE = Object.freeze({
  list: Object.freeze([FAN_BOX_FIRST_MILESTONE]),
  factor: FAN_BOX_MILESTONE_FACTOR
});

const ID_PATTERN = /^[a-z][a-z0-9_.-]*$/;
const KEY = 'COG.PopularityChange.Hint';

const TEXT = {
  [`${KEY}.Cha`]: 'Charisma {cha} (needs {need} or more)',
  [`${KEY}.ChaLow`]: 'Charisma {cha} ({need} or less)',
  [`${KEY}.NoRecord`]: 'No floor record',
  [`${KEY}.Left`]: '{hours}h left on the floor timer',
  [`${KEY}.Ground`]: '{hours}h ground of the last {window}',
  [`${KEY}.Crit`]: 'Natural {d20}, {name}',
  [`${KEY}.Party`]: 'Party of {size}: only featured crawlers',
  [`${KEY}.Pet`]: 'Has a pet',
  [`${KEY}.NoPet`]: 'No pet'
};

function hint(key, data = {}) {
  const i18n = globalThis.game?.i18n;
  if (i18n?.has?.(key) && typeof i18n.format === 'function') return i18n.format(key, data);
  return TEXT[key].replace(/\{(\w+)\}/g, (_, k) => String(data[k] ?? ''));
}

const num = (value) => (Number.isFinite(Number(value)) && value !== null && value !== '' ? Number(value) : null);

function chaAtLeast(need, facts) {
  const cha = num(facts?.cha);
  return { ticked: cha !== null && cha >= need, hint: cha === null ? '' : hint(`${KEY}.Cha`, { cha, need }) };
}

function chaAtMost(need, facts) {
  const cha = num(facts?.cha);
  return { ticked: cha !== null && cha <= need, hint: cha === null ? '' : hint(`${KEY}.ChaLow`, { cha, need }) };
}

const chaAtLeastPerFloor = (facts) => chaAtLeast(CHA_HIGH_PER_FLOOR * (num(facts?.floor) ?? 0), facts);
const chaAtMostPerFloor = (facts) => chaAtMost(CHA_LOW_PER_FLOOR * (num(facts?.floor) ?? 0), facts);
const chaAtLeastTutorial = (facts) => chaAtLeast(TUTORIAL_CHA_HIGH, facts);
const chaAtMostTutorial = (facts) => chaAtMost(TUTORIAL_CHA_LOW, facts);

/** A Natural 20 or a Natural 1 in the session's ledger hits ticks it; the ledger cannot tell a fight, so the GM unticks a trivial one. */
function critInLedger(facts) {
  const hit = (Array.isArray(facts?.crits) ? facts.crits : []).find((c) => Number(c?.d20) === 20 || Number(c?.d20) === 1);
  return hit ? { ticked: true, hint: hint(`${KEY}.Crit`, { d20: Number(hit.d20), name: String(hit.name ?? '') }) } : { ticked: false, hint: '' };
}

/** More than a day left on the floor timer when the crawler left: the stairwell was entered early (core p. 31, p. 280). */
function leftEarly(facts) {
  const timer = num(facts?.exit?.timer);
  if (timer === null) return { ticked: false, hint: hint(`${KEY}.NoRecord`) };
  return { ticked: timer > EARLY_STAIRWELL_HOURS, hint: hint(`${KEY}.Left`, { hours: timer }) };
}

/** More than 15 clock hours ground inside the final 30 before leaving (core p. 170, p. 280). */
function groundTooMuch(facts) {
  const hours = num(facts?.grindHours);
  if (hours === null) return { ticked: false, hint: hint(`${KEY}.NoRecord`) };
  return { ticked: hours > GRIND_FINAL_LIMIT_HOURS, hint: hint(`${KEY}.Ground`, { hours, window: `${GRIND_FINAL_WINDOW_HOURS}h` }) };
}

/** The recap is a hint only: a party of four or more has only the featured crawlers gain its point (core p. 281). */
function recapHint(facts) {
  const size = num(facts?.partySize) ?? 0;
  return { ticked: false, hint: size >= RECAP_FEATURED_PARTY_SIZE ? hint(`${KEY}.Party`, { size }) : '' };
}

function petHint(facts) {
  return { ticked: false, hint: facts?.hasPet ? hint(`${KEY}.Pet`) : hint(`${KEY}.NoPet`) };
}

const UNBOUNDED = Object.freeze({ min: null, max: null });
const THIRD_FLOOR_ON = Object.freeze({ min: 3, max: null });
const SECOND_FLOOR = Object.freeze({ min: 2, max: 2 });

const change = (id, moment, value, floors, extra = {}) => Object.freeze({
  id, label: `COG.PopularityChange.${id}`, moment, value, floors, oncePer: moment, ...extra
});

/** The core table: core p. 280 from the Third Floor, Atlas p. 16 on the Second. Every amount is one point. */
const CORE_CHANGES = [
  change('session.crit', 'session', 1, THIRD_FLOOR_ON, { pretick: critInLedger }),
  change('session.courage', 'session', 1, THIRD_FLOOR_ON),
  change('session.solution', 'session', 1, THIRD_FLOOR_ON),
  change('session.avoided-fight', 'session', -1, THIRD_FLOOR_ON),
  change('session.boring', 'session', -1, THIRD_FLOOR_ON),
  change('day.recap', 'day', 1, THIRD_FLOOR_ON, { pretick: recapHint }),
  change('floor.pet', 'floor', 1, THIRD_FLOOR_ON, { pretick: petHint }),
  change('floor.cha-high', 'floor', 1, THIRD_FLOOR_ON, { pretick: chaAtLeastPerFloor }),
  change('floor.catchphrase', 'floor', 1, THIRD_FLOOR_ON),
  change('floor.big-attack', 'floor', -1, THIRD_FLOOR_ON),
  change('floor.cha-low', 'floor', -1, THIRD_FLOOR_ON, { pretick: chaAtMostPerFloor }),
  change('floor.early-stairwell', 'floor', -1, THIRD_FLOOR_ON, { pretick: leftEarly }),
  change('floor.grind', 'floor', -1, THIRD_FLOOR_ON, { pretick: groundTooMuch }),
  // Second Floor gains pay once on the floor (Question 1175 a); the losses are counted at its end
  change('tutorial.weapon', 'session', 1, SECOND_FLOOR, { oncePer: 'floor' }),
  change('tutorial.cha-high', 'session', 1, SECOND_FLOOR, { oncePer: 'floor', pretick: chaAtLeastTutorial }),
  change('tutorial.solution', 'session', 1, SECOND_FLOOR, { oncePer: 'floor' }),
  change('tutorial.event', 'session', 1, SECOND_FLOOR, { oncePer: 'floor' }),
  change('tutorial.big-weapon', 'floor', -1, SECOND_FLOOR),
  change('tutorial.cha-low', 'floor', -1, SECOND_FLOOR, { pretick: chaAtMostTutorial }),
  change('tutorial.boring', 'floor', -1, SECOND_FLOOR),
  change('tutorial.early-stairwell', 'floor', -1, SECOND_FLOOR, { pretick: leftEarly }),
  change('tutorial.grind', 'floor', -1, SECOND_FLOOR, { pretick: groundTooMuch })
];

/** The change registry keyed by id; `CONFIG.COG.popularityChanges` is this object. */
export const POPULARITY_CHANGES = {};

/** The registry in use: the one on `CONFIG.COG.popularityChanges` when set, else the module's own. */
function liveRegistry() {
  return globalThis.CONFIG?.COG?.popularityChanges ?? POPULARITY_CHANGES;
}

const isBound = (v) => v === null || v === undefined || Number.isFinite(v);

/** Why a definition is not a Popularity change, or '' when it is valid. */
export function popularityChangeDefProblem(def) {
  if (!def || typeof def !== 'object' || Array.isArray(def)) return 'the definition is not an object';
  if (typeof def.id !== 'string' || !ID_PATTERN.test(def.id)) return 'the id must be lower case letters, digits, . _ or -, starting with a letter';
  if (typeof def.label !== 'string' || !def.label.trim()) return 'a label is required';
  if (!POPULARITY_MOMENTS.includes(def.moment)) return `the moment must be one of ${POPULARITY_MOMENTS.join(', ')}`;
  if (!Number.isInteger(def.value)) return 'value must be a whole number (0 hides the change)';
  if (def.floors !== undefined && def.floors !== null) {
    if (typeof def.floors !== 'object' || !isBound(def.floors.min) || !isBound(def.floors.max)) return 'floors must be { min, max } numbers or null';
    if (Number.isFinite(def.floors.min) && Number.isFinite(def.floors.max) && def.floors.min > def.floors.max) return 'floors.min is above floors.max';
  }
  if (def.oncePer !== undefined && def.oncePer !== '' && !POPULARITY_MOMENTS.includes(def.oncePer)) return `oncePer must be one of ${POPULARITY_MOMENTS.join(', ')}`;
  if (def.pretick !== undefined && def.pretick !== null && typeof def.pretick !== 'function') return 'pretick must be a function';
  return '';
}

function normalizeChangeDef(def) {
  const bound = (v) => (Number.isFinite(v) ? v : null);
  return {
    id: def.id,
    label: def.label.trim(),
    moment: def.moment,
    value: def.value,
    floors: { min: bound(def.floors?.min), max: bound(def.floors?.max) },
    oncePer: def.oncePer || def.moment,
    ...(typeof def.pretick === 'function' ? { pretick: def.pretick } : {})
  };
}

/**
 * Register (or replace) a Popularity change. A bad definition is refused with a warning.
 * @param {{ id: string, label: string, moment: string, value: number, floors?: { min?: number|null, max?: number|null }, oncePer?: string, pretick?: Function }} def
 * @returns {boolean} whether the change was registered
 */
export function registerPopularityChange(def) {
  const problem = popularityChangeDefProblem(def);
  if (problem) {
    console.warn(`Sprinter RPG | registerPopularityChange refused "${def?.id}": ${problem}.`);
    return false;
  }
  const entry = normalizeChangeDef(def);
  liveRegistry()[entry.id] = entry;
  return true;
}

for (const def of CORE_CHANGES) POPULARITY_CHANGES[def.id] = normalizeChangeDef(def);

/**
 * The changes one moment lists on one floor, in registration order. A change whose value is 0 is hidden and is skipped.
 * @param {string} moment one of `POPULARITY_MOMENTS`
 * @param {number} floor the floor number
 * @param {object} [table] the registry to read; the live one by default
 * @returns {object[]}
 */
export function popularityChangesFor(moment, floor, table = liveRegistry()) {
  const at = num(floor);
  if (at === null) return [];
  return Object.values(table ?? {}).filter((def) => {
    if (def?.moment !== moment || def.value === 0) return false;
    const { min = null, max = null } = def.floors ?? UNBOUNDED;
    return (min === null || at >= min) && (max === null || at <= max);
  });
}

/**
 * The Fan Box milestone rule read from untrusted data: `list` is the positive whole numbers given, sorted, without
 * repeats; `factor` continues the series past the last one only when it is above 1 (else 0). Anything unusable gives the core rule.
 * @param {*} raw
 * @returns {{ list: number[], factor: number }}
 */
function fanBoxMilestoneRule(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.list)) return FAN_BOX_MILESTONE_RULE;
  const list = [...new Set(raw.list.map(Number).filter((n) => Number.isInteger(n) && n > 0))].sort((a, b) => a - b);
  if (!list.length) return FAN_BOX_MILESTONE_RULE;
  const factor = Number(raw.factor);
  return { list, factor: Number.isFinite(factor) && factor > 1 ? factor : 0 };
}

/**
 * Every Fan Box milestone `m` with `before < m <= after`, ascending: reaching one counts, standing on one does not
 * repeat, a jump across several returns them all. The series is the listed values, then each next one is the last times
 * `factor`, without end. The downward question (which milestones a drop un-crossed) is the same call with the
 * arguments swapped.
 * @param {number} before
 * @param {number} after
 * @param {{ list: number[], factor: number }} [rule] the live `CONFIG.COG.fanBoxMilestones` by default
 * @returns {number[]}
 */
export function milestonesCrossed(before, after, rule = globalThis.CONFIG?.COG?.fanBoxMilestones) {
  const from = num(before);
  const to = num(after);
  if (from === null || to === null || to <= from) return [];
  const { list, factor } = fanBoxMilestoneRule(rule);
  const crossed = list.filter((m) => m > from && m <= to);
  if (factor > 1) {
    // ceil keeps a fractional factor moving forward; the series is geometric, so this ends for any finite `to`
    for (let next = Math.ceil(list.at(-1) * factor); next <= to; next = Math.ceil(next * factor)) {
      if (next > from) crossed.push(next);
    }
  }
  return crossed;
}
