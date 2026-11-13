/**
 * The one wording for a rank-break tier in an item summary, shared by spells, skills and weapons (CONTRIBUTING rule 5).
 *
 * `rankBreakBody(tier)` is `formatRankBreak` (the cast card's text) plus `tierExtras` (what `formatRankBreak` has no
 * wording for: crit multiplier, damage type, base dice, Ignores DR, timing, interrupt, light). `rankBreakLine`
 * wraps it as "At Rank N: ..." for a break still to come and "From Rank N: ..." for one the owner has reached. A
 * reached break leaves out its damage fields, because the damage line already carries them.
 * Strings live under `COG.ItemSummary.SpellSkill` in lang/en.json.
 */
import { itemLine, t, conditionRefName, defineItemSummaryTemplates, str, whole } from './shared.mjs';
import { formatRankBreak } from '../skill/rank-breaks.mjs';
import { durationSpec } from '../time/durations.mjs';
import { getTagDefinition } from '../../data/tag-definitions.mjs';
import { normalizeTagList } from '../tag/tag-query.mjs';
import { formatTiming, normalizeTiming } from '../time/timing.mjs';

const KEY = 'COG.ItemSummary.SpellSkill';

defineItemSummaryTemplates({
  [`${KEY}.AtRank`]: 'At Rank {rank}: {text}',
  [`${KEY}.FromRank`]: 'From Rank {rank}: {text}',
  [`${KEY}.TierCrit`]: 'Critical Hit: {n}x base dice',
  [`${KEY}.TierBaseDice`]: 'Base dice {mod}',
  [`${KEY}.TierDamageType`]: '{type} damage',
  [`${KEY}.TierIgnoresDr`]: 'Ignores DR',
  [`${KEY}.TierTags`]: 'Adds tags: {tags}',
  [`${KEY}.TierCooldown`]: 'Cooldown: {text}',
  [`${KEY}.TierDuration`]: 'Duration: {text}',
  [`${KEY}.TierInterruptRange`]: '+{n}ft interrupt range',
  [`${KEY}.TierInterruptDr`]: '+{n} DR while interrupting',
  [`${KEY}.TierInterruptIgnore`]: 'Interrupt ignores debuffs',
  [`${KEY}.TierLightBright`]: '+{n}ft bright light',
  [`${KEY}.TierLightDim`]: '+{n}ft dim light',
  [`${KEY}.TierLightLeash`]: 'Light leash {n}ft',
  [`${KEY}.TierLightMode`]: 'Light {mode}',
  [`${KEY}.TierLightDouble`]: 'Light can double',
  [`${KEY}.TierLightAttach`]: 'Light can attach'
});

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const L = (key, data) => t(`${KEY}.${key}`, data);

/** What a tier adds beyond `formatRankBreak` (which has no crit, damage type, timing, interrupt or light wording).
 * `ownDamageType` is the item's own damage type: a tier that repeats it adds nothing and says nothing. */
function tierExtras(tier, ownDamageType = '') {
  const out = [];
  if (whole(tier.critMultiplier) > 1) out.push(L('TierCrit', { n: whole(tier.critMultiplier) }));
  const dice = str(tier.baseDiceCountMod);
  if (dice) out.push(L('TierBaseDice', { mod: dice }));
  if (str(tier.damageType) && str(tier.damageType).toLowerCase() !== str(ownDamageType).toLowerCase()) out.push(L('TierDamageType', { type: str(tier.damageType) }));
  if (tier.isArmorPiercing) out.push(L('TierIgnoresDr'));
  const tags = normalizeTagList(tier.tags);
  if (tags.length) out.push(L('TierTags', { tags: tags.map((id) => getTagDefinition(id)?.label || id).join(', ') }));
  if (isObj(tier.cooldown) && normalizeTiming(tier.cooldown).unit) out.push(L('TierCooldown', { text: formatTiming(tier.cooldown) }));
  if (isObj(tier.duration)) {
    const spec = durationSpec(tier.duration);
    if (spec.unit) {
      const text = formatTiming(spec, { use: 'duration' });
      out.push(L('TierDuration', { text: tier.duration.endsWithCombat ? L('EndsWithCombat', { text }) : text }));
    }
  }
  const i = isObj(tier.interrupt) ? tier.interrupt : {};
  if (Number(i.rangeBonus)) out.push(L('TierInterruptRange', { n: Math.trunc(Number(i.rangeBonus)) }));
  if (Number(i.drBonus) > 0) out.push(L('TierInterruptDr', { n: whole(i.drBonus) }));
  if (i.ignoreDebuffs) out.push(L('TierInterruptIgnore'));
  const lt = isObj(tier.light) ? tier.light : {};
  if (Number(lt.brightBonus) > 0) out.push(L('TierLightBright', { n: whole(lt.brightBonus) }));
  if (Number(lt.dimBonus) > 0) out.push(L('TierLightDim', { n: whole(lt.dimBonus) }));
  if (lt.leash !== null && lt.leash !== undefined && Number.isFinite(Number(lt.leash))) out.push(L('TierLightLeash', { n: whole(lt.leash) }));
  if (str(lt.mode)) out.push(L('TierLightMode', { mode: str(lt.mode) }));
  if (lt.canDouble) out.push(L('TierLightDouble'));
  if (lt.canAttach) out.push(L('TierLightAttach'));
  return out;
}

/**
 * The text of one tier. A reached tier leaves out its damage fields (the damage line has them). Notes are human text
 * and never appear. `legacy` is the old `upgrades` text, shown only when the structured tier yields nothing.
 * @param {object} tier
 * @param {{ reached?: boolean, legacy?: string, ignoresDrShown?: boolean, ownDamageType?: string }} [options] `ownDamageType` is left out of a tier that repeats it; `ignoresDrShown` is true when an
 *   "Ignores DR" line already carries a reached break's armor piercing (spells); weapons keep it in the break text.
 * @returns {string}
 */
function rankBreakBody(tier, { reached = false, legacy = '', ignoresDrShown = true, ownDamageType = '' } = {}) {
  if (!isObj(tier)) return reached ? '' : String(legacy || '');
  const shown = reached
    ? { ...tier, damageDice: '', rankDamageDice: 0, baseDiceMultiplier: 1, baseDiceCountMod: '', damageType: '', isArmorPiercing: ignoresDrShown ? false : tier.isArmorPiercing }
    : tier;
  const text = [formatRankBreak({ ...shown, notes: '' }, undefined, { labelOf: conditionRefName }), ...tierExtras(shown, ownDamageType)].filter(Boolean).join(' | ');
  return text || (reached ? '' : String(legacy || ''));
}

/** "At Rank N: ..." or, for a reached break, "From Rank N: ...". */
function rankBreakText(rank, body, reached) {
  return L(reached ? 'FromRank' : 'AtRank', { rank, text: body });
}

/**
 * One line for a tier, or null when it has nothing to say.
 * @param {string} kind line kind
 * @param {{ rank: number, tier: object, reached?: boolean, legacy?: string, ignoresDrShown?: boolean, ownDamageType?: string, rowPath: string }} spec
 */
export function rankBreakLine(kind, { rank, tier, reached = false, legacy = '', ignoresDrShown = true, ownDamageType = '', rowPath }) {
  const body = rankBreakBody(tier, { reached, legacy, ignoresDrShown, ownDamageType });
  return body ? { threshold: rank, line: itemLine(kind, rankBreakText(rank, body, reached), rowPath) } : null;
}
