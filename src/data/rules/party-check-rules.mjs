/**
 * The party check (core pp. 59-60, 88). Every participant rolls the Skill Check against the Difficulty; the party succeeds
 * when half or more of them succeed. An Amazing Success or better turns one member's Failure into a Success; a Major Fail or
 * worse turns another member's Success into a Failure. Both flips apply to the rolled results at once (Question 1378 a):
 * final successes = successes + min(Amazings, Failures) - min(Major Fails, Successes). Pure.
 */
import { COG_ROLL_OUTCOMES } from '../../documents/session/roll-outcomes.mjs';

/** "If half or more of the party succeed, the party succeeds" (p. 59). */
const PARTY_CHECK_SHARE = 0.5;
/** The most participants one party check card lists. */
export const MAX_PARTY_PARTICIPANTS = 20;

const SUCCESSES = Object.freeze([COG_ROLL_OUTCOMES.SUCCESS, COG_ROLL_OUTCOMES.AMAZING_SUCCESS, COG_ROLL_OUTCOMES.CRITICAL_SUCCESS]);
const FAILURES = Object.freeze([COG_ROLL_OUTCOMES.CRITICAL_FAILURE, COG_ROLL_OUTCOMES.MAJOR_FAILURE, COG_ROLL_OUTCOMES.FAILURE, COG_ROLL_OUTCOMES.NEAR_MISS]);
/** A Natural 20 counts as an Amazing Success "or better"; a Natural 1 as a Major Fail "or worse" (degrees, pp. 60-61). */
const AMAZING_OR_BETTER = Object.freeze([COG_ROLL_OUTCOMES.AMAZING_SUCCESS, COG_ROLL_OUTCOMES.CRITICAL_SUCCESS]);
const MAJOR_OR_WORSE = Object.freeze([COG_ROLL_OUTCOMES.MAJOR_FAILURE, COG_ROLL_OUTCOMES.CRITICAL_FAILURE]);

const count = (list, group) => list.filter((o) => group.includes(o)).length;

/**
 * Count a party check.
 * @param {Array<string|null>} outcomes one per participant: a `COG_ROLL_OUTCOMES` id, or null / '' when not rolled yet
 * @returns {{ size: number, rolled: number, waiting: number, successes: number, failures: number, amazing: number, major: number,
 *   flippedUp: number, flippedDown: number, final: number, needed: number, verdict: 'none'|'pending'|'success'|'failure' }}
 *   `verdict` is `pending` while any participant has no degree (a roll with no Difficulty is `pending` too).
 */
export function partyCheckTally(outcomes) {
  const list = Array.isArray(outcomes) ? outcomes : [];
  const size = list.length;
  const known = list.filter((o) => SUCCESSES.includes(o) || FAILURES.includes(o));
  const successes = count(known, SUCCESSES);
  const failures = count(known, FAILURES);
  const amazing = count(known, AMAZING_OR_BETTER);
  const major = count(known, MAJOR_OR_WORSE);
  const flippedUp = Math.min(amazing, failures);
  const flippedDown = Math.min(major, successes);
  const final = successes + flippedUp - flippedDown;
  const needed = Math.ceil(size * PARTY_CHECK_SHARE);
  let verdict = 'none';
  if (size > 0) verdict = known.length < size ? 'pending' : (final >= needed ? 'success' : 'failure');
  return { size, rolled: known.length, waiting: size - known.length, successes, failures, amazing, major, flippedUp, flippedDown, final, needed, verdict };
}
