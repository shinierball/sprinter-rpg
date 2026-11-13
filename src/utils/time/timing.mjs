import { resolveScalar, scaledNumber, describeScale } from '../roll/scalars.mjs';

/**
 * Timing: the one shape cooldowns and durations share,
 * `{ value, unit, scaleBy }`, and the unit registry behind it. Pure: no document, setting or clock reads.
 *
 * - `value` is a length for time units, and a count of uses per period for period, rest and round units.
 * - `unit` is a `TIME_UNITS` id; '' means none. No schema `choices`: the registry is the validator.
 * - `scaleBy` is the scalar engine's spec (`rank`, `floor`, `stat`, `statValue`, ...): "2 hours per Rank" is
 *   `{ value: 2, unit: 'hours', scaleBy: { source: 'rank' } }`.
 */

/** Duration unit ids ended by a roll: the bearer's next Check, or the next Action they take (`condition-expiry.mjs`). */
export const NEXT_CHECK_UNIT = 'next_check';
export const NEXT_ACTION_UNIT = 'next_action';

/** A round is 10 seconds (a combat round, or 10 seconds outside combat). */
export const SECONDS_PER_ROUND = 10;
export const SECONDS_PER_HOUR = 3600;
/** A day is 30 floor-clock hours, not 24 (user decision; the grind day). */
export const DAY_HOURS = 30;

/** The index of the day a world time (seconds) falls in; the AI Favor bar lasts while it stays the same (E6.10 D-C7). */
export function dayIndex(seconds) {
  const n = Number(seconds);
  return Number.isFinite(n) ? Math.floor(n / (DAY_HOURS * SECONDS_PER_HOUR)) : 0;
}

/** World time (seconds) as "Day N hh:mm" on the dungeon day: hours run 00 to 29. */
export function formatDayClock(seconds) {
  const s = Math.max(0, Math.trunc(Number(seconds) || 0));
  const intoDay = s % (DAY_HOURS * SECONDS_PER_HOUR);
  const hh = String(Math.floor(intoDay / SECONDS_PER_HOUR)).padStart(2, '0');
  const mm = String(Math.floor((intoDay % SECONDS_PER_HOUR) / 60)).padStart(2, '0');
  return `Day ${dayIndex(s) + 1} ${hh}:${mm}`;
}

/**
 * @typedef {object} TimeUnitDef
 * @property {string} id
 * @property {string} label plain text shown in editors and cards
 * @property {'time'|'rounds'|'period'|'rest'|'state'} kind time and rounds end after an amount of play time; a period ends when a
 *   scene (combat) or floor changes; a rest ends at a rest of that level or longer; a state has no amount (instant, combat, permanent)
 * @property {number} [seconds] length of one unit (kind 'time')
 * @property {'scene'|'floor'} [token] the `TimeNow` token a period unit compares (kind 'period')
 * @property {number} [level] rest level 1-3 (kind 'rest'); see REST_LEVELS
 * @property {Array<'cooldown'|'duration'>} use where the unit may be chosen
 */

/** @type {Record<string, TimeUnitDef>} The registry. `CONFIG.COG.timeUnits === TIME_UNITS`. */
export const TIME_UNITS = {};

const UNIT_ID = /^[A-Za-z][\w.-]*$/;

/**
 * Add a unit. Modules prefix theirs ('my-module.watch'). A bad definition is refused with a console warning.
 * @param {TimeUnitDef} def
 * @returns {boolean} whether it was registered
 */
export function registerTimeUnit(def) {
  const id = def?.id;
  const kinds = ['time', 'rounds', 'period', 'rest', 'state'];
  if (typeof id !== 'string' || !UNIT_ID.test(id) || !kinds.includes(def.kind)) {
    console.warn(`Sprinter RPG | Time unit ${String(id)} was not registered: it needs an id and a kind (${kinds.join(', ')}).`);
    return false;
  }
  if (def.kind === 'time' && !(Number(def.seconds) > 0)) {
    console.warn(`Sprinter RPG | Time unit ${id} was not registered: a time unit needs a positive "seconds".`);
    return false;
  }
  TIME_UNITS[id] = { use: ['cooldown', 'duration'], ...def };
  return true;
}

const BOTH = ['cooldown', 'duration'];
for (const def of [
  { id: 'seconds', label: 'seconds', kind: 'time', seconds: 1, use: ['duration'] },
  { id: 'rounds', label: 'rounds', kind: 'rounds', use: BOTH },
  { id: 'minutes', label: 'minutes', kind: 'time', seconds: 60, use: BOTH },
  { id: 'hours', label: 'hours', kind: 'time', seconds: SECONDS_PER_HOUR, use: BOTH },
  { id: 'day', label: 'days', kind: 'time', seconds: DAY_HOURS * SECONDS_PER_HOUR, use: BOTH },
  { id: 'scene', label: 'scene (combat)', kind: 'period', token: 'scene', use: ['cooldown'] },
  { id: 'floor', label: 'floor', kind: 'period', token: 'floor', use: ['cooldown'] },
  { id: 'short_rest', label: 'short rest', kind: 'rest', level: 1, use: BOTH },
  { id: 'long_rest', label: 'long rest', kind: 'rest', level: 2, use: BOTH },
  { id: 'full_day_rest', label: "full day's rest", kind: 'rest', level: 3, use: BOTH },
  { id: 'instant', label: 'Instantaneous', kind: 'state', use: ['duration'] },
  { id: 'combat', label: 'Until the end of combat', kind: 'state', use: ['duration'] },
  { id: 'next_check', label: 'Until the next Check', kind: 'state', use: ['duration'] },
  { id: 'next_action', label: 'Until the next Action', kind: 'state', use: ['duration'] },
  { id: 'until_healed', label: 'Until healed', kind: 'state', use: ['duration'] },
  { id: 'permanent', label: 'Until removed', kind: 'state', use: ['duration'] }
]) registerTimeUnit(def);

/** @param {'cooldown'|'duration'} use @returns {TimeUnitDef[]} the units an editor offers */
export function timeUnitsFor(use) {
  return Object.values(TIME_UNITS).filter(def => def.use.includes(use));
}

const warnedUnits = new Set();
function warnOnce(key, message) {
  if (warnedUnits.has(key)) return;
  warnedUnits.add(key);
  console.warn(`Sprinter RPG | ${message}`);
}
/** Tests only: forget which warnings were already printed. */
export function resetTimingWarnings() { warnedUnits.clear(); }

/**
 * A timing spec from whatever was stored (CONTRIBUTING §4). An array becomes its first element. A string is NOT parsed
 * (rule 4): it becomes none, with one warning. An unknown unit becomes none, with one warning per unit. A negative
 * or non-finite value becomes 0; a period, rest or rounds unit with a value under 1 counts as 1.
 * @param {*} raw
 * @returns {{ value: number, unit: string, scaleBy: object|null }}
 */
export function normalizeTiming(raw) {
  let spec = raw;
  if (Array.isArray(spec)) spec = spec[0];
  const none = { value: 0, unit: '', scaleBy: null };
  if (spec === undefined || spec === null || spec === '') return none;
  if (typeof spec !== 'object') {
    warnOnce(`text:${String(spec)}`, `A timing value was text ("${String(spec)}"); text is never parsed, so it counts as none.`);
    return none;
  }
  const unit = String(spec.unit ?? '').trim();
  if (!unit) return none;
  const def = TIME_UNITS[unit];
  if (!def) {
    warnOnce(`unit:${unit}`, `Unknown time unit "${unit}"; it counts as none.`);
    return none;
  }
  let value = Number(spec.value);
  if (!Number.isFinite(value) || value < 0) value = 0;
  if (['period', 'rest', 'rounds'].includes(def.kind) && value < 1) value = 1;
  const sb = spec.scaleBy;
  const scaleBy = sb && typeof sb === 'object' && !Array.isArray(sb) && sb.source ? sb : null;
  return { value, unit, scaleBy };
}

/** @param {string} unit @returns {number|null} seconds in one unit (rounds are 10 s), null for period, rest and state units */
export function unitSeconds(unit) {
  const def = TIME_UNITS[unit];
  if (!def) return null;
  if (def.kind === 'time') return def.seconds;
  if (def.kind === 'rounds') return SECONDS_PER_ROUND;
  return null;
}

/**
 * The spec's amount after `scaleBy`: `value x (base + per x n)`, whole numbers, the scalar engine's rule.
 * An unresolvable scalar leaves the unscaled value (the item stays usable; the engine already warned).
 * @param {object} spec a timing spec (normalized or not)
 * @param {object} [scalarCtx] `{ actor, source, carrier, row, context, phase }` as for any scalar
 * @returns {number}
 */
export function timingAmount(spec, scalarCtx = {}) {
  const { value, scaleBy } = normalizeTiming(spec);
  if (!scaleBy) return value;
  const source = scalarCtx.source ?? scalarCtx.carrier ?? null;
  const resolved = resolveScalar(scaleBy, { phase: 'use', context: { phase: 'use' }, row: spec, ...scalarCtx, source, carrier: scalarCtx.carrier ?? source });
  if (!resolved.ok) return value;
  return scaledNumber(value, scaleBy, resolved.n, 'whole');
}

/**
 * Length in seconds of `amount` units (time and rounds units), else null.
 * @param {string} unit
 * @param {number} amount
 * @returns {number|null}
 */
export function amountSeconds(unit, amount) {
  const per = unitSeconds(unit);
  return per === null ? null : per * (Number(amount) || 0);
}

/** Length in rounds of `amount` units, rounded up; null for units with no length. */
export function amountRounds(unit, amount) {
  const sec = amountSeconds(unit, amount);
  return sec === null ? null : Math.ceil(sec / SECONDS_PER_ROUND);
}

const ORDINAL_TIMES = { 1: 'Once', 2: 'Twice' };
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const singular = (def) => (def.label.endsWith('s') ? def.label.slice(0, -1) : def.label);
const unitText = (def, n) => (n === 1 ? singular(def) : def.label);

/**
 * Human text for a spec: `None`, `5 minutes`, `2 hours per Rank (6 hours)`, `5 minutes + 1 minute per Rank`,
 * `Once per scene (combat)`, `Twice per scene (combat)`, `Once per day`, `Once per round`, `Until a long rest`.
 * @param {object} spec
 * @param {{ amount?: number, use?: 'cooldown'|'duration' }} [opts] `amount` is the resolved amount (after scaleBy)
 * @returns {string}
 */
export function formatTiming(spec, { amount, use = 'cooldown' } = {}) {
  const { value, unit, scaleBy } = normalizeTiming(spec);
  if (!unit) return use === 'duration' ? 'Instantaneous' : 'None';
  const def = TIME_UNITS[unit];
  if (def.kind === 'state') return def.label;
  if (def.kind === 'rest' && use === 'duration') return `Until a ${def.label}`;
  const n = Number.isFinite(amount) ? amount : value;
  if (def.kind === 'period' || def.kind === 'rest') {
    const times = ORDINAL_TIMES[n] ?? `${n} times`;
    return `${times} per ${def.label}`;
  }
  if (def.kind === 'rounds') {
    if (use === 'cooldown' && n === 1 && !scaleBy) return 'Once per round';
    if (!scaleBy) return plural(n, 'round');
  }
  if (unit === 'day' && use === 'cooldown' && n === 1 && !scaleBy) return 'Once per day';
  if (!scaleBy) return `${n} ${unitText(def, n)}`;
  const base = Number(scaleBy.base) || 0;
  const per = `${value} ${unitText(def, value)} ${describeScale(scaleBy)}`;
  const head = base ? `${base * value} ${unitText(def, base * value)} + ${per}` : per;
  return Number.isFinite(amount) ? `${head} (${amount} ${unitText(def, amount)})` : head;
}

/** "3h 10m", "10m", "45s" for a number of seconds (minutes round up). */
export function formatSeconds(seconds) {
  const s = Math.max(0, Math.ceil(Number(seconds) || 0));
  if (s < 60) return `${s}s`;
  const totalMin = Math.ceil(s / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/**
 * Text for what is left of a cooldown, from `cooldownState(...).remaining`: `3h 10m remaining`, `2 rounds`,
 * `next scene (combat)`, `next floor`, `next long rest`. A ready state gives `ready`.
 * @param {{ ready?: boolean, remaining?: { seconds?: number, rounds?: number, until?: string } }} state
 * @returns {string}
 */
export function formatRemaining(state) {
  if (!state || state.ready) return 'ready';
  const r = state.remaining ?? {};
  if (Number.isFinite(r.seconds)) return `${formatSeconds(r.seconds)} remaining`;
  if (Number.isFinite(r.rounds)) return plural(r.rounds, 'round');
  if (r.until) return `next ${TIME_UNITS[r.until]?.label ?? r.until}`;
  return 'on cooldown';
}
