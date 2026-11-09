import { confirmRuleBreak } from '../rule-break.mjs';
import { TIME_UNITS, amountSeconds, formatRemaining, formatTiming, normalizeTiming } from './timing.mjs';
import { resolveReachedRankBreaks } from '../skill/rank-breaks.mjs';

/**
 * Cooldown evaluation. Lazy and pure: nothing is written when time
 * passes; each unit's reset is a comparison against the clock snapshot `now`. The wiring into the use sites is 3.12c.
 *
 * @typedef {object} TimeNow the clock snapshot (`currentTimeContext`)
 * @property {number} time world time in seconds
 * @property {number} [floor]
 * @property {string} [sceneToken] `scene:<epoch>`; changes when a combat starts or ends or the GM starts a new scene
 * @property {string} [floorToken] `floor:<n>`
 * @property {{ id: string, round: number }|null} [combat] the running combat the actor is in
 *
 * @typedef {object} UseRecord one entry of an item's `system.useRecords[]`
 * @property {string} key 'self' | 'grant.<kind>.<identifier>'
 * @property {string} unit unit at the time of use (a later edit never reinterprets a record)
 * @property {number|null} at world time of the use
 * @property {number|null} readyAt time units: `at` plus the length (fixed at use)
 * @property {string} combatId rounds units
 * @property {number|null} readyRound rounds units
 * @property {string} token period units
 * @property {number} uses period and rest units: uses this period
 * @property {boolean} ruleBreak
 *
 * @typedef {object} CooldownState
 * @property {boolean} ready
 * @property {string} unit
 * @property {number|null} usesLeft uses left this period (period and rest units), else null
 * @property {{ seconds?: number, rounds?: number, until?: string }} remaining
 */

const READY = (unit, usesLeft = null) => ({ ready: true, unit, usesLeft, remaining: {} });

/**
 * Whether a use is allowed now, and what is left.
 * - time units (minutes, hours, day): ready at `record.readyAt`; a clock rewound past the use shows the full length, never more.
 * - rounds: ready out of combat, in another combat, or from `record.readyRound`.
 * - period (scene, floor): ready when the token changed or fewer than `amount` uses are recorded.
 * - rest: ready while fewer than `amount` uses are recorded; `rest()` clears the records.
 * An empty or unknown unit is no cooldown (always ready).
 * @param {object} spec `{ value, unit, scaleBy }`
 * @param {UseRecord|null|undefined} record
 * @param {TimeNow} now
 * @param {{ amount?: number }} [opts] the resolved amount (`timingAmount`); defaults to `spec.value`
 * @returns {CooldownState}
 */
export function cooldownState(spec, record, now, { amount } = {}) {
  const { value, unit } = normalizeTiming(spec);
  const def = TIME_UNITS[unit];
  if (!unit || !def || def.kind === 'state') return READY(unit);
  const n = Number.isFinite(amount) ? amount : value;
  switch (def.kind) {
    case 'time': {
      const readyAt = record?.readyAt;
      if (!Number.isFinite(readyAt)) return READY(unit);
      const t = Number(now?.time) || 0;
      if (t >= readyAt) return READY(unit);
      const length = Number.isFinite(record.at) ? readyAt - record.at : Infinity;
      return { ready: false, unit, usesLeft: null, remaining: { seconds: Math.min(readyAt - t, length) } };
    }
    case 'rounds': {
      const combat = now?.combat;
      if (!combat || !record || record.combatId !== combat.id || !Number.isFinite(record.readyRound)) return READY(unit);
      if (combat.round >= record.readyRound) return READY(unit);
      return { ready: false, unit, usesLeft: null, remaining: { rounds: record.readyRound - combat.round } };
    }
    case 'period': {
      const token = now?.[`${def.token}Token`] ?? '';
      const uses = record && record.token === token ? Number(record.uses) || 0 : 0;
      return uses < n ? READY(unit, n - uses) : { ready: false, unit, usesLeft: 0, remaining: { until: unit } };
    }
    case 'rest': {
      const uses = Number(record?.uses) || 0;
      return uses < n ? READY(unit, n - uses) : { ready: false, unit, usesLeft: 0, remaining: { until: unit } };
    }
    default:
      return READY(unit);
  }
}

/**
 * The record to store after a use (the timer starts at use, hit or miss). The amount is fixed here, so a rank
 * raised later never lengthens a cooldown already running. Null when nothing needs storing (no cooldown, or a
 * rounds cooldown outside combat, which has no meaning there).
 * @param {object} spec
 * @param {UseRecord|null|undefined} record the previous record for this key
 * @param {TimeNow} now
 * @param {{ amount?: number, ruleBreak?: boolean, key?: string }} [opts]
 * @returns {UseRecord|null}
 */
export function nextUseRecord(spec, record, now, { amount, ruleBreak = false, key = 'self' } = {}) {
  const { value, unit } = normalizeTiming(spec);
  const def = TIME_UNITS[unit];
  if (!unit || !def || def.kind === 'state') return null;
  const n = Number.isFinite(amount) ? amount : value;
  const next = {
    key, unit, at: Number(now?.time) || 0, readyAt: null, combatId: '', readyRound: null, token: '', uses: 0, ruleBreak: Boolean(ruleBreak)
  };
  switch (def.kind) {
    case 'time':
      next.readyAt = next.at + amountSeconds(unit, n);
      return next;
    case 'rounds':
      if (!now?.combat) return null;
      next.combatId = now.combat.id;
      next.readyRound = now.combat.round + n;
      return next;
    case 'period': {
      const token = now?.[`${def.token}Token`] ?? '';
      next.token = token;
      next.uses = (record && record.token === token ? Number(record.uses) || 0 : 0) + 1;
      return next;
    }
    case 'rest':
      next.uses = (Number(record?.uses) || 0) + 1;
      return next;
    default:
      return null;
  }
}

/**
 * The cooldown gate (CONTRIBUTING rule 2): never blocks on its own. A ready item proceeds. One on cooldown asks
 * `confirmRuleBreak` ("<name> is on cooldown (3h remaining). Use anyway as a Rule Break?"); a confirm proceeds with
 * `ruleBreak: true`, a Cancel or a `refuse` policy returns `proceed: false` with nothing to write.
 * The caller stores `nextRecord` (if any) once the use goes ahead.
 * @param {object} params
 * @param {string} params.name what is being used, for the dialog
 * @param {object} params.spec the effective cooldown
 * @param {UseRecord|null} [params.record]
 * @param {TimeNow} params.now
 * @param {number} [params.amount]
 * @param {string} [params.key]
 * @param {object} [params.options] passed to `confirmRuleBreak` (`ruleBreak`, `interactive`)
 * @returns {Promise<{ proceed: boolean, ruleBreak: boolean, state: CooldownState, nextRecord: UseRecord|null, refusal?: string }>}
 */
export async function gateCooldown({ name, spec, record = null, now, amount, key = 'self', options = {} }) {
  const state = cooldownState(spec, record, now, { amount });
  if (state.ready) {
    return { proceed: true, ruleBreak: false, state, nextRecord: nextUseRecord(spec, record, now, { amount, key }) };
  }
  const check = await confirmRuleBreak({
    title: 'On Cooldown',
    message: `${name} is on cooldown (${formatRemaining(state)}). Use anyway as a Rule Break?`,
    options
  });
  if (!check.confirmed) return { proceed: false, ruleBreak: false, state, nextRecord: null, refusal: check.refusal };
  return { proceed: true, ruleBreak: true, state, nextRecord: nextUseRecord(spec, record, now, { amount, ruleBreak: true, key }) };
}

/**
 * The cooldown that applies to one use: a grant row's own, else the item's, then the highest reached rank-break
 * override (a tier whose `cooldown` is not null; `{ unit: '' }` there means "no cooldown from this rank").
 * @param {object} item an item or its `system`
 * @param {{ grantRow?: object|null, rank?: number }} [opts]
 * @returns {{ value: number, unit: string, scaleBy: object|null }} normalized
 */
export function effectiveCooldown(item, { grantRow = null, rank } = {}) {
  const sys = item?.system ?? item ?? {};
  const base = normalizeTiming(grantRow?.cooldown).unit ? grantRow.cooldown : sys.cooldown;
  const reached = sys.rankBreaks ? resolveReachedRankBreaks(item, rank).cooldownOverride : null;
  return normalizeTiming(reached ?? base);
}

/**
 * Printable cooldown for cards, sheets and exports ("Once per round", "2 hours per Rank", "None").
 * @param {object} item an item or its `system`
 * @param {{ grantRow?: object|null, rank?: number, amount?: number }} [opts]
 * @returns {string}
 */
export function cooldownLabel(item, { grantRow = null, rank, amount } = {}) {
  return formatTiming(effectiveCooldown(item, { grantRow, rank }), { amount });
}

/** @returns {boolean} whether the item (or grant row) carries a cooldown at all */
export function hasCooldown(item, opts = {}) {
  return Boolean(effectiveCooldown(item, opts).unit);
}
