/** Spell-only context: rank-gated tags, damage preview, healing and disclosure flags. */
import { COG_TAGS } from '../../data/tag-catalog.mjs';
import { RANK_BREAK_THRESHOLDS } from '../../data/tag-vocabulary.mjs';
import { getCustomTags, getTagDefinition } from '../../data/tag-definitions.mjs';
import { FAVORED_TAG_PREFIX } from '../../utils/tag/tag-mechanics.mjs';
import { hasOnHitDebuff } from '../../utils/attack/on-hit.mjs';
import { buildOnHitContext } from './context-on-hit.mjs';
import { normalizeBaseDamage, baseDamageDice } from '../../utils/damage/base-damage.mjs';
import { buildBaseDamageContext, buildHealingContext, buildRankBreakTagText, buildRankBreakViews } from './context-common.mjs';
import { deliveryModes, pickOptions, RANK_DICE_SOURCES } from '../../utils/ui/field-options.mjs';

/**
 * The Favored picker: the item's explicit `favored.*` tags as pills and the registered `favored.*` tags it does not
 * carry yet as options. The tag list is the mechanic (the non-favored mana penalty reads it); this only edits it.
 */
export function buildFavoredPicker(item) {
  const explicit = Array.isArray(item.system?.tags) ? item.system.tags : [];
  const label = (id) => String(getTagDefinition(id)?.label ?? id).replace(/^Favored:\s*/, '');
  const current = explicit.filter((t) => typeof t === 'string' && t.startsWith(FAVORED_TAG_PREFIX));
  const registered = [...COG_TAGS, ...getCustomTags()].map((t) => t.id).filter((id) => id?.startsWith(FAVORED_TAG_PREFIX));
  return {
    tags: current.map((id) => ({ id, label: label(id) })),
    options: [...new Set(registered)].filter((id) => !current.includes(id)).map((id) => ({ id, label: label(id) }))
  };
}

export function buildSpellContext(context, item) {
  const sys = context.system;
  buildOnHitContext(context);
  context.favoredPicker = buildFavoredPicker(item);
  buildRankBreakTagText(context, RANK_BREAK_THRESHOLDS);
  buildRankBreakViews(context, RANK_BREAK_THRESHOLDS);

  const dmgData = item.actor ? item.actor.getSpellDamageData(item) : null;
  if (dmgData) {
    context.hasDamage = dmgData.hasDamage;
    context.damageFormula = dmgData.formula;
  } else {
    // Unowned spell: the same early exits as COGActor#getSpellDamageData.
    const src = item.system || {};
    const base = normalizeBaseDamage(src.baseDamage);
    const mods = Array.isArray(src.rankDamageParts) ? src.rankDamageParts : [];
    context.hasDamage = Boolean(baseDamageDice(base) || mods.length > 0);
    context.damageFormula = base.dice || (mods.length ? mods.map((m) => m.dice || m.value).filter(Boolean).join(' + ') : '');
  }

  buildBaseDamageContext(context, { ownStatLabel: 'Spell stat' });
  buildHealingContext(context);
  context.deliveryOptions = pickOptions(deliveryModes(), sys.delivery);
  context.rank15DiceSourceOptions = pickOptions(RANK_DICE_SOURCES, sys.rankBreaks?.rank15?.rankDiceSource || 'attack');
  context.hasAuraConfigured = Boolean(sys.area?.hasArea);
  context.hasArmorPiercingConfigured = Boolean(sys.ignoreDR);
  context.hasRankDamagePartsConfigured = sys.rankDamageParts?.length > 0;
  context.hasConditionTriggersConfigured = Boolean(
    sys.fumbleDebuff || hasOnHitDebuff(sys) || Number(sys.critMultiplierR5) > 1 || Number(sys.critMultiplierR15) > 1
  );
}
