/**
 * Skill Rank cap. The book's soft cap is Rank 15. `getRankCap` is the single place the cap is read:
 * skill advancement (`applyRankGain`), training, grinding and the sheet's rank input all call it.
 * Going above the cap is a Rule Break, never a block.
 */
import { getItemAllTags } from '../data/tags.mjs';
import { getActiveModifierSources } from './damage-modifiers.mjs';

export const SKILL_SOFT_CAP = 15;

const finite = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Whether a fixed `rank_cap` row applies to this skill: by `identifier`, or by `tag`.
 * Choice rows that were never resolved match nothing.
 * @param {object} grant
 * @param {object} item The skill
 * @param {Set<string>} tagSet The skill's tags
 * @returns {boolean}
 */
function capRowMatches(grant, item, tagSet) {
  if (grant?.kind !== 'rank_cap' || grant.mode === 'choice') return false;
  if (grant.identifier) return Boolean(item?.system?.identifier) && grant.identifier === item.system.identifier;
  if (grant.tag) return tagSet.has(grant.tag);
  return false;
}

/**
 * The highest Rank a skill can reach through advancement: the maximum of the skill's own `maxRank`
 * (when set), the soft cap, and every matching `rank_cap` grant on the actor's active sources (equipped
 * gear, active buffs, race, class, owned skills).
 * @param {object} [actor]
 * @param {object} [item] The skill
 * @returns {number}
 */
export function getRankCap(actor, item) {
  let cap = SKILL_SOFT_CAP;
  cap = Math.max(cap, finite(item?.system?.maxRank) ?? 0);
  if (!actor || !item) return cap;

  const raw = item.allTags instanceof Set ? item.allTags : getItemAllTags(item);
  const tagSet = raw instanceof Set ? raw : new Set(raw || []);
  for (const source of getActiveModifierSources(actor)) {
    const grants = source?.system?.grants;
    if (!Array.isArray(grants)) continue;
    for (const g of grants) {
      if (!capRowMatches(g, item, tagSet)) continue;
      const value = finite(g.value);
      if (value !== null) cap = Math.max(cap, value);
    }
  }
  return cap;
}

/**
 * The item's own Rank ceiling (`system.rankCeiling`, skills and spells): a hard "this never goes above N",
 * such as Heal's Rank 1. `null` means no ceiling. Unlike `getRankCap` (the advancement soft cap, which
 * can only be raised), this is a limit on the item itself. The Floor Simulator clamps against it; other
 * readers are a follow-up.
 * @param {object} [item]
 * @returns {number|null}
 */
export function getRankCeiling(item) {
  const raw = item?.system?.rankCeiling;
  if (raw === null || raw === undefined || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : null;
}

/** Whether a grant is a `rank_cap` choice row that still needs a pick. */
export const isRankCapChoice = (g) => g?.kind === 'rank_cap' && g.mode === 'choice';

/**
 * The fixed `rank_cap` rows replacing one choice row: one per pick made for it.
 * @param {object} grant The choice row
 * @param {number} grantIndex Its index in the source item's grants
 * @param {Array<{grantIndex: number, identifier: string}>} picks
 * @returns {object[]}
 */
export function rankCapRowsFor(grant, grantIndex, picks = []) {
  return picks
    .filter(pick => pick?.grantIndex === grantIndex && pick.identifier)
    .map(pick => ({ kind: 'rank_cap', mode: 'fixed', identifier: pick.identifier, value: grant.value, label: grant.label ?? '' }));
}

/**
 * Replaces each unresolved `rank_cap` choice row in a grants list with fixed rows naming the chosen
 * skills (create-once: the embedded copy keeps the player's pick). Rows whose pick is missing are dropped.
 * @param {object[]} grants The source item's grants
 * @param {Array<{grantIndex: number, identifier: string}>} picks One entry per picked skill
 * @returns {object[]} A new grants list
 */
export function resolveRankCapChoices(grants, picks = []) {
  return (Array.isArray(grants) ? grants : [])
    .flatMap((g, index) => (isRankCapChoice(g) ? rankCapRowsFor(g, index, picks) : [g]));
}
