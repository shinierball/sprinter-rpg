/**
 * The ways a Skill gains Ranks ("routes") and the per-skill limits on them (`system.rankLimits`). Pure: no Foundry, no I/O.
 * A route limit is a separate check from the Rank cap (`getRankCap` in `rank-cap.mjs`, the one place the cap is read; its
 * pre-Race-and-Class limit and high-Rank rule live in `rank-limits.mjs`): the cap bounds every route, a limit bounds one.
 * Item rank bonuses (gear, buffs, `rank_bonus` grants) are not advancement and are never limited.
 */

/** Core route ids. */
export const ADVANCEMENT_ROUTES = Object.freeze({ use: 'use', grind: 'grind', training: 'training', magic: 'magic' });

const ROUTE_ID = /^[A-Za-z][\w.-]*$/;

/** @type {Record<string, { id: string, label: string, hint: string, provider: string }>} `CONFIG.COG.advancementRoutes` is this same object. */
export const ADVANCEMENT_ROUTE_DEFS = {};
const priorities = new Map();

/**
 * Declare a route. Modules prefix their ids ('my-module.guild'); the core ids are seeded below.
 * @returns {boolean} whether the declaration took effect (a bad id, no label, or an equal-or-higher priority owner refuses it)
 */
export function registerAdvancementRoute(def, { priority = 10, provider = 'core' } = {}) {
  if (!def || typeof def !== 'object' || typeof def.id !== 'string' || !ROUTE_ID.test(def.id)) {
    console.warn(`Sprinter RPG | registerAdvancementRoute refused "${def?.id}": the id is not a valid route id.`);
    return false;
  }
  if (typeof def.label !== 'string' || !def.label.trim()) {
    console.warn(`Sprinter RPG | registerAdvancementRoute refused "${def.id}": a label is required.`);
    return false;
  }
  const current = priorities.get(def.id);
  if (current !== undefined && current >= priority) {
    console.warn(`Sprinter RPG | registerAdvancementRoute refused "${def.id}": already registered at an equal or higher priority.`);
    return false;
  }
  priorities.set(def.id, priority);
  ADVANCEMENT_ROUTE_DEFS[def.id] = { id: def.id, label: def.label.trim(), hint: typeof def.hint === 'string' ? def.hint : '', provider };
  return true;
}

registerAdvancementRoute({ id: ADVANCEMENT_ROUTES.use, label: 'Use', hint: 'The Used mark and its Skill Advancement Check, in a batch or ad hoc, and an untrained use becoming Rank 1.' }, { priority: 0 });
registerAdvancementRoute({ id: ADVANCEMENT_ROUTES.grind, label: 'Grinding', hint: 'Grind hours put into the skill.' }, { priority: 0 });
registerAdvancementRoute({ id: ADVANCEMENT_ROUTES.training, label: 'Training', hint: 'A training room in a personal space.' }, { priority: 0 });
registerAdvancementRoute({ id: ADVANCEMENT_ROUTES.magic, label: 'Magic', hint: 'A potion, scroll or item outcome that raises the skill, and the Grant Skill Rank button.' }, { priority: 0 });

/** The gain sources (`applyRankGain`'s `source`, and `magic` for `increaseSkillRank`) that belong to each core route. */
const SOURCE_ROUTE = Object.freeze({
  check: ADVANCEMENT_ROUTES.use,
  batch: ADVANCEMENT_ROUTES.use,
  untrained: ADVANCEMENT_ROUTES.use,
  grind: ADVANCEMENT_ROUTES.grind,
  training: ADVANCEMENT_ROUTES.training,
  magic: ADVANCEMENT_ROUTES.magic
});

/** The route a gain source belongs to, or null for a source no route claims (limited by the Rank cap alone). */
export function routeOfSource(source) {
  return Object.hasOwn(SOURCE_ROUTE, source) ? SOURCE_ROUTE[source] : null;
}

/**
 * A skill's limit for a route: the lowest `maxRank` among its rows for that route (0 = never), or null for none.
 * Rows with a blank, negative or non-numeric `maxRank` are ignored.
 */
export function routeLimit(skill, route) {
  const rows = skill?.system?.rankLimits ?? skill?.rankLimits;
  if (!Array.isArray(rows)) return null;
  let limit = null;
  for (const row of rows) {
    if (!row || row.route !== route || row.maxRank === null || row.maxRank === undefined || row.maxRank === '') continue;
    const n = Number(row.maxRank);
    if (!Number.isFinite(n) || n < 0) continue;
    const max = Math.trunc(n);
    if (limit === null || max < limit) limit = max;
  }
  return limit;
}

/** Whether one more Rank by `route` is within the skill's limits at `rank` (default: the skill's own Rank). A null route is never limited. */
export function routeAllowsGain(skill, route, rank = skill?.system?.rank ?? skill?.rank) {
  if (!route) return true;
  const limit = routeLimit(skill, route);
  return limit === null || (Number(rank) || 0) < limit;
}

/** The registered routes still open at `rank`, in registry order. */
export function openRoutes(skill, rank) {
  return Object.keys(ADVANCEMENT_ROUTE_DEFS).filter(id => routeAllowsGain(skill, id, rank));
}

/** A skill's `rankLimits` as stored: only rows naming a route with a whole `maxRank` of 0 or more (a blank limit is no row). */
export function cleanRankLimits(rows) {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter(row => row && typeof row.route === 'string' && row.route && row.maxRank !== null && row.maxRank !== undefined && row.maxRank !== '' && Number.isFinite(Number(row.maxRank)) && Number(row.maxRank) >= 0)
    .map(row => ({ route: row.route, maxRank: Math.trunc(Number(row.maxRank)) }));
}

/** The rows that make a skill magic only (use, grinding and training at 0; magic stays open): the sheet's Magic only preset and the specs' conversion. */
export function magicOnlyLimits() {
  return [ADVANCEMENT_ROUTES.use, ADVANCEMENT_ROUTES.grind, ADVANCEMENT_ROUTES.training].map(route => ({ route, maxRank: 0 }));
}
