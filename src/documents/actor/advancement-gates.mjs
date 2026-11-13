/**
 * The questions asked before a Rank is advanced a way the skill's `system.rankLimits` close (the use mark, an ad hoc
 * check, a batch, grind hours, a training session, a potion). Each asks the one Rule Break dialog and never hard-blocks;
 * a confirmed gain is recorded as a Rule Break. A route limit is separate from the Rank cap (`getRankCap`), which
 * `applyRankGain` asks about itself. Plain functions: no actor method (🧱 rail 6).
 */
import { SYSTEM_ID } from '../../constants.mjs';
import { confirmRuleBreak } from '../../utils/rule-break.mjs';
import { ADVANCEMENT_ROUTE_DEFS, ADVANCEMENT_ROUTES, openRoutes, routeAllowsGain, routeLimit } from '../../utils/skill/advancement-routes.mjs';

/** Flag on a skill that remembers a confirmed Rule Break for a route at a Rank (`{ route, rank }`), so the later gain does not ask again. */
const ROUTE_BREAK_FLAG = 'routeBreak';

const routeLabel = (route) => ADVANCEMENT_ROUTE_DEFS[route]?.label ?? route;
const rankOf = (skill) => Number(skill?.system?.rank ?? skill?.rank) || 0;

/** "does not advance by Use past Rank 5 (it advances by Training, Magic)": the shared wording of every route question. */
export function routeLimitPhrase(skill, route, rank = rankOf(skill)) {
  const open = openRoutes(skill, rank).map(routeLabel);
  const limit = routeLimit(skill, route);
  const past = limit > 0 ? ` past Rank ${limit}` : '';
  return `does not advance by ${routeLabel(route)}${past}${open.length ? ` (it advances by ${open.join(', ')})` : ''}`;
}

/** The skill's remembered route Rule Break, or null. */
function readStamp(skill) {
  const stamp = typeof skill?.getFlag === 'function' ? skill.getFlag(SYSTEM_ID, ROUTE_BREAK_FLAG) : skill?.flags?.[SYSTEM_ID]?.[ROUTE_BREAK_FLAG];
  return stamp && typeof stamp === 'object' ? stamp : null;
}

/** Whether the skill carries a stamp for this route at this Rank (a confirmed Rule Break not yet spent). */
export function hasRouteStamp(skill, route, rank = rankOf(skill)) {
  const stamp = readStamp(skill);
  return Boolean(stamp) && stamp.route === route && Number(stamp.rank) === Number(rank);
}

/** Remove the skill's stamp, when it has one. */
export async function clearRouteStamp(skill) {
  if (readStamp(skill) && typeof skill.unsetFlag === 'function') await skill.unsetFlag(SYSTEM_ID, ROUTE_BREAK_FLAG);
}

/**
 * Ask the route Rule Break for one skill when `route` is closed at `fromRank`. A matching stamp counts as already asked.
 * @param {Actor} actor
 * @param {Item|string} skill the owned skill, or its id
 * @param {string|null} route a route id (a null route is never limited)
 * @param {object} [p]
 * @param {number} [p.fromRank] the Rank the gain starts from (default: the skill's Rank)
 * @param {object} [p.options] passed to confirmRuleBreak (`ruleBreak: true` pre-confirms)
 * @param {string} [p.verb='Advance'] the action in the question ("Roll", "Put hours into", "Train")
 * @param {string[]} [p.also] other reasons for the same dialog ("has not been used since its last check")
 * @param {string} [p.title]
 * @param {boolean} [p.stamp=false] write the stamp when confirmed and keep an existing one (grind hours); otherwise a matching stamp is spent
 * @returns {Promise<{ok: boolean, ruleBreak: boolean, limited: boolean}>} `ruleBreak` is true when the way was closed and the gain was confirmed
 */
export async function confirmRouteGain(actor, skill, route, { fromRank, options = {}, verb = 'Advance', also = [], title, stamp = false } = {}) {
  const item = typeof skill === 'string' ? actor?.items?.get(skill) : skill;
  const rank = fromRank ?? rankOf(item);
  if (!item || routeAllowsGain(item, route, rank)) return { ok: true, ruleBreak: false, limited: false };

  if (hasRouteStamp(item, route, rank)) {
    if (!stamp) await clearRouteStamp(item);
    return { ok: true, ruleBreak: true, limited: true };
  }
  const reasons = [...also, routeLimitPhrase(item, route, rank)];
  const res = await confirmRuleBreak({
    title: title ?? 'Skill Does Not Advance This Way',
    message: `${item.name ?? 'This skill'} ${reasons.join(' and ')}. ${verb} anyway as a Rule Break?`,
    options
  });
  if (!res.confirmed) return { ok: false, ruleBreak: false, limited: true };
  if (stamp && typeof item.setFlag === 'function') await item.setFlag(SYSTEM_ID, ROUTE_BREAK_FLAG, { route, rank: Number(rank) || 0 });
  return { ok: true, ruleBreak: true, limited: true };
}

/**
 * One question for many skills held back by a route limit (a batch). Skills the route allows are not asked about.
 * @param {Actor} actor
 * @param {Item[]} skills
 * @param {string} route
 * @param {object} [p]
 * @param {object} [p.options] passed to confirmRuleBreak
 * @param {string} [p.verb='Roll']
 * @returns {Promise<Set<string>>} the ids of the limited skills the Rule Break was confirmed for (empty when none are limited or it was declined)
 */
export async function confirmRouteGains(actor, skills, route, { options = {}, verb = 'Roll' } = {}) {
  const limited = (skills ?? []).filter(s => !routeAllowsGain(s, route));
  if (!limited.length) return new Set();
  const names = limited.map(s => s.name ?? 'A skill').join(', ');
  const res = await confirmRuleBreak({
    title: 'Skills Do Not Advance This Way',
    message: `${names} ${limited.length === 1 ? 'does' : 'do'} not advance by ${routeLabel(route)} at ${limited.length === 1 ? 'its' : 'their'} current ${limited.length === 1 ? 'Rank' : 'Ranks'}${actor?.name ? ` (${actor.name})` : ''}. ${verb} ${limited.length === 1 ? 'it' : 'them'} anyway as a Rule Break?`,
    options
  });
  return res.confirmed ? new Set(limited.map(s => s.id)) : new Set();
}

/** A potion, scroll or item outcome taking an owned skill to `newRank`: asks once when that passes the skill's magic limit. */
export function confirmMagicGain(actor, skill, newRank, options = {}) {
  return confirmRouteGain(actor, skill, ADVANCEMENT_ROUTES.magic, { fromRank: newRank - 1, options, verb: 'Raise it' });
}

/** Putting grind hours into a skill: asks before they move when the grind route is closed (the stamp spares the next hours); removing hours never asks. */
export function confirmGrindAllocation(actor, skill, delta, options = {}) {
  if (!(delta > 0)) return { ok: true, ruleBreak: false, limited: false };
  return confirmRouteGain(actor, skill, ADVANCEMENT_ROUTES.grind, { options, verb: 'Put grind hours into it', stamp: true });
}
