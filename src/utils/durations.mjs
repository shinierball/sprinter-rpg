import { TIME_UNITS, amountRounds, amountSeconds, formatRemaining, formatTiming, normalizeTiming } from './timing.mjs';
import { resolveReachedRankBreaks } from './rank-breaks.mjs';

/**
 * Duration arithmetic. Pure. A duration config is the timing
 * spec `{ value, unit, scaleBy }` spelled `{ type, value, scaleBy, ... }` (the schema lands in 3.12b); these helpers
 * take either spelling. The sweep that acts on the stamps is 3.12d.
 */

/** The timing spec inside a duration config (`type` is the unit). */
export function durationSpec(cfg) {
  return normalizeTiming(cfg && typeof cfg === 'object' ? { ...cfg, unit: cfg.unit ?? cfg.type } : null);
}

/**
 * The world time an effect ends: `startTime` plus the length, for time units (seconds, minutes, hours, day); null
 * for every other kind (rounds count down in Clean Up; rest and state types end by other means).
 * @param {object} cfg `{ type|unit, value, scaleBy }`
 * @param {number} startTime world time the effect came into force
 * @param {{ amount?: number }} [opts] the resolved amount (`timingAmount`, plus any `durationBonus`)
 * @returns {number|null}
 */
export function expiryStamp(cfg, startTime, { amount } = {}) {
  const spec = durationSpec(cfg);
  if (TIME_UNITS[spec.unit]?.kind !== 'time') return null;
  const n = Number.isFinite(amount) ? amount : spec.value;
  return (Number(startTime) || 0) + amountSeconds(spec.unit, n);
}

/** @returns {boolean} whether a stamped `expiresAt` has been reached at `nowTime` */
export function isTimeExpired(cfg, nowTime) {
  const at = cfg?.expiresAt;
  return Number.isFinite(at) && (Number(nowTime) || 0) >= at;
}

/**
 * One Clean Up tick of a rounds duration.
 * @param {{ remainingRounds?: number }} cfg
 * @returns {{ remainingRounds: number, expired: boolean }} expired when the count reaches 0
 */
export function tickRoundDuration(cfg) {
  const left = Math.max(0, Math.floor(Number(cfg?.remainingRounds) || 0));
  const remainingRounds = Math.max(0, left - 1);
  return { remainingRounds, expired: remainingRounds === 0 };
}

/**
 * The duration config that applies to an item: its own `durationConfig`, replaced by the highest reached rank-break
 * `duration` override. `bonus` is the summed `durationBonus` of the reached tiers (added in the effective unit).
 * @param {object} item an item or its `system`
 * @param {{ rank?: number }} [opts]
 * @returns {{ type: string, value: number, scaleBy: object|null, endsWithCombat: boolean, bonus: number }}
 */
export function effectiveDuration(item, { rank } = {}) {
  const sys = item?.system ?? item ?? {};
  const reached = sys.rankBreaks ? resolveReachedRankBreaks(item, rank) : null;
  const cfg = reached?.durationOverride ?? sys.durationConfig ?? {};
  const spec = durationSpec(cfg);
  return {
    type: spec.unit || 'instant',
    value: spec.value,
    scaleBy: spec.scaleBy,
    endsWithCombat: Boolean(cfg.endsWithCombat),
    bonus: Number(reached?.durationBonus) || 0
  };
}

/** @returns {number} the rounds of a `rounds` duration config (0 for any other type): the one place `value` is read as rounds */
export function durationRounds(cfg) {
  return cfg?.type === 'rounds' ? Math.max(0, Math.floor(Number(cfg.value) || 0)) : 0;
}

/**
 * Rounds the conditions an item inflicts last once a reached rank-break `durationBonus` applies (Q-B3): the item's
 * effective duration (the highest reached break's `duration` override, else `durationConfig`; time units converted to
 * rounds, `scaleBy` not applied; 0 for units with no length) plus the summed bonus in rounds. 0 when no bonus is
 * reached (the conditions keep their own duration).
 * Used for a spell's hit and cast conditions and for a skill's or spell's contest-failure debuff (3.10).
 * @param {object} item a skill or spell (or its `system`)
 * @param {number} [rank] the rank the item was used at; default the higher of its modified and base Rank, at least 1
 * @returns {number}
 */
export function rankBreakConditionRounds(item, rank) {
  const sys = item?.system ?? item ?? {};
  const given = rank === null || rank === undefined || rank === '' ? NaN : Number(rank);
  const at = Number.isFinite(given) ? given : Math.max(Number(sys.modifiedRank) || 0, Number(sys.rank) || 0, 1);
  const eff = effectiveDuration(item, { rank: at });
  if (eff.bonus <= 0) return 0;
  return (amountRounds(eff.type, eff.value) ?? 0) + eff.bonus;
}

/**
 * Printable duration: the human `system.duration` text when it has one, else the structured config.
 * @param {object} item an item or its `system`
 * @param {{ rank?: number, amount?: number }} [opts]
 * @returns {string}
 */
export function durationLabel(item, { rank, amount } = {}) {
  const sys = item?.system ?? item ?? {};
  const text = String(sys.duration ?? '').trim();
  if (text) return text;
  const eff = effectiveDuration(item, { rank });
  return formatTiming({ value: eff.value, unit: eff.type, scaleBy: eff.scaleBy }, { amount, use: 'duration' });
}

/**
 * The duration a spell cast card prints: the structured config when it names a real duration (rank-scaled), so a
 * `{ minutes: 1 }` spell never reads "Instantaneous" off the default human note; else `durationLabel`.
 * @param {object} item an item or its `system`
 * @param {{ rank?: number, amount?: number }} [opts]
 * @returns {string}
 */
export function spellCardDuration(item, { rank, amount } = {}) {
  const eff = effectiveDuration(item, { rank });
  if (eff.type && eff.type !== 'instant') {
    const text = formatTiming({ value: eff.value, unit: eff.type, scaleBy: eff.scaleBy }, { amount, use: 'duration' });
    if (text) return text;
  }
  return durationLabel(item, { rank, amount });
}

/**
 * The configured length of an effect as text (`2 hours`, `3 rounds`, `Until a long rest`), read from the structured
 * `durationConfig` alone, never the human `system.duration` note. '' when the config names no unit or is the default `instant`, so the caller falls back to the human note.
 * @param {object} cfg a `durationConfig`
 * @returns {string}
 */
export function durationConfigText(cfg) {
  const spec = durationSpec(cfg);
  if (!spec.unit || spec.unit === 'instant') return '';
  return formatTiming(spec, { use: 'duration' });
}

/**
 * What is left of a running effect, for the effects panel: `3h 10m remaining` from a stamped `expiresAt`, `2 rounds`
 * from `remainingRounds`, `until dismissed` for a permanent one. An effect with no stamp and no such type gives ''.
 * @param {object} cfg a `durationConfig`
 * @param {number} nowTime world time in seconds
 * @returns {string}
 */
export function durationRemainingLabel(cfg, nowTime) {
  if (!cfg || typeof cfg !== 'object') return '';
  if (Number.isFinite(cfg.expiresAt)) {
    return formatRemaining({ ready: false, remaining: { seconds: Math.max(0, cfg.expiresAt - (Number(nowTime) || 0)) } });
  }
  const rounds = Math.floor(Number(cfg.remainingRounds) || 0);
  if (rounds > 0) return formatRemaining({ ready: false, remaining: { rounds } });
  if (cfg.type === 'permanent') return 'until dismissed';
  return '';
}
