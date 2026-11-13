/**
 * The audition engine (core rulebook pp. 315-316): a pure ladder of four attitudes that three checks move up or down
 * (Table 68). A check that would push an already Opposed patron lower storms them off (one humiliation, Table 69); one that
 * would push an already Enthusiastic patron higher earns a benefit (Table 70). After a [Steady nerves] benefit the shifts
 * are gentler (Table 70, entry 1). Imports only the outcome ids and the patronage constants.
 */
import { COG_ROLL_OUTCOMES } from '../../documents/session/roll-outcomes.mjs';
import { AUDITION_CHECKS, PATRON_ATTITUDES } from './patronage-state.mjs';

/** Rungs a degree moves the attitude (Table 68); a Near Miss costs a rung only at the attitudes in `NEAR_MISS_DROPS_AT`. */
const AUDITION_SHIFTS = Object.freeze({
  [COG_ROLL_OUTCOMES.CRITICAL_FAILURE]: -2,
  [COG_ROLL_OUTCOMES.MAJOR_FAILURE]: -2,
  [COG_ROLL_OUTCOMES.FAILURE]: -1,
  [COG_ROLL_OUTCOMES.NEAR_MISS]: -1,
  [COG_ROLL_OUTCOMES.SUCCESS]: 1,
  [COG_ROLL_OUTCOMES.AMAZING_SUCCESS]: 2,
  [COG_ROLL_OUTCOMES.CRITICAL_SUCCESS]: 2
});
/** The attitudes at which a Near Miss still costs a rung (Table 68); at the others it changes nothing. */
const NEAR_MISS_DROPS_AT = Object.freeze(['reluctant', 'willing']);
/** The shifts once the GM has given [Steady nerves] (Table 70, entry 1): a Near Miss or Failure changes nothing, the worst two cost one rung. */
const AUDITION_SHIFTS_STEADY = Object.freeze({
  ...AUDITION_SHIFTS,
  [COG_ROLL_OUTCOMES.CRITICAL_FAILURE]: -1,
  [COG_ROLL_OUTCOMES.MAJOR_FAILURE]: -1,
  [COG_ROLL_OUTCOMES.FAILURE]: 0,
  [COG_ROLL_OUTCOMES.NEAR_MISS]: 0
});

const TOP = PATRON_ATTITUDES.length - 1;
const rungOf = (attitude) => {
  const i = PATRON_ATTITUDES.indexOf(attitude);
  return i < 0 ? PATRON_ATTITUDES.indexOf('willing') : i;
};

/**
 * How many rungs a check of this degree moves a patron of this attitude.
 * @param {string} outcome a `COG_ROLL_OUTCOMES` value
 * @param {string} attitude
 * @param {{ steady?: boolean }} [opts]
 * @returns {number} 0 for `pending` or an unknown degree
 */
function auditionShift(outcome, attitude, { steady = false } = {}) {
  const shift = (steady ? AUDITION_SHIFTS_STEADY : AUDITION_SHIFTS)[outcome] ?? 0;
  if (outcome === COG_ROLL_OUTCOMES.NEAR_MISS && !steady && !NEAR_MISS_DROPS_AT.includes(attitude)) return 0;
  return shift;
}

/**
 * Apply one check to an audition.
 * @param {{ attitude: string, checks: object[], steady: boolean, result: string }} state
 * @param {{ outcome: string, skill?: string, messageId?: string, at?: number|null }} check
 * @returns {{ state: object, event: ''|'stormedOff'|'benefit', verdict: 'pending'|'open'|'agreed'|'declined'|'stormedOff' }}
 *   `verdict` is `agreed` after three checks unless the patron ends Opposed (`declined`)
 */
export function auditionStep(state, { outcome, skill = '', messageId = '', at = null } = {}) {
  const from = PATRON_ATTITUDES[rungOf(state?.attitude)];
  const steady = state?.steady === true;
  const checks = Array.isArray(state?.checks) ? state.checks : [];
  if (!outcome || outcome === COG_ROLL_OUTCOMES.PENDING) {
    return { state: { attitude: from, checks, steady, result: state?.result ?? '' }, event: '', verdict: 'pending' };
  }
  const shift = auditionShift(outcome, from, { steady });
  const to = PATRON_ATTITUDES[Math.min(TOP, Math.max(0, rungOf(from) + shift))];
  let event = '';
  if (rungOf(from) === 0 && shift < 0) event = 'stormedOff';
  else if (rungOf(from) === TOP && shift > 0) event = 'benefit';
  const next = [...checks, { skill, outcome, from, to, event, messageId, at }];
  let verdict = 'open';
  if (event === 'stormedOff') verdict = 'stormedOff';
  else if (next.length >= AUDITION_CHECKS) verdict = rungOf(to) === 0 ? 'declined' : 'agreed';
  return { state: { attitude: to, checks: next, steady, result: verdict === 'open' ? '' : verdict }, event, verdict };
}

/**
 * Take back the last check: its attitude is restored and the audition is open again.
 * @param {{ attitude: string, checks: object[], steady: boolean, result: string }} state
 */
export function auditionUndo(state) {
  const checks = Array.isArray(state?.checks) ? state.checks : [];
  const last = checks[checks.length - 1];
  const attitude = last && PATRON_ATTITUDES.includes(last.from) ? last.from : state?.attitude;
  return { attitude, checks: checks.slice(0, -1), steady: state?.steady === true, result: '' };
}
