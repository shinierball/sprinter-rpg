/**
 * Fan Box milestone alerts, the pure half (core p. 280). A crawler who reaches a Popularity milestone raises an alert to
 * the GM, who decides on the box. These functions only decide which milestones need a new alert card, which wait on one
 * already posted, and which waiting alerts the crawler has dropped back below. The crawler's record is
 * `{ '<milestone>': { state: 'pending'|'open'|'awarded'|'dismissed', messageId? } }`; no document, setting or chat is read.
 */
import { milestonesCrossed } from '../../data/rules/popularity-changes.mjs';

/** The states a milestone's record can be in. */
const ALERT_STATES = Object.freeze(['pending', 'open', 'awarded', 'dismissed']);

const stateOf = (alerts, milestone) => {
  const state = alerts?.[String(milestone)]?.state;
  return ALERT_STATES.includes(state) ? state : null;
};

/**
 * What a Popularity change means for the alerts.
 * Upward: each milestone crossed is skipped when a box was already awarded for it, refreshes the waiting card when its
 * alert is still open, and otherwise needs a new alert. Downward: each milestone the value fell back below whose alert is
 * still open gets the "now below" line. A milestone whose box was awarded is never touched.
 * @param {{ before: number, after: number, alerts?: object, rule?: { list: number[], factor: number } }} change
 * @returns {{ post: number[], refresh: number[], below: number[] }}
 */
export function planFanBoxAlert({ before, after, alerts, rule }) {
  const plan = { post: [], refresh: [], below: [] };
  for (const m of milestonesCrossed(before, after, rule)) {
    const state = stateOf(alerts, m);
    if (state === 'awarded') continue;
    (state === 'open' ? plan.refresh : plan.post).push(m);
  }
  for (const m of milestonesCrossed(after, before, rule)) {
    if (stateOf(alerts, m) === 'open') plan.below.push(m);
  }
  return plan;
}

/**
 * The milestones to stamp `pending` on the crawler when no GM is connected to post the card: the new alerts of an
 * upward move.
 * @returns {number[]}
 */
export function pendingMilestones(change) {
  return planFanBoxAlert(change).post;
}

/** `alerts` with one milestone's record patched (a copy). */
export function withAlertState(alerts, milestone, patch) {
  const key = String(milestone);
  return { ...(alerts && typeof alerts === 'object' ? alerts : {}), [key]: { ...(alerts?.[key] ?? {}), ...patch } };
}

/** The milestone keys of a record that are in a state, as ascending numbers. */
export function milestonesInState(alerts, state) {
  return Object.keys(alerts && typeof alerts === 'object' ? alerts : {})
    .filter((key) => stateOf(alerts, key) === state && Number.isFinite(Number(key)))
    .map(Number)
    .sort((a, b) => a - b);
}
