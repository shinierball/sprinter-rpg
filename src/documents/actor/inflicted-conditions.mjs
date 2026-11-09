import { conditionTagId } from '../../utils/identifier.mjs';
import { resolveReachedRankBreaks } from '../../utils/skill/rank-breaks.mjs';
import { collectOnHitEffects } from '../../utils/attack/on-hit.mjs';
import { getSpellRank } from './spell-rank.mjs';

/**
 * Extract all condition tags inflicted by an item (spell, skill, attack, gear).
 * Aggregates explicit condition.* / id.debuff.* tags, onHit.debuffId, techniqueConfig.debuffId,
 * area and contest debuff references, and the debuffs and condition.* tags of reached rank breaks.
 * A rank break debuff with `debuffOn: 'crit'` is included only when `options.isCrit` is true.
 * @param {Actor} actor the actor the item belongs to (its rank for a spell)
 * @param {COGItem} item
 * @param {{isCrit?: boolean}} [options]
 * @returns {Array<string>} List of unique condition tag IDs (e.g. ['condition.queasy', ...])
 */
export function getItemInflictedConditions(actor, item, options = {}) {
  if (!item) return [];
  const sys = item.system || {};
  const rank = Number(getSpellRank(actor, item)) || Number(sys.rank) || 1;
  const conditionTags = [];

  const addCondition = (val) => {
    if (!val) return;
    if (Array.isArray(val)) {
      for (const v of val) addCondition(v);
      return;
    }
    if (typeof val !== 'string') return;
    const trimmed = val.trim();
    if (!trimmed) return;

    if (trimmed.includes(',')) {
      for (const part of trimmed.split(',')) addCondition(part);
      return;
    }

    let tag = trimmed;
    if (!tag.startsWith('condition.') && !tag.startsWith('id.debuff.')) tag = conditionTagId(tag);

    if (tag && !conditionTags.includes(tag)) {
      conditionTags.push(tag);
    }
  };

  // 1. Explicit condition tags or tags list on item
  if (Array.isArray(sys.tags)) {
    for (const t of sys.tags) {
      if (typeof t === 'string' && (t.startsWith('condition.') || t.startsWith('id.debuff.'))) {
        addCondition(t);
      }
    }
  }

  // 2. Direct on-hit condition / debuff
  for (const d of collectOnHitEffects({ sources: [{ item, rank }] }).debuffs) addCondition(d);

  // 3. Technique config condition / debuff
  if (sys.techniqueConfig?.debuffId) addCondition(sys.techniqueConfig.debuffId);

  // 4. Area condition tags / inflicted debuffs
  if (sys.area?.inflictedDebuffs) addCondition(sys.area.inflictedDebuffs);

  // 5. Contest on-fail condition / debuff
  if (sys.contest?.onFailDebuff) addCondition(sys.contest.onFailDebuff);

  // 6. Rank breaks conditions
  for (const { tier } of resolveReachedRankBreaks(item, rank).reachedTiers) {
    if (Array.isArray(tier.tags)) {
      for (const t of tier.tags) {
        if (typeof t === 'string' && t.startsWith('condition.')) addCondition(t);
      }
    }
    if (tier.debuff && (tier.debuffOn !== 'crit' || options?.isCrit === true)) addCondition(tier.debuff);
    if (tier.contest?.onFailDebuff) addCondition(tier.contest.onFailDebuff);
  }

  return conditionTags;
}
