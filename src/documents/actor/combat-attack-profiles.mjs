/**
 * Combat: synthesized attack profiles from weapons and combat skills.
 */

import { conditionLabel } from './condition-data.mjs';
import { getGrantedRankDamageDie } from '../../data/rank-dice.mjs';
import { getItemAllTags } from '../../data/tags.mjs';
import { hasRuleFlag, RULE_FLAGS } from '../../utils/tag-behaviour.mjs';
import { isWeaponGear, DEFAULT_CRIT_MULTIPLIER, configuredCritMultiplier } from './actor-constants.mjs';
import { isOneHandedPenalty as hasOneHandedPenalty, isNaturalWeapon } from '../../utils/wielding.mjs';
import { isPassiveSkill, isAttackSkill, isTechniqueSkill, UNARMED_TAG } from '../../utils/tag-mechanics.mjs';
import { getDamageParts } from '../../utils/damage-parts.mjs';
import { attackToHitDisplay, attackToHitStat } from '../../utils/to-hit-display.mjs';
import { resolveReachedRankBreaks } from '../../utils/rank-breaks.mjs';
import { normalizeBaseDamage } from '../../utils/base-damage.mjs';
import { attackEffectsText } from '../../utils/attack-mechanics.mjs';

export const actorCombatAttackProfilesMixin = {
  /**
   * Generates synthesized attack profiles combining equipped weapons and combat skills.
   * Ensures offline players (via PDF) and VTT players have a complete, unified attack roster.
   * @returns {Array<object>}
   */
  getSynthesizedAttacks() {
    const attacks = [];
    const skills = this.items ? this.items.filter(i => i.type === 'skill') : [];

    // 1. Equipped Weapons and Dedicated Attack items
    const rawAttacks = this.items ? this.items.filter(i => (i.type === 'attack' && i.system?.equipped !== false) || (i.type === 'gear' && isWeaponGear(i) && i.system?.equipped)) : [];

    for (const item of rawAttacks) {
      const profile = this._buildWeaponAttackProfile(item, skills);
      if (profile) attacks.push(profile);
    }

    // 2. Unarmed / Combat Strike Skills (that function as primary attacks without requiring weapon gear)
    const attackSkills = skills.filter(s => {
      const sys = s.system || {};
      // Techniques modify an attack and passives have no roll: neither is a standalone attack.
      if (isTechniqueSkill(s) || isPassiveSkill(s)) return false;

      const sTags = s.allTags instanceof Set
        ? s.allTags
        : getItemAllTags(s);
      // Natural and unarmed attacks occupy no hand: any tag carrying the no-hands flag
      const handless = hasRuleFlag(sTags, RULE_FLAGS.noHands);

      // A skill requiring an equipped weapon cannot function as an unarmed attack
      const requiresWeapon = hasRuleFlag(sTags, RULE_FLAGS.requiresWeapon) ||
        (Array.from(sTags).some(t => t.startsWith('weapon.')) && !handless);
      // Natural attacks a table or GM never wants listed as a standalone attack (not a weapon requirement)
      if (requiresWeapon || hasRuleFlag(sTags, RULE_FLAGS.noStandaloneAttack)) return false;

      const isKnownUnarmed = handless;
      const isKnownAttack = isKnownUnarmed || isAttackSkill(s);

      if (sys.isAttack === false && !isKnownAttack) return false;

      return sys.isAttack === true || isKnownAttack;
    });

    for (const skill of attackSkills) {
      // A weapon profile already rolls with this skill: no separate skill attack.
      if (attacks.some(a => a.matchingSkillId && a.matchingSkillId === skill.id)) continue;
      const profile = this._buildSkillAttackProfile(skill);
      if (profile) attacks.push(profile);
    }

    return attacks;
  },

  _buildWeaponAttackProfile(item, skills = (this.items?.filter(i => i.type === 'skill') || [])) {
    const sys = item.system || {};
    const normName = (item.name || '').toLowerCase().trim();
    const isGear = item.type === 'gear';
    const skillList = Array.isArray(skills) ? skills : (this.items?.filter(i => i.type === 'skill') || []);
    const { matchingSkill, skillRank } = this._resolveWeaponSkills(item, skillList);

    const parts = getDamageParts(sys);
    const primaryPart = parts[0] || null;

    // The to-hit the roll would add with no toggle ticked: rank, stat, the actor's rows and the reached rank breaks (3.10)
    const toHitStat = attackToHitStat(item, matchingSkill, primaryPart);
    const isOneHandedPenalty = hasOneHandedPenalty(sys, { handless: isNaturalWeapon(item) });
    const hit = attackToHitDisplay(this, {
      item, skill: matchingSkill ?? null, stat: toHitStat, rank: skillRank, isOneHandedPenalty,
      tags: [sys.weaponCategory, sys.weaponType, sys.slot].filter(Boolean)
    });
    const { statMod, formula: toHitFormula } = hit;
    const toHitMod = hit.total;
    const displayToHitStat = toHitStat.toUpperCase();
    const displayToHitRank = skillRank;
    const displayToHit = `${displayToHitStat} (${skillRank})`;
    const favor = this.getAiFavorRating(item, { context: hit.rowContext, skill: matchingSkill });

    // Base damage and rank damage die
    let baseDice;
    let dmgType;
    const skillBaseDamage = matchingSkill ? normalizeBaseDamage(matchingSkill.system?.baseDamage) : null;
    if (skillBaseDamage?.dice) {
      baseDice = skillBaseDamage.dice;
      dmgType = skillBaseDamage.damageType || primaryPart?.type || 'Physical';
    } else {
      // An attack with no damage parts and no damage-granting skill deals no weapon damage.
      baseDice = primaryPart?.dice || '';
      dmgType = primaryPart?.type || 'Physical';
    }

    // The Table 37 Rank damage die shows only when a reached rank break grants one.
    const breakSource = matchingSkill?.system?.rankBreaks ? matchingSkill : item;
    const reachedBreaks = resolveReachedRankBreaks(breakSource, skillRank);
    const rankDie = skillRank > 0 ? getGrantedRankDamageDie(skillRank, reachedBreaks.rankDamageDice).dice : '';
    let combinedDice = rankDie ? (baseDice ? `${baseDice} + ${rankDie}` : rankDie) : baseDice;

    // Rank break extra dice
    for (const { tier } of reachedBreaks.reachedTiers) {
      if (tier.damageDice) combinedDice = `${combinedDice ? `${combinedDice} + ` : ''}${tier.damageDice.replace(/^\+/, '')}`;
    }

    // Include extra weapon damage parts additively
    const extraParts = (skillBaseDamage?.dice && parts.length > 0) ? parts : parts.slice(1);
    for (const ep of extraParts) {
      if (ep?.dice) {
        combinedDice = `${combinedDice ? `${combinedDice} + ` : ''}${ep.dice}${ep.type ? ` ${ep.type}` : ''}`;
      }
    }

    // A skill that supplies the Base Damage supplies its stat too ('none' = no stat; blank = the skill's own stat, else none); weapon parts add no stat then.
    const skillSuppliesDamage = Boolean(skillBaseDamage?.dice);
    const skillDmgStat = skillBaseDamage?.stat || '';
    const dmgStatKey = skillSuppliesDamage
      ? (skillDmgStat === 'none' ? '' : (skillDmgStat || matchingSkill.system?.stat || '').toLowerCase())
      : (primaryPart?.stat || skillDmgStat || matchingSkill?.system?.stat || toHitStat).toLowerCase();
    const dmgStatMod = this.system?.abilities?.[dmgStatKey]?.mod ?? 0;
    const displayDmgMod = dmgStatMod >= 0 ? `+${dmgStatMod}` : `${dmgStatMod}`;
    const typeStr = dmgType ? ` (${dmgType})` : '';
    const extraPartsCount = (skillBaseDamage?.dice && parts.length > 0) ? parts.length : (parts.length > 1 ? parts.length - 1 : 0);
    const extra = extraPartsCount > 0 ? ` (+${extraPartsCount} part${extraPartsCount > 1 ? 's' : ''})` : '';

    const formulaTokens = baseDice ? [baseDice] : [];
    if (rankDie) {
      formulaTokens.push(rankDie.replace(/^\+/, '').trim());
    }
    if (dmgStatKey) {
      formulaTokens.push(dmgStatKey.toUpperCase());
    }
    const cleanFormula = formulaTokens.join(' + ')
      .replace(/\+\s*\+/g, '+')
      .replace(/\+\s*-\s*/g, '- ')
      .trim();
    const displayDamage = `${cleanFormula}${typeStr}${extra}`;

    let critMult = configuredCritMultiplier(sys.critMultiplier) || DEFAULT_CRIT_MULTIPLIER;
    let critRankReached = skillRank >= 15 ? 15 : 5;
    if (matchingSkill?.system?.rankBreaks) {
      const reached = resolveReachedRankBreaks(matchingSkill, skillRank);
      if (reached.critMultiplier > 1) {
        critMult = reached.critMultiplier;
        critRankReached = reached.critRank;
      }
    }
    if (critMult === 2 || critMult === Number(sys.critMultiplier)) {
      if (skillRank >= 15 && configuredCritMultiplier(matchingSkill?.system?.critMultiplierR15)) {
        critMult = configuredCritMultiplier(matchingSkill.system.critMultiplierR15);
        critRankReached = 15;
      } else if (skillRank >= 5 && configuredCritMultiplier(matchingSkill?.system?.critMultiplierR5)) {
        critMult = configuredCritMultiplier(matchingSkill.system.critMultiplierR5);
        critRankReached = 5;
      }
    }
    let effects = attackEffectsText(item, { labelOf: conditionLabel });
    if (critMult > 1) {
      effects = effects ? `${critMult}x Crit (R${critRankReached}). ${effects}` : `${critMult}x Crit (R${critRankReached})`;
    }

    return {
      id: item.id,
      item,
      system: sys,
      name: item.name,
      displayName: matchingSkill && matchingSkill.name.toLowerCase() !== normName ? `${item.name} (${matchingSkill.name})` : item.name,
      matchingSkillName: matchingSkill ? matchingSkill.name : '',
      matchingSkillId: matchingSkill?.id || '',
      isSkillAttack: false,
      isWeaponGear: isGear,
      isSynthetic: false,
      isEquipped: true,
      skillRank,
      toHitStat,
      statMod,
      toHitMod,
      toHitDiceParts: hit.diceParts,
      toHitFormula,
      displayToHitFormula: toHitFormula,
      displayToHitStat,
      displayToHitRank,
      displayToHit,
      baseDice,
      rankDamageDie: rankDie,
      combinedDice,
      dmgStat: dmgStatKey,
      dmgStatMod,
      displayDmgMod,
      displayDamage,
      damageType: dmgType,
      effects,
      displayEffects: effects,
      favorConditional: favor.conditional
    };
  },

  _buildSkillAttackProfile(skill) {
    const sys = skill.system || {};
    const rank = Math.max(Number(skill.modifiedRank) || 0, Number(sys.modifiedRank) || 0, Number(sys.rank) || 0);
    const dmgData = typeof this.getSkillDamageData === 'function' ? this.getSkillDamageData(skill) : { hasDamage: false };

    const sTags = skill.allTags instanceof Set ? skill.allTags : getItemAllTags(skill);
    const isUnarmed = sTags.has(UNARMED_TAG);
    const toHitStat = (sys.toHitStat || sys.stat || 'str').toLowerCase();
    // The skill's own rows and reached rank breaks count, like any other attack (3.10)
    const hit = attackToHitDisplay(this, {
      item: skill, stat: toHitStat, rank,
      isOneHandedPenalty: hasOneHandedPenalty(sys, { handless: isNaturalWeapon(skill) }),
      tags: [sys.weaponCategory, sys.weaponType, sys.slot].filter(Boolean)
    });
    const { statMod, formula: toHitFormula } = hit;
    const toHitMod = hit.total;
    const displayToHitStat = toHitStat.toUpperCase();
    const displayToHitRank = rank;
    const displayToHit = `${displayToHitStat} (${rank})`;

    const skillFavor = this.getAiFavorRating(skill, { skill });
    const baseDicePart = dmgData.baseDice || '';

    let rankDiePart = dmgData.rankDamageDie || '';

    const dmgStatKey = (dmgData.stat || '').toLowerCase();
    const dmgStatMod = this.system?.abilities?.[dmgStatKey]?.mod ?? 0;
    const displayDmgMod = dmgStatMod >= 0 ? `+${dmgStatMod}` : `${dmgStatMod}`;
    const damageType = dmgData.damageType || 'Physical';

    const formulaTokens = baseDicePart ? [baseDicePart] : [];
    if (rankDiePart) {
      formulaTokens.push(rankDiePart.replace(/^\+/, '').trim());
    }
    if (dmgStatMod !== 0) {
      formulaTokens.push(String(dmgStatMod));
    }

    const cleanFormula = formulaTokens.join(' + ')
      .replace(/\+\s*\+/g, '+')
      .replace(/\+\s*-\s*/g, '- ')
      .trim();
    const displayDamage = `${cleanFormula} (${damageType})`;

    let critMult = DEFAULT_CRIT_MULTIPLIER;
    let critRankReached = rank >= 15 ? 15 : 5;
    if (sys.rankBreaks) {
      const reached = resolveReachedRankBreaks(skill, rank);
      if (reached.critMultiplier > 1) {
        critMult = reached.critMultiplier;
        critRankReached = reached.critRank;
      }
    }
    if (critMult === 2) {
      if (rank >= 15 && configuredCritMultiplier(sys.critMultiplierR15)) {
        critMult = configuredCritMultiplier(sys.critMultiplierR15);
        critRankReached = 15;
      } else if (rank >= 5 && configuredCritMultiplier(sys.critMultiplierR5)) {
        critMult = configuredCritMultiplier(sys.critMultiplierR5);
        critRankReached = 5;
      } else if (rank >= 5) {
        critMult = 4;
        critRankReached = 5;
      }
    }

    let effects = sys.notes || '';
    if (critMult > 2) {
      effects = `${critMult}x Crit (R${critRankReached}). ${effects}`;
    }

    const attackName = isUnarmed ? `${skill.name} (Unarmed)` : skill.name;

    return {
      id: skill.id,
      item: skill,
      system: sys,
      name: attackName,
      displayName: attackName,
      matchingSkillName: skill.name,
      isSkillAttack: true,
      isWeaponGear: false,
      isSynthetic: true,
      isEquipped: true,
      skillRank: rank,
      toHitStat,
      statMod,
      toHitMod,
      toHitDiceParts: hit.diceParts,
      toHitFormula,
      displayToHitFormula: toHitFormula,
      displayToHitStat,
      displayToHitRank,
      displayToHit,
      baseDice: baseDicePart,
      rankDamageDie: rankDiePart,
      combinedDice: rankDiePart ? `${baseDicePart} + ${rankDiePart}` : baseDicePart,
      dmgStat: dmgStatKey,
      dmgStatMod,
      displayDmgMod,
      displayDamage,
      damageType,
      effects,
      displayEffects: effects,
      favorConditional: skillFavor.conditional
    };
  }
};
