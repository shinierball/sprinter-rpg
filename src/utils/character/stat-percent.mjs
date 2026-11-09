/**
 * Percent Stat bonuses (`grants[kind: stat]` rows with a `percent`): rounding and the world setting that
 * picks when the percent is worked out. Shared by models, documents and settings.
 */
import { SYSTEM_ID } from '../../constants.mjs';

/** World setting key: `fixed` (book, Core Rulebook p.222) or `live` (house rule). */
export const PERCENT_STAT_SETTING = 'percentStatBonuses';
export const PERCENT_STAT_MODES = Object.freeze({ FIXED: 'fixed', LIVE: 'live' });

/**
 * The current mode. Anything but `live` (including an unregistered setting) reads as `fixed`.
 * @returns {'fixed'|'live'}
 */
export function percentStatMode() {
  let raw;
  try { raw = globalThis.game?.settings?.get?.(SYSTEM_ID, PERCENT_STAT_SETTING); } catch { raw = undefined; }
  return raw === PERCENT_STAT_MODES.LIVE ? PERCENT_STAT_MODES.LIVE : PERCENT_STAT_MODES.FIXED;
}

/**
 * `percent` % of `base`, rounded down toward negative infinity for both signs:
 * +10% of 15 is +1, -10% of 15 is -2.
 * @param {number} base the unenhanced score
 * @param {number} percent
 * @returns {number}
 */
export function roundPercent(base, percent) {
  const b = Number(base);
  const p = Number(percent);
  if (!Number.isFinite(b) || !Number.isFinite(p) || p === 0) return 0;
  return Math.floor((b * p) / 100) || 0;
}

/**
 * The stat rows of a `grants` list as display entries, in row order. A row with no flat and no percent is skipped; a
 * pool row is not a stat bonus and is skipped too. Reads `value`, `percent` and `locked` only.
 *
 * `state` says what to print after the amounts:
 * - `live`: the percent follows the score. With an owner (`unenhanced` given) `now` is today's number, else `null`.
 * - `locked`: fixed mode, the number stored on the row (`now` is that number).
 * - `unlocked`: fixed mode on an owned row whose `locked` is empty.
 * - `plain`: no percent, or fixed mode with no owner: nothing extra.
 *
 * @param {Array|object|null|undefined} grants `system.grants`
 * @param {object} [opts]
 * @param {'fixed'|'live'} [opts.mode] default: the world setting
 * @param {object|null} [opts.unenhanced] the owner's unenhanced scores by stat (`{ str: 15, ... }`); absent = no owner
 * @returns {Array<{ index: number, stat: string, flat: number, percent: number, state: 'live'|'locked'|'unlocked'|'plain', now: number|null }>}
 */
export function statGrantEntries(grants, { mode = percentStatMode(), unenhanced = null } = {}) {
  const list = Array.isArray(grants) ? grants : Object.values(grants ?? {});
  const owned = Boolean(unenhanced) && typeof unenhanced === 'object';
  const out = [];
  list.forEach((row, index) => {
    if (row?.kind !== 'stat' || row.mode === 'pool') return;
    const flat = Number(row.value) || 0;
    const percent = Number(row.percent) || 0;
    if (flat === 0 && percent === 0) return;
    const stat = String(row.stat ?? '').toLowerCase();
    let state = 'plain';
    let now = null;
    if (percent !== 0) {
      if (mode === PERCENT_STAT_MODES.LIVE) {
        state = 'live';
        if (owned) now = roundPercent(unenhanced[stat], percent);
      } else if (row.locked !== null && row.locked !== undefined && row.locked !== '' && Number.isFinite(Number(row.locked))) {
        state = 'locked';
        now = Number(row.locked);
      } else if (owned) {
        state = 'unlocked';
      }
    }
    out.push({ index, stat, flat, percent, state, now });
  });
  return out;
}

/**
 * The scores a percent is taken from, by stat, for an actor's `system.abilities`.
 * @param {object|null|undefined} abilities
 * @returns {Record<string, number>|null} null with no abilities
 */
export function unenhancedScores(abilities) {
  if (!abilities || typeof abilities !== 'object') return null;
  const out = {};
  for (const stat of ['str', 'dex', 'con', 'int', 'cha']) {
    const raw = abilities[stat]?.unenhanced;
    const n = raw === null || raw === undefined || raw === '' ? NaN : Number(raw);
    const v = Number(abilities[stat]?.value);
    out[stat] = Number.isFinite(n) ? n : (Number.isFinite(v) ? v : 10);
  }
  return out;
}
