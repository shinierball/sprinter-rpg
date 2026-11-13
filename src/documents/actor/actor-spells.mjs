import { normalizeBaseDamage, baseDamageDice, baseDamageStat } from '../../utils/damage/base-damage.mjs';
import { relayPendingSpellConditions } from './spell-card-parts.mjs';
import { getGrantedRankDamageDie } from '../../data/rank-dice.mjs';
import { resolveReachedRankBreaks } from '../../utils/skill/rank-breaks.mjs';
import { resolveDamageContext } from '../../utils/roll/roll-context.mjs';
import { applyDamageStatSubstitutions } from '../../utils/roll/narrow-modifiers.mjs';
import { collectDamageModifiers, applyStatSuppression } from '../../utils/roll/damage-modifiers.mjs';
import { collectOnHitEffects } from '../../utils/attack/on-hit.mjs';
import {
  toggleOffSpell, gateSpellCast, resolveSpellCost, confirmSpellMana, postSpellFailedCard, paySpellCost, applySpellHealing, applySpellCastEffects, applySpellCastConditions, recordSpellCast
} from './spell-cast.mjs';
import { spellCastCard, spellCastFlags } from './spell-cast-card.mjs';
import { cardSummary, CARD_PROFILES } from '../../utils/item-describer/card-summary.mjs';
import { cardMessageOptions } from '../../utils/card/chat-mode.mjs';
import { applyChosenEffectToParts, applyTechniquesToDamageParts } from './combat-damage.mjs';

/**
 * Parse and calculate spell damage formula and metadata based on spell description, stat, and rank upgrades
 * @param {COGItem} spellItem
 * @returns {object}
 */
export function getSpellDamageData(actor, spellItem, options = {}) {
  const sys = spellItem?.system || {};
  const base = normalizeBaseDamage(sys.baseDamage);

  const rank = Math.max(Number(sys.modifiedRank) || 0, Number(sys.rank) || 0, 1);
  const resolvedBreaks = resolveReachedRankBreaks(spellItem, rank);
  const rawMods = Array.isArray(sys.rankDamageParts) ? sys.rankDamageParts : [];
  const activeMods = rawMods.filter(m => m && (m.dice || m.value) && rank >= (Number(m.minRank) || 0));

  const diceMatch = baseDamageDice(base);

  if (!diceMatch && activeMods.length === 0) {
    return { hasDamage: false, formula: '', dice: '', statMod: 0, debuffs: [] };
  }

  let diceStr = '';
  let sides = 0;
  let count = 0;
  let damageType = base.damageType || (activeMods[0]?.type || '');
  const debuffs = [];

  for (const d of collectOnHitEffects({ sources: [{ item: spellItem, rank }] }).debuffs) {
    if (!debuffs.includes(d)) debuffs.push(d);
  }

  // 1. Structured Rank Breaks configuration parsing (Ranks 5, 10, 15, 20) (primary)
  let extraSpellRankDice = 0;
  const rankBreakExtraDice = [];
  const rankBreakBuffs = [];
  const processedSpellTiers = new Set();

  if (diceMatch) {
    count = diceMatch.count;
    sides = diceMatch.sides;
  }

  {
    const breaks = resolvedBreaks.reachedTiers.map(t => ({ thresh: t.rank, key: t.key, data: t.tier, label: `Rank ${t.rank}` }));
    for (const b of breaks) {
      if (rank >= b.thresh && b.data) {
        let tierHandled = false;
        if (b.data.damageDice) {
          const cleanDice = b.data.damageDice.replace(/^\+/, '').trim();
          const dm = cleanDice.match(/^(\d+)d(\d+)$/i);
          if (dm && sides && parseInt(dm[2], 10) === sides) {
            count += parseInt(dm[1], 10);
            tierHandled = true;
          } else if (cleanDice) {
            rankBreakExtraDice.push(cleanDice);
            tierHandled = true;
          }
        }
        if (b.data.rankDamageDice) {
          extraSpellRankDice += Number(b.data.rankDamageDice) || 0;
          tierHandled = true;
        }
        if (b.data.buffsResistances) {
          rankBreakBuffs.push(`${b.label}: ${b.data.buffsResistances}`);
          tierHandled = true;
        }
        if (b.data.damageType) {
          damageType = b.data.damageType;
          tierHandled = true;
        }
        if (b.data.notes) tierHandled = true;
        if (tierHandled) processedSpellTiers.add(b.key);
      }
    }
  }

  const isCrit = options.isCrit === true;
  const breakDebuffs = isCrit ? resolvedBreaks.debuffs : resolvedBreaks.onHitDebuffs;
  for (const d of breakDebuffs) {
    if (!debuffs.includes(d)) debuffs.push(d);
  }

  // Break dice of the base die are base damage: count mod first, then the multiplier (Magic Missile R15: base damage x3).
  if (diceMatch) count = Math.max(0, count + resolvedBreaks.baseDiceCountMod) * (resolvedBreaks.baseDiceMultiplier || 1);

  if (sides > 0 && count > 0) {
    diceStr = `${count}d${sides}`;
  }

  // Determine governing stat
  const statKey = baseDamageStat(base, sys.stat) || null;

  const statMod = statKey && actor.system.abilities?.[statKey] ? (actor.system.abilities[statKey].mod ?? 0) : 0;

  // Rank damage die: Table 37 die, added only when a reached rank break grants one
  const rankDie = getGrantedRankDamageDie(rank, extraSpellRankDice);

  const formulaComponents = [];
  if (diceStr) {
    formulaComponents.push(diceStr);
  }

  for (const extraD of rankBreakExtraDice) {
    formulaComponents.push(extraD);
  }

  // Include explicit rank-gated damage modifiers
  let activeModFlat = 0;
  for (const m of activeMods) {
    if (m.dice) {
      formulaComponents.push(m.dice.trim());
    }
    if (m.value) {
      activeModFlat += Number(m.value) || 0;
    }
  }
  if (activeModFlat > 0) {
    formulaComponents.push(String(activeModFlat));
  }

  if (rankDie.dice) {
    formulaComponents.push(rankDie.dice);
  } else if (rankDie.value) {
    formulaComponents.push(String(rankDie.value));
  }

  let formula = formulaComponents.join(' + ') || '1d6';
  if (statKey) {
    formula += statMod >= 0 ? ` + ${statMod}` : ` - ${Math.abs(statMod)}`;
  }

  // Formulate readable formulaWithStat
  const formulaWithStatParts = [...formulaComponents];
  if (statKey) {
    formulaWithStatParts.push(statKey.charAt(0).toUpperCase() + statKey.slice(1));
  }
  const formulaWithStat = `${formulaWithStatParts.join(' + ')}${damageType ? ` ${damageType}` : ''}`.trim();

  return {
    hasDamage: true,
    dice: diceStr || (activeMods.map(m => m.dice).filter(Boolean).join(' + ')),
    baseDice: diceStr || (activeMods.map(m => m.dice).filter(Boolean).join(' + ')),
    rankDie: rankDie.dice || (rankDie.value ? String(rankDie.value) : ''),
    rankDieObj: rankDie,
    count,
    sides,
    stat: statKey,
    statMod,
    formula,
    formulaWithStat,
    damageType,
    debuffs,
    onHitDebuffs: resolvedBreaks.onHitDebuffs,
    onCritDebuffs: resolvedBreaks.onCritDebuffs,
    rankBreakExtraDice,
    activeMods,
    rank
  };
}

/**
 * Resolve composite damage parts for a spell item.
 * Enumerates Base Spell Damage, Rank Break Milestones, Rank Damage Die,
 * Spell Damage Modifiers, Active Buffs, and Equipped Gear bonuses.
 * @param {Item|object} spellItem
 * @param {object} [options={}]
 * @returns {Array<object>}
 */
export function getSpellDamageParts(actor, spellItem, options = {}) {
  const sys = spellItem?.system || {};
  const base = normalizeBaseDamage(sys.baseDamage);

  const rank = Math.max(Number(sys.modifiedRank) || 0, Number(sys.rank) || 0, 1);
  const rawMods = Array.isArray(sys.rankDamageParts) ? sys.rankDamageParts : [];
  const activeMods = rawMods.filter(m => m && (m.dice || m.value) && rank >= (Number(m.minRank) || 0));

  const diceMatch = baseDamageDice(base);

  if (!diceMatch && activeMods.length === 0) {
    return [];
  }

  const parts = [];
  let primaryType = base.damageType || (activeMods[0]?.type || 'Magical');

  // Determine stat modifier for spell
  const statKey = baseDamageStat(base, sys.stat) || null;
  const statMod = statKey && actor.system?.abilities?.[statKey] ? (actor.system.abilities[statKey].mod ?? 0) : 0;

  // 1. Base spell damage part
  let baseCount = diceMatch ? diceMatch.count : 0;
  const baseSides = diceMatch ? diceMatch.sides : 0;

  // Check if reached rank breaks specify a base damage multiplier
  const resolvedBreaks = resolveReachedRankBreaks(spellItem, rank);
  const baseMult = resolvedBreaks.baseDiceMultiplier || 1;

  // Reached break dice of the base die are base damage: while a multiplier applies they join (and are multiplied
  // with) the base part. Without one they stay separate rows, which total the same dice.
  const mergedBreakKeys = new Set();
  if (baseCount > 0 && baseSides > 0) {
    for (const t of resolvedBreaks.reachedTiers) {
      const dm = String(t.tier.damageDice || '').replace(/^\+/, '').trim().match(/^(\d+)d(\d+)$/i);
      if (baseMult > 1 && dm && parseInt(dm[2], 10) === baseSides) {
        baseCount += parseInt(dm[1], 10);
        mergedBreakKeys.add(t.key);
      }
    }
    baseCount = Math.max(1, baseCount + resolvedBreaks.baseDiceCountMod);
  }

  if (baseCount > 0 && baseSides > 0) {
    parts.push({
      id: `spell-base-${spellItem.id || 'part'}`,
      type: primaryType,
      dice: `${baseCount * baseMult}d${baseSides}`,
      stat: statKey,
      statMod,
      value: 0,
      baseDice: true,
      source: `${spellItem.name} (Base)`
    });
  }

  // 2. Rank Break Milestones damage parts
  let extraSpellRankDice = 0;
  const processedTiers = new Set();
  {
    const breaks = resolvedBreaks.reachedTiers.map(t => ({ thresh: t.rank, key: t.key, label: `Rank ${t.rank} Break`, data: t.tier }));
    for (const b of breaks) {
      if (rank >= b.thresh && b.data) {
        if (b.data.damageDice && !mergedBreakKeys.has(b.key)) {
          const cleanDice = b.data.damageDice.replace(/^\+/, '').trim();
          if (cleanDice) {
            const breakType = b.data.damageType || primaryType;
            parts.push({
              id: `spell-break-${b.key}`,
              type: breakType,
              dice: cleanDice,
              stat: '',
              statMod: 0,
              value: 0,
              baseDice: breakType === primaryType,
              source: `${spellItem.name} (${b.label})`
            });
            processedTiers.add(b.key);
          }
        }
        if (b.data.rankDamageDice) {
          extraSpellRankDice += Number(b.data.rankDamageDice) || 0;
        }
      }
    }
  }

  // 3. Rank Damage Die
  const rankDie = getGrantedRankDamageDie(rank, extraSpellRankDice);

  if (rankDie.dice || rankDie.value) {
    parts.push({
      id: `spell-rank-die-${spellItem.id || 'part'}`,
      type: primaryType,
      dice: rankDie.dice || '',
      stat: '',
      statMod: 0,
      value: rankDie.value || 0,
      source: `Rank ${rank} Damage Die`
    });
  }

  // 4. Explicit Spell Damage Modifiers on item
  for (const m of activeMods) {
    const mStatKey = (m.stat || '').toLowerCase();
    const mStatMod = mStatKey && actor.system?.abilities?.[mStatKey] ? (actor.system.abilities[mStatKey].mod ?? 0) : 0;
    parts.push({
      id: `spell-mod-${parts.length}`,
      type: m.type || primaryType,
      dice: (m.dice || '').trim(),
      stat: mStatKey,
      statMod: mStatMod,
      value: Number(m.value) || 0,
      source: `${spellItem.name} (Rank ${m.minRank || 0} Modifier)`
    });
  }

  // 5. Outgoing damage modifiers via unified engine (replacing buff affects and gear target/appliesTo)
  const rollContext = resolveDamageContext(actor, options, { item: spellItem });
  const dmod = collectDamageModifiers(actor, rollContext, { primaryType, split: options.withTargetRows === true });

  parts.push(...dmod.addParts, ...dmod.targetAddParts);

  // The chosen Damage Effect (3.47): applied as on a weapon, the rest of the picks as techniques.
  applyChosenEffectToParts(actor, parts, options.damageEffect, spellItem, { primaryType, skillRank: rank, rollContext, options });
  applyTechniquesToDamageParts(actor, parts, options, options.damageEffect ?? '', primaryType, spellItem, rank, rollContext);

  return applyStatSuppression(applyDamageStatSubstitutions(actor, parts, rollContext, { skip: options.skipSubstitutions }), dmod);
}

/**
 * Cast/Roll a Spell, posting a formatted chat card to chat
 * @param {COGItem} spellItem
 * @param {'cast'|'damage'|'hit'|object} [action='cast']
 * @param {object} [options={}]
 */
export async function rollSpell(actor, spellItem, action = 'cast', options = {}) {
  let act = action;
  let opts = options;
  if (typeof action === 'object' && action !== null) {
    opts = action;
    act = action.action || 'cast';
  }
  if (act === 'damage') {
    return actor.rollSpellDamage(spellItem, opts);
  }
  if (act === 'hit') {
    return actor.rollSpellAttack(spellItem, opts);
  }

  const toggled = toggleOffSpell(actor, spellItem);
  if (toggled) return toggled;
  const gates = await gateSpellCast(actor, spellItem, opts);
  if (!gates) return null;

  const cost = await resolveSpellCost(actor, spellItem, opts, gates);
  const manaRuleBreak = await confirmSpellMana(actor, spellItem, cost, opts);
  if (cost.manaCost > 0 && cost.currentMana < cost.manaCost && !manaRuleBreak) {
    return postSpellFailedCard(actor, spellItem, cost);
  }

  const { updates, newMana } = await paySpellCost(actor, cost, gates);
  const healInfo = await applySpellHealing(actor, spellItem, opts, updates);
  // One update for Mana and hp together: `_preUpdate` reads every hp change against the current value
  if (Object.keys(updates).length > 0) {
    await actor.update(updates);
  }

  const effects = await applySpellCastEffects(actor, spellItem, gates);
  const conditions = await applySpellCastConditions(actor, spellItem, opts, gates);
  const cast = { ...gates, cost, manaRuleBreak, newMana, healInfo, ...effects, ...conditions };
  // The "What this does" section is read here, before the card, so the card builder stays synchronous (3.71)
  const omit = [...CARD_PROFILES.cast, ...(healInfo ? CARD_PROFILES.castHeal : []), ...(cast.nonAuraTempBars ? CARD_PROFILES.castTempBars : [])];
  // The cast card offers its conditions only when it offers no attack (the hit card offers them otherwise)
  const conditionEffects = cast.offersAttack ? [] : (cast.conditionTags ?? []).map((ref) => ({ kind: 'debuffs', ref }));
  cast.summaryHtml = await cardSummary(spellItem, omit, { actor, effects: conditionEffects });
  recordSpellCast(actor, spellItem, cost, healInfo);

  const { content, contestData } = spellCastCard(actor, spellItem, opts, cast);
  const castMessage = await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content,
    flags: spellCastFlags(actor, spellItem, opts, cast, contestData)
  }, cardMessageOptions(actor));
  await relayPendingSpellConditions(castMessage, spellItem, cast.pendingConditions, cast.appliedConditionTargets, 'appliedTargets');
  return castMessage;
}
