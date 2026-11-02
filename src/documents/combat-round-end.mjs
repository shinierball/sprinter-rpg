/**
 * Sprinter RPG — end-of-round effects, one stage per effect kind.
 *
 * `COGCombat#triggerRoundEndEffects` runs the re-entrancy guard and then, per combatant, these stages in order:
 * damaging debuffs, healing buffs, equipped gear. Each stage returns its result rows. Plain functions taking the actor
 * first; `ctx = { combat, round, floor, evaluate }` where `evaluate(expr, actor)` is `COGCombat.evaluateEffectFormula`
 * (passed in so this module does not import combat.mjs and the static stays patchable).
 */

import { COGCombatMetrics } from '../apps/combat-metrics.mjs';
import { buildRollContext, serializeRollContext, actionTagsOf } from '../utils/roll-context.mjs';
import { isBuffSuppressed } from '../utils/dispel.mjs';

/**
 * Preview a debuff tick: the damage after reduction, and whether it would take a whole bar off a crawler at 0 HP.
 * @param {object} actor
 * @param {string} damageType
 * @param {number} damageVal rolled damage
 * @param {object} rollContext serialized damage-phase roll context of the debuff
 * @returns {{ damageToHp: number, wouldDropToZero: boolean }}
 */
export function fatalDebuffPreview(actor, damageType, damageVal, rollContext) {
  const hpBefore = Number(actor.system?.attributes?.hp?.value ?? 0);
  const tempHp = Number(actor.system?.attributes?.hp?.temp ?? 0);

  let adjustedDamage = damageVal;
  const defenseContext = buildRollContext({
    actor, phase: 'defense', tags: actionTagsOf(rollContext), other: null, otherRole: 'attacker'
  });
  const red = actor.getDamageReduction(damageType, defenseContext);
  if (red.isImmune) {
    adjustedDamage = 0;
  } else {
    if (red.percent > 0) {
      const reduction = red.rounding === 'up'
        ? Math.ceil(adjustedDamage * red.percent)
        : Math.floor(adjustedDamage * red.percent);
      adjustedDamage = Math.max(0, adjustedDamage - reduction);
    }
    if (red.flat > 0) {
      adjustedDamage = Math.max(0, adjustedDamage - red.flat);
    }
  }

  const damageAfterTemp = Math.max(0, adjustedDamage - tempHp);
  const hpPerBar = COGCombatMetrics.getHpPerBar(actor);

  const barsRemoved = Math.floor(damageAfterTemp / hpPerBar);
  const damageToHp = barsRemoved * hpPerBar;
  const wouldDropToZero = (hpBefore - damageToHp) <= 0;
  return { damageToHp, wouldDropToZero };
}

/**
 * Tick every debuff with `damagePerRound` on one actor.
 * @returns {Promise<Array<object>>} result rows
 */
export async function roundEndDebuffEffects(actor, combatant, ctx) {
  const rows = [];
  const debuffs = (actor.items || []).filter(i => i.type === 'debuff');
  for (const debuff of debuffs) {
    const dmgExpr = debuff.system?.damagePerRound;
    if (!dmgExpr || (typeof dmgExpr === 'string' && !dmgExpr.trim())) continue;

    const damageVal = await ctx.evaluate(dmgExpr, actor);
    if (damageVal > 0) {
      const damageType = debuff.system?.damageType || 'Physical';
      const hpBefore = Number(actor.system?.attributes?.hp?.value ?? 0);

      // The debuff is the action; nothing acts on it from outside, so the damage has no owner and no other party
      const rollContext = serializeRollContext(buildRollContext({ actor: null, phase: 'damage', item: debuff, other: null }));
      const { damageToHp, wouldDropToZero } = fatalDebuffPreview(actor, damageType, damageVal, rollContext);

      let conCheckRes;
      if (actor.type === 'crawler' && wouldDropToZero && damageToHp > 0) {
        conCheckRes = await actor.checkFatalDebuffProtection(debuff, damageVal, { floor: ctx.floor });
        if (conCheckRes?.avoided) {
          rows.push({
            type: 'debuff',
            combatantId: combatant.id,
            combatantName: combatant.name,
            actorId: actor.id,
            actorName: actor.name,
            itemName: debuff.name,
            itemId: debuff.id,
            damageType,
            formula: dmgExpr,
            rolledValue: damageVal,
            actualDamage: 0,
            avoidedDamage: damageVal,
            hpBefore,
            hpAfter: hpBefore,
            conCheck: {
              total: conCheckRes.roll?.total,
              dc: conCheckRes.dc,
              success: true
            },
            debuffEnded: true,
            round: ctx.round
          });
          continue;
        }
      }

      const applyRes = await actor.applyDamage(damageVal, {
        damageType,
        attackName: debuff.name || 'Debuff Damage',
        attackType: 'Condition',
        ignoreDR: true,
        rollContext,
        combat: ctx.combat
      });

      const hpAfter = Number(actor.system?.attributes?.hp?.value ?? 0);
      const actualDamage = applyRes?.actualDamage ?? Math.max(0, hpBefore - hpAfter);

      rows.push({
        type: 'debuff',
        combatantId: combatant.id,
        combatantName: combatant.name,
        actorId: actor.id,
        actorName: actor.name,
        itemName: debuff.name,
        itemId: debuff.id,
        damageType,
        formula: dmgExpr,
        rolledValue: damageVal,
        actualDamage,
        hpBefore,
        hpAfter,
        round: ctx.round
      });
    }
  }
  return rows;
}

/**
 * The buffs that tick at round end: the actor's own non-suppressed buffs, then active external ones, deduped by id.
 * @returns {Array<object>}
 */
export function roundEndBuffs(actor) {
  const allBuffs = [];
  const seenBuffIds = new Set();
  for (const item of (actor.items || [])) {
    if (item.type === 'buff' && !isBuffSuppressed(actor, item)) {
      allBuffs.push(item);
      seenBuffIds.add(item.id);
    }
  }
  if (typeof actor.getActiveBuffs === 'function') {
    const activeExternal = actor.getActiveBuffs() || [];
    for (const ext of activeExternal) {
      if (ext && !seenBuffIds.has(ext.id)) {
        allBuffs.push(ext);
        seenBuffIds.add(ext.id);
      }
    }
  }
  return allBuffs;
}

/**
 * Heal from every buff with `healingPerRound`.
 * @returns {Promise<Array<object>>} result rows
 */
export async function roundEndBuffHealing(actor, combatant, ctx) {
  const rows = [];
  for (const buff of roundEndBuffs(actor)) {
    const healExpr = buff.system?.healingPerRound;
    if (!healExpr || (typeof healExpr === 'string' && !healExpr.trim())) continue;

    const healVal = await ctx.evaluate(healExpr, actor);
    if (healVal > 0) {
      const hpPerBar = COGCombatMetrics.getHpPerBar(actor);

      const hpBefore = Number(actor.system?.attributes?.hp?.value ?? actor.system?.attributes?.hp?.max ?? 0);
      const maxHp = Number(actor.system?.attributes?.hp?.max) || (10 * hpPerBar);
      const newHp = Math.min(maxHp, hpBefore + healVal);
      const actualHealed = Math.max(0, newHp - hpBefore);

      if (actualHealed > 0) {
        await actor.update({ 'system.attributes.hp.value': newHp });
      }

      rows.push({
        type: 'buff',
        combatantId: combatant.id,
        combatantName: combatant.name,
        actorId: actor.id,
        actorName: actor.name,
        itemName: buff.name,
        itemId: buff.id,
        formula: healExpr,
        rolledValue: healVal,
        actualHealed,
        hpBefore,
        hpAfter: newHp,
        maxHp,
        round: ctx.round
      });
    }
  }
  return rows;
}

/**
 * Equipped gear: persistent healing in bars, then the debuffs it cleanses.
 * @returns {Promise<Array<object>>} result rows
 */
export async function roundEndGearEffects(actor, combatant, ctx) {
  const rows = [];
  const equippedGear = (actor.items || []).filter(i => i.type === 'gear' && i.system?.equipped);
  for (const gear of equippedGear) {
    const healingCfg = gear.system?.healing;
    if (!healingCfg) continue;
    const barsPerRound = Number(healingCfg.barsPerRound) || (healingCfg.hasHealing ? 1 : 0);
    if (barsPerRound > 0) {
      const healRes = await actor.applyHealingBars(barsPerRound);

      rows.push({
        type: 'gearHealing',
        combatantId: combatant.id,
        combatantName: combatant.name,
        actorId: actor.id,
        actorName: actor.name,
        itemName: gear.name,
        itemId: gear.id,
        formula: `${barsPerRound} bars`,
        actualHealed: healRes?.actualHealed ?? 0,
        hpAfter: actor.system?.attributes?.hp?.value,
        round: ctx.round
      });
    }

    // Cleanse debuffs configured on gear
    if (Array.isArray(healingCfg.cleanseDebuffs) && healingCfg.cleanseDebuffs.length > 0) {
      for (const deb of healingCfg.cleanseDebuffs) {
        if (!deb) continue;
        await actor.cleanseDebuff(deb);
      }
    }
  }
  return rows;
}
