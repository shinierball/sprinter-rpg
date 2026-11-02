/**
 * Rank-break schema fields and unified cumulative resolver for Sprinter RPG.
 */
import { getItemRank } from '../data/tags.mjs';

/**
 * Formats one rank-break entry of a skill/spell for display in a chat card.
 * Falls back to the legacy upgrade text only when the structured break yields nothing.
 * @param {object} [rb] Structured rank break (`system.rankBreaks.rankN`).
 * @param {string} [legacy] Legacy upgrade text (`system.upgrades.rankN`).
 * @param {{ labelOf?: (ref: string) => string }} [options] `labelOf` names a referenced debuff or condition (an id such
 *   as `stage-fright` or `condition.poisoned`); without it the raw reference is shown.
 * @returns {string}
 */
export function formatRankBreak(rb, legacy, { labelOf = (ref) => ref } = {}) {
  const parts = [];
  if (rb) {
    if (rb.damageDice) parts.push(`+${rb.damageDice.replace(/^\+/, '')} Dmg`);
    if (rb.rankDamageDice && Number(rb.rankDamageDice) > 0) parts.push(`+${rb.rankDamageDice} Rank ${Number(rb.rankDamageDice) === 1 ? 'Die' : 'Dice'}${rb.rankDiceSource === 'self' ? ' (own Rank)' : ''}`);
    if (rb.buffsResistances) parts.push(`Buff/Resist: ${rb.buffsResistances}`);
    if (rb.debuff) parts.push(`${rb.debuffOn === 'crit' ? 'Debuff on a critical hit' : 'Debuff'}: [${labelOf(rb.debuff)}]`);
    if (rb.contest?.dcBonus && Number(rb.contest.dcBonus) > 0) parts.push(`+${rb.contest.dcBonus} Contest DC`);
    if (rb.contest?.onFailDebuff) parts.push(`Fail Debuff: [${labelOf(rb.contest.onFailDebuff)}]`);
    if (rb.toHitBonus && Number(rb.toHitBonus) > 0) parts.push(`+${rb.toHitBonus} To-Hit`);
    if (rb.checkBonus && Number(rb.checkBonus) > 0) parts.push(`+${rb.checkBonus} Check`);
    if (rb.baseDiceMultiplier && Number(rb.baseDiceMultiplier) > 1) parts.push(`Base Dice ×${rb.baseDiceMultiplier}`);
    if (rb.healing?.barsBonus && Number(rb.healing.barsBonus) > 0) parts.push(`+${rb.healing.barsBonus} Healing Bar${Number(rb.healing.barsBonus) === 1 ? '' : 's'}`);
    if (rb.healing?.cleanseDebuff) parts.push(`Cleanse: [${labelOf(rb.healing.cleanseDebuff)}]`);
    if (rb.area?.radiusBonus && Number(rb.area.radiusBonus) > 0) parts.push(`+${rb.area.radiusBonus}ft Radius`);
    if (rb.area?.lineLengthBonus && Number(rb.area.lineLengthBonus) > 0) parts.push(`+${rb.area.lineLengthBonus}ft Line Length`);
    if (rb.area?.lineWidthBonus && Number(rb.area.lineWidthBonus) > 0) parts.push(`+${rb.area.lineWidthBonus}ft Line Width`);
    if (rb.area?.splashBonus && Number(rb.area.splashBonus) > 0) parts.push(`+${rb.area.splashBonus}ft Splash`);
    if (rb.onHit?.healBonus && Number(rb.onHit.healBonus) > 0) parts.push(`+${rb.onHit.healBonus} Life Drain slot${Number(rb.onHit.healBonus) === 1 ? '' : 's'}`);
    if (rb.rangeBonus && Number(rb.rangeBonus) > 0) parts.push(`+${rb.rangeBonus}ft Range`);
    if (rb.durationBonus && Number(rb.durationBonus) > 0) parts.push(`+${rb.durationBonus} Duration`);
    if (rb.tempBars?.barsGranted && Number(rb.tempBars.barsGranted) > 0) parts.push(`+${rb.tempBars.barsGranted} Temp Bar${Number(rb.tempBars.barsGranted) === 1 ? '' : 's'}`);
    if (rb.tempBars?.hpPerSlot && Number(rb.tempBars.hpPerSlot) > 0) parts.push(`+${rb.tempBars.hpPerSlot} HP/Slot`);
    if (rb.notes) parts.push(rb.notes);
  }
  if (parts.length === 0 && legacy && legacy !== 'None') {
    return legacy;
  }
  return parts.join(' | ');
}

/**
 * Creates the DataModel schema field for a single rank-break tier.
 * @param {object} fields `foundry.data.fields`
 * @param {number} defaultRank Default threshold rank for this tier (5, 10, 15, or 20)
 * @param {() => object} [extras] extra schema entries for the tier. The spell and skill models pass the timing overrides
 *   (3.12 D8: `cooldown` and `duration`, null = this tier leaves it alone; the highest reached tier with one wins). They
 *   come from the models because base-item-model must not be imported from here (it extends a Foundry class at load).
 * @returns {fields.SchemaField}
 */
export function rankBreakTierField(fields, defaultRank, extras = () => ({})) {
  return new fields.SchemaField({
    ...extras(),
    rank: new fields.NumberField({ integer: true, min: 1, max: 20, initial: defaultRank }),
    critMultiplier: new fields.NumberField({ integer: true, min: 1, initial: 1 }),
    damageDice: new fields.StringField({ initial: '' }),
    damageType: new fields.StringField({ initial: '' }),
    baseDiceCountMod: new fields.StringField({ initial: '' }),
    baseDiceMultiplier: new fields.NumberField({ integer: true, min: 1, initial: 1 }),
    rankDamageDice: new fields.NumberField({ integer: true, min: 0, initial: 0 }),
    // Whose rank sizes the granted Rank damage die: 'attack' = the Attack Skill making the attack (an unnamed grant,
    // "Add 1 Rank damage die"), 'self' = this skill or spell's own rank (a named grant, "1 Rank damage die of its own").
    rankDiceSource: new fields.StringField({ initial: 'attack', choices: ['attack', 'self'] }),
    buffsResistances: new fields.StringField({ initial: '' }),
    debuff: new fields.StringField({ initial: '' }),
    debuffOn: new fields.StringField({ initial: 'hit', choices: ['hit', 'crit'] }),
    notes: new fields.StringField({ initial: '' }),
    isArmorPiercing: new fields.BooleanField({ initial: false }),
    tags: new fields.ArrayField(new fields.StringField(), { initial: [] }),
    rangeBonus: new fields.NumberField({ min: 0, initial: 0 }),
    durationBonus: new fields.NumberField({ min: 0, initial: 0 }),
    toHitBonus: new fields.NumberField({ integer: true, initial: 0 }),
    checkBonus: new fields.NumberField({ integer: true, initial: 0 }),
    healing: new fields.SchemaField({
      barsBonus: new fields.NumberField({ integer: true, initial: 0 }),
      cleanseDebuff: new fields.StringField({ initial: '' })
    }),
    contest: new fields.SchemaField({
      dcBonus: new fields.NumberField({ integer: true, initial: 0 }),
      onFailDebuff: new fields.StringField({ initial: '' })
    }),
    area: new fields.SchemaField({
      radiusBonus: new fields.NumberField({ integer: true, initial: 0 }),
      lineLengthBonus: new fields.NumberField({ min: 0, initial: 0 }),
      lineWidthBonus: new fields.NumberField({ min: 0, initial: 0 }),
      splashBonus: new fields.NumberField({ min: 0, initial: 0 })
    }),
    tempBars: new fields.SchemaField({
      hpPerSlot: new fields.NumberField({ integer: true, initial: 0 }),
      barsGranted: new fields.NumberField({ integer: true, initial: 0 })
    }),
    interrupt: new fields.SchemaField({
      rangeBonus: new fields.NumberField({ integer: true, initial: 0 }),
      drBonus: new fields.NumberField({ integer: true, min: 0, initial: 0 }),
      ignoreDebuffs: new fields.BooleanField({ initial: false })
    }),
    // Extra Health Bar slots the item's On Hit lifesteal heals (cumulative; read with the lifesteal block, 3.13-2).
    onHit: new fields.SchemaField({
      healBonus: new fields.NumberField({ integer: true, min: 0, initial: 0 })
    }),
    // Light-source upgrades. `leash` null and `mode` '' mean "this tier does not set it"; the highest
    // reached tier that sets one wins. Bonuses add up. `canDouble` / `canAttach` unlock the HUD toggles.
    light: new fields.SchemaField({
      brightBonus: new fields.NumberField({ min: 0, initial: 0 }),
      dimBonus: new fields.NumberField({ min: 0, initial: 0 }),
      leash: new fields.NumberField({ min: 0, initial: null, nullable: true }),
      mode: new fields.StringField({ initial: '', blank: true, choices: ['', 'carried', 'free'] }),
      canDouble: new fields.BooleanField({ initial: false }),
      canAttach: new fields.BooleanField({ initial: false })
    })
  });
}

/**
 * Creates the DataModel schema field for all 4 rank breaks (rank5, rank10, rank15, rank20).
 * @param {object} fields `foundry.data.fields`
 * @returns {fields.SchemaField}
 */
export function rankBreaksField(fields, extras = () => ({})) {
  return new fields.SchemaField({
    rank5: rankBreakTierField(fields, 5, extras),
    rank10: rankBreakTierField(fields, 10, extras),
    rank15: rankBreakTierField(fields, 15, extras),
    rank20: rankBreakTierField(fields, 20, extras)
  });
}

/**
 * Evaluates reached rank-break tiers for an item or system object and aggregates all bonuses cumulatively.
 * @param {object} itemOrSystem
 * @param {number} [currentRank] Optional explicit current rank override
 * @returns {object} Aggregated rank break bonuses
 */
export function resolveReachedRankBreaks(itemOrSystem, currentRank) {
  const sys = itemOrSystem?.system || itemOrSystem || {};
  const rank = currentRank !== undefined
    ? Number(currentRank)
    : (Number(sys.modifiedRank ?? sys.totalRank ?? sys.rank) || 1);
  const rb = sys.rankBreaks || {};

  // Standard keys fall back to their default threshold; custom keys (attack/gear ObjectField) need an explicit `rank`.
  const DEFAULT_THRESHOLDS = { rank5: 5, rank10: 10, rank15: 15, rank20: 20 };
  const TIERS = Object.keys(rb)
    .map(key => ({ key, defThresh: DEFAULT_THRESHOLDS[key] ?? 0, order: Number(rb[key]?.rank) || DEFAULT_THRESHOLDS[key] || 0 }))
    .filter(t => t.order > 0 && rb[t.key] && typeof rb[t.key] === 'object')
    .sort((x, y) => x.order - y.order);

  const result = {
    reachedTiers: [],
    rangeBonus: 0,
    durationBonus: 0,
    cooldownOverride: null,
    durationOverride: null,
    toHitBonus: 0,
    checkBonus: 0,
    area: {
      radiusBonus: 0,
      lineLengthBonus: 0,
      lineWidthBonus: 0,
      splashBonus: 0
    },
    healing: {
      barsBonus: 0,
      cleanseDebuff: false,
      cleansedDebuffs: []
    },
    contest: {
      dcBonus: 0,
      onFailDebuff: ''
    },
    interrupt: {
      rangeBonus: 0,
      drBonus: 0,
      ignoreDebuffs: false
    },
    onHit: {
      healBonus: 0
    },
    light: {
      brightBonus: 0,
      dimBonus: 0,
      leash: null,
      mode: '',
      canDouble: false,
      canAttach: false
    },
    tempBars: {
      barsGranted: 0,
      hpPerSlot: 0
    },
    critMultiplier: 1,
    critRank: 0,
    baseDiceMultiplier: 1,
    baseDiceCountMod: 0,
    isArmorPiercing: false,
    debuffs: [],
    onHitDebuffs: [],
    onCritDebuffs: [],
    damageDice: [],
    damageType: '',
    rankDamageDice: 0,
    selfRankDamageDice: 0
  };

  for (const { key, defThresh } of TIERS) {
    const tier = rb[key];
    if (!tier) continue;
    const thresh = Number(tier.rank) || defThresh;
    if (rank < thresh) continue;

    result.reachedTiers.push({ key, tier, rank: thresh });

    if (tier.rangeBonus) result.rangeBonus += Number(tier.rangeBonus) || 0;
    if (tier.durationBonus) result.durationBonus += Number(tier.durationBonus) || 0;
    if (tier.cooldown && typeof tier.cooldown === 'object') result.cooldownOverride = tier.cooldown;
    if (tier.duration && typeof tier.duration === 'object') result.durationOverride = tier.duration;
    if (tier.toHitBonus) result.toHitBonus += Number(tier.toHitBonus) || 0;
    if (tier.checkBonus) result.checkBonus += Number(tier.checkBonus) || 0;

    if (tier.area?.radiusBonus) result.area.radiusBonus += Number(tier.area.radiusBonus) || 0;
    if (tier.area?.lineLengthBonus) result.area.lineLengthBonus += Number(tier.area.lineLengthBonus) || 0;
    if (tier.area?.lineWidthBonus) result.area.lineWidthBonus += Number(tier.area.lineWidthBonus) || 0;
    if (tier.area?.splashBonus) result.area.splashBonus += Number(tier.area.splashBonus) || 0;

    if (tier.healing?.barsBonus) result.healing.barsBonus += Number(tier.healing.barsBonus) || 0;
    if (tier.healing?.cleanseDebuff) {
      result.healing.cleanseDebuff = true;
      if (typeof tier.healing.cleanseDebuff === 'string' && tier.healing.cleanseDebuff.trim()) {
        result.healing.cleansedDebuffs.push(tier.healing.cleanseDebuff.trim());
      }
    }

    if (tier.contest?.dcBonus) result.contest.dcBonus += Number(tier.contest.dcBonus) || 0;
    if (tier.contest?.onFailDebuff) result.contest.onFailDebuff = tier.contest.onFailDebuff;

    if (tier.interrupt?.rangeBonus) result.interrupt.rangeBonus += Number(tier.interrupt.rangeBonus) || 0;
    if (tier.interrupt?.drBonus) result.interrupt.drBonus += Math.max(0, Number(tier.interrupt.drBonus) || 0);
    if (tier.interrupt?.ignoreDebuffs === true) result.interrupt.ignoreDebuffs = true;
    if (tier.onHit?.healBonus) result.onHit.healBonus += Math.max(0, Number(tier.onHit.healBonus) || 0);

    if (tier.light) {
      result.light.brightBonus += Number(tier.light.brightBonus) || 0;
      result.light.dimBonus += Number(tier.light.dimBonus) || 0;
      if (tier.light.leash != null && Number.isFinite(Number(tier.light.leash))) result.light.leash = Number(tier.light.leash);
      if (tier.light.mode === 'carried' || tier.light.mode === 'free') result.light.mode = tier.light.mode;
      if (tier.light.canDouble) result.light.canDouble = true;
      if (tier.light.canAttach) result.light.canAttach = true;
    }

    if (tier.tempBars?.barsGranted) result.tempBars.barsGranted += Number(tier.tempBars.barsGranted) || 0;
    if (tier.tempBars?.hpPerSlot) result.tempBars.hpPerSlot += Number(tier.tempBars.hpPerSlot) || 0;

    if (tier.critMultiplier && Number(tier.critMultiplier) > 1) {
      if (Number(tier.critMultiplier) >= result.critMultiplier) result.critRank = thresh;
      result.critMultiplier = Math.max(result.critMultiplier, Number(tier.critMultiplier));
    }

    if (tier.isArmorPiercing) {
      result.isArmorPiercing = true;
    }

    if (tier.baseDiceCountMod) {
      const m = parseInt(String(tier.baseDiceCountMod).replace('+', ''), 10);
      if (Number.isFinite(m)) result.baseDiceCountMod += m;
    }

    if (tier.baseDiceMultiplier && Number(tier.baseDiceMultiplier) > 1) {
      result.baseDiceMultiplier = Math.max(result.baseDiceMultiplier, Number(tier.baseDiceMultiplier));
    }

    if (tier.debuff) {
      result.debuffs.push(tier.debuff);
      if (tier.debuffOn === 'crit') {
        result.onCritDebuffs.push(tier.debuff);
      } else {
        result.onHitDebuffs.push(tier.debuff);
      }
    }

    if (tier.damageDice) result.damageDice.push(tier.damageDice);
    if (tier.damageType) result.damageType = tier.damageType;
    if (tier.rankDamageDice) {
      const n = Number(tier.rankDamageDice) || 0;
      result.rankDamageDice += n;
      if (tier.rankDiceSource === 'self') result.selfRankDamageDice += n;
    }
  }

  return result;
}

/**
 * Shared alias for resolveReachedRankBreaks.
 */
export const aggregateRankBreakBonuses = resolveReachedRankBreaks;

/**
 * The reached rank-break check and to-hit bonuses of a skill or spell as typed roll-modifier rows, so they go through
 * the same evaluation as `checkModifiers` / `attackModifiers` rows (Q-B2). `checkBonus` applies to every roll of the
 * item, attacks included; `toHitBonus` to attacks only. Items that are not skills or spells yield no rows.
 * @param {object} item
 * @returns {{ checkModifiers: object[], attackModifiers: object[] }}
 */
export function rankBreakRollRows(item) {
  const out = { checkModifiers: [], attackModifiers: [] };
  if (!item || !['skill', 'spell'].includes(item.type) || !item.system?.rankBreaks) return out;
  const reached = resolveReachedRankBreaks(item, getItemRank(item));
  if (reached.checkBonus) out.checkModifiers.push({ label: 'Rank Break Check', value: reached.checkBonus });
  if (reached.toHitBonus) out.attackModifiers.push({ label: 'Rank Break To-Hit', value: reached.toHitBonus });
  return out;
}
