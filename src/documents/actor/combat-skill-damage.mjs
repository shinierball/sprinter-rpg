/**
 * Combat: damage multipliers and skill damage data.
 */

import { getGrantedRankDamageDie, getEffectRankDice } from '../../data/rank-dice.mjs';
import { resolveReachedRankBreaks } from '../../utils/rank-breaks.mjs';
import { evaluateModifier } from './actor-constants.mjs';
import { techniqueBonusDiceList } from './actor-techniques.mjs';
import { normalizeBaseDamage, baseDamageDice, baseDamageStat } from '../../utils/base-damage.mjs';
import { getItemAllTags } from '../../data/tags.mjs';
import { hasRuleFlag, RULE_FLAGS } from '../../utils/tag-behaviour.mjs';
import { PRIMARY_ATTACK_TAGS } from '../../utils/tag-mechanics.mjs';

export const actorCombatSkillDamageMixin = {
  /**
   * Parse and calculate skill attack damage formula and metadata based on the Sprinter RPG rules.
   * Weapon Attack Damage = Weapon Base Damage + Skill Rank Damage Die + Stat Mod.
   * Handles Hand-to-Hand Damage Effects (Powerful Strike and other damage effects),
   * rank damage die scaling table, and rank upgrade additions.
   *
   * @param {Item} skillItem
   * @param {object} [options={}]
   * @returns {object}
   */
  getSkillDamageData(skillItem, options = {}) {
    const sys = skillItem?.system || {};
    const skillName = skillItem?.name || 'Skill';
    const rank = options.rank !== undefined
      ? Number(options.rank)
      : Math.max(Number(skillItem?.modifiedRank) || 0, Number(sys.modifiedRank) || 0, Number(skillItem?.effectiveRank) || 0, Number(sys.rank) || 0);

    const rawNotes = sys.notes || '';
    // Base Damage is structured data ({ dice, stat, damageType }); notes are for humans and are never parsed here.
    const baseDamage = normalizeBaseDamage(sys.baseDamage);
    const diceMatch = baseDamageDice(baseDamage);

    // Identity comes from structured tags, never from the skill's name.
    const sTags = skillItem?.allTags instanceof Set ? skillItem.allTags : (skillItem ? getItemAllTags(skillItem) : new Set());
    const noDamageEffects = hasRuleFlag(sTags, RULE_FLAGS.noDamageEffects);
    const isPrimaryAttack = PRIMARY_ATTACK_TAGS.some(t => sTags.has(t));
    const rawBaseDamage = diceMatch ? baseDamage.dice : '';

    // Strict data-driven damage determination:
    // Non-attack skills or explicitly non-damaging skills NEVER deal damage unless forced.
    const explicitNoDamage = (sys.hasDamage === false && !isPrimaryAttack) || (sys.isAttack === false && !isPrimaryAttack && !rawBaseDamage && !options.forceDamage);
    const explicitHasDamage = sys.hasDamage === true;
    const hasDamageConfig = Boolean(rawBaseDamage) || Boolean(options.forceDamage);

    let hasDamage;
    if (explicitNoDamage && !options.forceDamage) {
      hasDamage = false;
    } else if (explicitHasDamage) {
      hasDamage = true;
    } else {
      hasDamage = hasDamageConfig;
    }

    // A blank Base Damage stat is the skill's own stat rule (its `stat`), never a hard-coded Strength; a skill with
    // neither adds no stat. 'none' is the explicit "Base Damage has no stat" value (book: Crossbow "1d8 Piercing").
    const skillStat = String(sys.stat ?? '').trim().toLowerCase();
    const validStat = (key) => (key && this.system?.abilities?.[key] ? key : '');
    const noDamageStat = baseDamage.stat === 'none';
    let statKey = baseDamageStat(baseDamage, skillStat);
    if (!hasDamage) {
      if (statKey && !this.system?.abilities?.[statKey]) statKey = validStat(skillStat);
      return {
        hasDamage: false,
        skillName,
        rank,
        baseDice: '',
        baseCount: 0,
        baseSides: 0,
        stat: statKey,
        statMod: this.system?.abilities?.[statKey]?.mod ?? 0,
        damageType: '',
        formula: '',
        formulaWithStat: '',
        rawNotes
      };
    }

    let baseCount = diceMatch ? diceMatch.count : 0;
    const baseSides = diceMatch ? diceMatch.sides : 0;
    let damageType = baseDamage.damageType || (isPrimaryAttack ? 'Bludgeoning' : 'Physical');

    // Ensure statKey is valid ability on this actor
    if (!noDamageStat && !this.system?.abilities?.[statKey]) statKey = validStat(skillStat);
    const statMod = this.system?.abilities?.[statKey]?.mod ?? 0;

    // Upgrades and Rank Breaks parsing (prioritize structured rankBreaks)
    let extraRankDiceFromBreaks = 0;
    const rankBreakExtraDamageDice = [];
    const targetDebuffsFromBreaks = [];
    const rankBreakBuffs = [];
    const rankBreakNotes = [];
    const processedSkillTiers = new Set();

    const resolvedSkillBreaks = resolveReachedRankBreaks(skillItem, rank);

    // The most recently reached break that names a damage type changes the skill's damage type.
    if (resolvedSkillBreaks.damageType) damageType = resolvedSkillBreaks.damageType;

    {
      const breaks = resolvedSkillBreaks.reachedTiers.map(t => ({ thresh: t.rank, key: t.key, data: t.tier, label: `Rank ${t.rank}` }));
      for (const b of breaks) {
        if (rank >= b.thresh && b.data) {
          let tierHandled = false;
          if (b.data.damageDice) {
            const cleanDice = b.data.damageDice.replace(/^\+/, '').trim();
            const dm = cleanDice.match(/^(\d+)d(\d+)$/i);
            if (dm && parseInt(dm[2], 10) === baseSides) {
              baseCount += parseInt(dm[1], 10);
              tierHandled = true;
            } else if (cleanDice) {
              rankBreakExtraDamageDice.push(cleanDice);
              tierHandled = true;
            }
          }
          if (b.data.baseDiceCountMod) {
            if (Number.isFinite(parseInt(String(b.data.baseDiceCountMod).replace('+', ''), 10))) tierHandled = true;
          }
          if (b.data.rankDamageDice) {
            extraRankDiceFromBreaks += Number(b.data.rankDamageDice) || 0;
            tierHandled = true;
          }
          if (b.data.debuff && b.data.debuffOn !== 'crit') tierHandled = true;
          if (b.data.buffsResistances) {
            rankBreakBuffs.push(`${b.label}: ${b.data.buffsResistances}`);
            tierHandled = true;
          }
          if (b.data.notes) {
            rankBreakNotes.push(`${b.label}: ${b.data.notes}`);
          }
          if (tierHandled) processedSkillTiers.add(b.key);
        }
      }
    }

    // Break dice of the base die are base damage: count mod first, then the multiplier.
    baseCount = Math.max(0, baseCount + resolvedSkillBreaks.baseDiceCountMod) * (resolvedSkillBreaks.baseDiceMultiplier || 1);

    for (const d of resolvedSkillBreaks.onHitDebuffs) {
      if (!targetDebuffsFromBreaks.includes(d)) targetDebuffsFromBreaks.push(d);
    }

    // Hand-to-Hand Damage Effects:
    // Unarmed Combat cannot combine with Damage Effects.

    const chosenEffectRaw = (options.damageEffect !== undefined ? options.damageEffect : (options.chosenEffect !== undefined ? options.chosenEffect : options.effect));
    // A technique identifier, or the technique skill item.
    const chosenEffect = typeof chosenEffectRaw === 'string'
      ? chosenEffectRaw.trim()
      : String(chosenEffectRaw?.system?.identifier ?? '').trim();
    const isNone = chosenEffect === 'none';

    let effectData = null;
    if (!noDamageEffects && !isNone) {
      if (chosenEffect || (chosenEffectRaw && typeof chosenEffectRaw === 'object')) {
        effectData = this.resolveDamageEffect(chosenEffectRaw, skillItem, options);
      }
    }

    let powerfulStrikeApplied = false;
    let powerfulStrikeRank = 0;
    let tossApplied = false;
    let chokeOutApplied = false;
    let dirtyFightingApplied = false;
    let effectRankDice = [];
    let tossBonus = null;
    const extraDamageParts = [];

    if (effectData) {
      const eName = effectData.identifier;
      const eRank = effectData.rank;

      // Dynamic Base Dice Count Modification
      if (effectData.baseCountMod) {
        baseCount = evaluateModifier(baseCount, effectData.baseCountMod, eRank);
      }
      for (const mod of effectData.breakCountMods) {
        baseCount = evaluateModifier(baseCount, mod, eRank);
      }
      for (const bDice of effectData.breakDamageDice || []) {
        const cleanDice = bDice.replace(/^\+/, '').trim();
        const dm = cleanDice.match(/^(\d+)d(\d+)$/i);
        if (dm && parseInt(dm[2], 10) === baseSides) {
          baseCount += parseInt(dm[1], 10);
        } else if (cleanDice) {
          rankBreakExtraDamageDice.push(cleanDice);
        }
      }

      // Dynamic debuffs from technique / breaks
      for (const d of effectData.debuffs) {
        if (!targetDebuffsFromBreaks.includes(d)) {
          targetDebuffsFromBreaks.push(d);
        }
      }

      // Rank damage dice the effect grants (for example a Rank die at R5 or R10): unnamed grants are sized by this
      // Attack Skill's rank (they join the skill's own grants below), a 'self' grant by the effect's own rank.
      effectRankDice = getEffectRankDice(effectData, rank, eRank);

      // Dynamic Bonus Packet (e.g. Toss or custom damage bonus)
      if (effectData.damageBonus && !effectData.baseCountMod) {
        // A blank technique stat adds none, as on the weapon path: only an explicit `techniqueConfig.stat` does.
        const bonusStatKey = validStat(effectData.stat);
        const bonusStatMod = this.system?.abilities?.[bonusStatKey]?.mod ?? 0;
        tossBonus = {
          type: effectData.damageType || 'Bludgeoning',
          dice: effectData.damageBonus,
          stat: bonusStatKey,
          statMod: bonusStatMod,
          source: effectData.name
        };
      }

      // The config bonus the packet above does not carry (a base-count technique). The reached break dice are already
      // in the base count or `rankBreakExtraDamageDice`: `bonusParts` mirrors them and is never added here, or they count twice.
      const configBonus = techniqueBonusDiceList({ damageBonus: effectData.damageBonus })[0];
      if (!tossBonus && configBonus) {
        extraDamageParts.push({
          id: `effect-bonus-${extraDamageParts.length}`,
          type: effectData.damageType || damageType,
          dice: configBonus,
          source: effectData.name
        });
      }

      // Backward-compatibility flags
      if (eName === 'powerful-strike') {
        powerfulStrikeApplied = true;
        powerfulStrikeRank = eRank;
      } else if (eName === 'toss') {
        tossApplied = true;
      } else if (eName === 'choke-out') {
        chokeOutApplied = true;
      } else if (eName === 'dirty-fighting') {
        dirtyFightingApplied = true;
      }
    }

    // Rank Damage Die: added only when a reached rank break or the damage effect grants one. Unnamed grants (the
    // skill's own and the effect's) are all sized by this Attack Skill's rank; a named ('self') effect grant by the
    // effect's rank.
    const grantedAtAttackRank = extraRankDiceFromBreaks + (effectData?.attackRankDice || 0);
    const attackRankDie = getGrantedRankDamageDie(rank, grantedAtAttackRank);
    const selfRankDie = effectRankDice.find(d => d.own) || null;
    const rankDie = attackRankDie;
    const extraEffectRankDie = selfRankDie ? { dice: selfRankDie.dice, value: selfRankDie.value } : null;
    // The first Rank die the chosen effect grants (a named or unnamed grant), read from the effect's data.
    const effectRankDie = effectRankDice.length ? effectRankDice[0] : null;

    const rankDieStrs = [];
    if (rankDie.dice) rankDieStrs.push(rankDie.dice);
    else if (rankDie.value > 0) rankDieStrs.push(String(rankDie.value));
    if (extraEffectRankDie?.dice) rankDieStrs.push(extraEffectRankDie.dice);
    else if (extraEffectRankDie?.value > 0) rankDieStrs.push(String(extraEffectRankDie.value));
    const combinedRankDieStr = rankDieStrs.join(' + ');

    // Fallback Toss Effect Bonus if not already created
    if (!tossBonus && tossApplied) {
      tossBonus = {
        type: 'Bludgeoning',
        dice: '1d8',
        stat: 'str',
        statMod: this.system?.abilities?.str?.mod ?? 0,
        source: 'Toss'
      };
    }

    const baseDiceStr = baseSides > 0 ? `${baseCount}d${baseSides}` : '';
    // A result multiplier (Powerful Strike) multiplies the rolled base dice, then the modifiers are added (book p. 182).
    const baseResultMultiplier = effectData?.resultMultiplier ?? null;
    const baseDiceText = baseDiceStr && baseResultMultiplier !== null ? `${baseDiceStr} x ${baseResultMultiplier}` : baseDiceStr;
    const formulaElements = baseDiceText ? [baseDiceText] : [];
    if (combinedRankDieStr) {
      formulaElements.push(combinedRankDieStr);
    }
    for (const d of rankBreakExtraDamageDice) {
      formulaElements.push(d);
    }
    if (tossBonus && tossBonus.dice) {
      formulaElements.push(tossBonus.dice);
    }
    if (statKey) {
      formulaElements.push(statMod >= 0 ? `+ ${statMod}` : `- ${Math.abs(statMod)}`);
    }
    const formula = formulaElements.join(' + ').replace(/\+\s*\+/g, '+').replace(/\+\s*-\s*/g, '- ').trim();

    const formulaWithStatElements = baseDiceText ? [baseDiceText] : [];
    if (combinedRankDieStr) {
      formulaWithStatElements.push(combinedRankDieStr);
    }
    for (const d of rankBreakExtraDamageDice) {
      formulaWithStatElements.push(d);
    }
    if (tossBonus && tossBonus.dice) {
      formulaWithStatElements.push(`${tossBonus.dice} ${tossBonus.type}`);
    }
    if (statKey) {
      formulaWithStatElements.push(statKey.charAt(0).toUpperCase() + statKey.slice(1));
    }
    let formulaWithStat = `${formulaWithStatElements.join(' + ')} ${damageType}`.trim();

    return {
      hasDamage: true,
      skillName,
      rank,
      baseDice: baseDiceStr,
      baseResultMultiplier,
      replacesDamage: effectData?.replacesDamage === true,
      baseCount,
      baseSides,
      stat: statKey,
      statMod,
      damageType,
      rankDie,
      chosenEffect: isNone ? 'none' : chosenEffect,
      effectData,
      chosenEffectItem: effectData?.item || null,
      extraEffectRankDie,
      effectIdentifier: effectData?.identifier || '',
      effectName: effectData?.name || '',
      effectRank: effectData?.rank || 0,
      effectRankDie,
      powerfulStrikeApplied,
      powerfulStrikeRank,
      tossApplied,
      tossBonus,
      chokeOutApplied,
      dirtyFightingApplied,
      combinedRankDieStr,
      extraDamageParts,
      rankBreakExtraDamageDice,
      rankDamageDie: combinedRankDieStr || rankDie.dice || '',
      debuff: targetDebuffsFromBreaks[targetDebuffsFromBreaks.length - 1] || '',
      debuffs: targetDebuffsFromBreaks,
      formula,
      formulaWithStat,
      targetDebuffs: targetDebuffsFromBreaks,
      rankBreakBuffs,
      rankBreakNotes,
      rawNotes
    };
  }
};
