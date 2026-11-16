/**
 * The flags stored on a Combat that more than one module reads: the per-round Action `roundHistory` (written by the
 * Action ledger, read by the archive, the XP tracker and the archive window) and the encounter `metrics` (written by
 * the metrics engine, read by the same three). A leaf: the readers and the writers import each other's modules, so the
 * accessors sit below both.
 */
import { readFlag, writeFlag, clearFlag } from '../../utils/flags.mjs';

const ROUND_HISTORY_FLAG = 'roundHistory';
const METRICS_FLAG = 'metrics';

/** The Actions each combatant spent per round, `{ [round]: { [combatantId]: actions } }`; `{}` when none is stored. */
export function roundHistoryOf(combat) {
  return readFlag(combat, ROUND_HISTORY_FLAG) || {};
}

/** Store the whole round history on a combat. */
export function saveRoundHistory(combat, history) {
  return writeFlag(combat, ROUND_HISTORY_FLAG, history);
}

/**
 * The encounter metrics stored on a combat (damage dealt per actor, awards, ...).
 * @param {object} combat a Combat, or an archived record
 * @param {object} [fallback] what a combat with no stored metrics answers
 */
export function metricsOf(combat, fallback = {}) {
  return readFlag(combat, METRICS_FLAG) || fallback;
}

/** Store the whole metrics record on a combat. */
export function saveMetrics(combat, metrics) {
  return writeFlag(combat, METRICS_FLAG, metrics);
}

/** Forget the encounter metrics of a combat. */
export function clearMetrics(combat) {
  return clearFlag(combat, METRICS_FLAG);
}
