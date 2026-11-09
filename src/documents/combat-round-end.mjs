/**
 * Sprinter RPG — end-of-round effects, one stage per effect kind.
 *
 * `triggerRoundEndEffects(combat, round)` runs the re-entrancy guard and then, per combatant, these stages in order:
 * damaging debuffs, healing buffs, equipped gear. Each stage returns its result rows. Plain functions taking the actor
 * first; `ctx = { combat, round, floor, evaluate }` where `evaluate(expr, actor)` is `evaluateEffectFormula` with the
 * round's floor bound. The triggered rows post as one chat card (`postRoundEndEffectsChatCard`).
 */

import { SYSTEM_ID } from '../constants.mjs';
import { COGCombatMetrics } from './combat-metrics.mjs';
import { getCurrentFloor } from './actor/actor-environment.mjs';
import { buildRollContext, serializeRollContext, actionTagsOf } from '../utils/roll/roll-context.mjs';
import { isBuffSuppressed } from '../utils/effects/dispel.mjs';
import { debuffInForce } from '../utils/effects/debuff-force.mjs';
import { isEffectPaused, workingGear } from '../utils/effects/gear-suppression.mjs';
import { restoredValue } from '../utils/damage/resource-restore.mjs';

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
  // Every Debuff is paused while the actor is in a zero zone (its clock still runs; it just does nothing)
  const zonePaused = isEffectPaused(actor);
  const debuffs = (actor.items || []).filter(i => i.type === 'debuff' && debuffInForce(i, { paused: zonePaused }));
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
function roundEndBuffs(actor) {
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
async function roundEndBuffHealing(actor, combatant, ctx) {
  const rows = [];
  for (const buff of roundEndBuffs(actor)) {
    const healExpr = buff.system?.healingPerRound;
    if (!healExpr || (typeof healExpr === 'string' && !healExpr.trim())) continue;

    const healVal = await ctx.evaluate(healExpr, actor);
    if (healVal > 0) {
      const hpPerBar = COGCombatMetrics.getHpPerBar(actor);

      const hpBefore = Number(actor.system?.attributes?.hp?.value ?? actor.system?.attributes?.hp?.max ?? 0);
      const maxHp = Number(actor.system?.attributes?.hp?.max) || (10 * hpPerBar);
      const newHp = restoredValue(hpBefore, healVal, maxHp);
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
  const equippedGear = workingGear(actor, actor.items, 'roundHealing');
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

/**
 * Helper to parse and evaluate damage or healing effect expressions.
 * Supports:
 * - Flat numbers: 5, "4"
 * - Bars: "1 bar", "2 bars" (1 bar = hpPerBar)
 * - Floor variable: "1d10+F", "1d8+F" (F replaced with current floor)
 * - Dice expressions: "1d6", "2d4+2" (evaluated via Foundry Roll or fallback math)
 * @param {string|number} expr
 * @param {object} [options={}]
 * @param {Actor} [options.actor=null]
 * @param {number} [options.floor=1]
 * @returns {Promise<number>}
 */
export async function evaluateEffectFormula(expr, { actor = null, floor = 1 } = {}) {
  if (!expr && expr !== 0) return 0;
  if (typeof expr === 'number') return Math.max(0, Math.floor(expr));

  const str = String(expr).trim();
  if (!str) return 0;

  // Check for "X bar" or "X bars"
  const barMatch = str.match(/^(\d+)\s*bars?$/i);
  if (barMatch) {
    const bars = parseInt(barMatch[1], 10) || 0;
    let hpPerBar = 4;
    if (actor) {
      hpPerBar = COGCombatMetrics.getHpPerBar(actor);
    } else if (actor?.system?.attributes?.hp?.hpPerBar) {
      hpPerBar = Number(actor.system.attributes.hp.hpPerBar) || 4;
    } else if (actor?.getCOGStatModifier && actor?.system?.abilities?.con?.value !== undefined) {
      hpPerBar = Math.max(1, actor.getCOGStatModifier(actor.system.abilities.con.value));
    }
    return bars * hpPerBar;
  }

  // Replace F (Floor) variable: e.g. 1d10+F or 1d8+F
  const fVal = Number(floor) || 1;
  const sanitized = str.replace(/\bF\b/gi, String(fVal));

  // If pure number:
  if (!isNaN(Number(sanitized))) {
    return Math.max(0, Math.floor(Number(sanitized)));
  }

  // Dice expression (e.g. 1d6, 1d8+1, 2d4):
  try {
    if (typeof Roll !== 'undefined') {
      const r = new Roll(sanitized);
      // v14: `evaluate()` is async and takes no `async` option (that option is deprecated); this function is async anyway.
      if (typeof r.evaluate === 'function') {
        const resolved = await r.evaluate();
        return Math.max(0, Math.floor(resolved.total || 0));
      }
    }
  } catch (err) {
    console.warn('Sprinter RPG | Could not evaluate effect roll formula:', sanitized, err);
  }

  // Fallback simple dice parsing (e.g. in test harness if Roll is minimal)
  const diceMatch = sanitized.match(/^(\d*)d(\d+)(?:\s*([+-])\s*(\d+))?$/i);
  if (diceMatch) {
    const count = parseInt(diceMatch[1], 10) || 1;
    const sides = parseInt(diceMatch[2], 10);
    const sign = diceMatch[3] === '-' ? -1 : 1;
    const mod = parseInt(diceMatch[4], 10) || 0;
    let total = 0;
    for (let i = 0; i < count; i++) {
      total += Math.floor(Math.random() * sides) + 1;
    }
    total += (sign * mod);
    return Math.max(0, total);
  }

  return 0;
}

/**
 * Post an end-of-round chat card summarizing all debuff damage and buff healing.
 * @param {Array<object>} results
 * @param {number} round
 */
export async function postRoundEndEffectsChatCard(results, round) {
  if (!globalThis.ChatMessage?.create || !results?.length) return;

  const rows = results.map(res => {
    if (res.type === 'debuff') {
      if (res.conCheck?.success) {
        return `
          <div class="cog-bg-success-tint" style="display: flex; align-items: center; justify-content: space-between; padding: 4px 6px; border-left: 3px solid var(--cog-success); margin-bottom: 3px; font-size: 11px;">
            <div>
              <span class="cog-text-success" style="font-weight: bold;"><i class="fa-solid fa-shield-heart"></i> ${res.itemName}</span>
              <span class="cog-text"> &rarr; <strong>${res.actorName}</strong></span>
              <span class="cog-text-success" style="font-size: 10px;"> (CON Check ${res.conCheck.total} vs DC ${res.conCheck.dc}: SUCCESS)</span>
            </div>
            <div style="text-align: right;">
              <span class="cog-text-success" style="font-weight: bold; font-size: 11px;">DAMAGE AVOIDED (${res.itemName} Ended!)</span>
              <span class="cog-text-muted" style="font-size: 10px;"> (${res.hpAfter} HP)</span>
            </div>
          </div>
        `;
      }
      return `
        <div class="cog-bg-danger-tint" style="display: flex; align-items: center; justify-content: space-between; padding: 4px 6px; border-left: 3px solid var(--cog-accent); margin-bottom: 3px; font-size: 11px;">
          <div>
            <span class="cog-text-accent" style="font-weight: bold;"><i class="fa-solid fa-skull"></i> ${res.itemName}</span>
            <span class="cog-text-muted" style="font-size: 10px;"> (${res.damageType || 'Physical'})</span>
            <span class="cog-text"> &rarr; <strong>${res.actorName}</strong></span>
            ${res.conCheck && !res.conCheck.success ? `<span class="cog-text-accent" style="font-size: 10px;"> (CON Check ${res.conCheck.total} vs DC ${res.conCheck.dc}: FAILED)</span>` : ''}
          </div>
          <div style="text-align: right;">
            <span class="cog-text-accent" style="font-weight: bold; font-size: 12px;">${res.actualDamage > 0 ? `-${res.actualDamage} HP` : 'No Health Bar lost'}</span>
            <span class="cog-text-muted" style="font-size: 10px;"> (${res.hpAfter} HP)</span>
          </div>
        </div>
      `;
    } else {
      return `
        <div class="cog-bg-success-tint" style="display: flex; align-items: center; justify-content: space-between; padding: 4px 6px; border-left: 3px solid var(--cog-success); margin-bottom: 3px; font-size: 11px;">
          <div>
            <span class="cog-text-success" style="font-weight: bold;"><i class="fa-solid fa-sparkles"></i> ${res.itemName}</span>
            <span class="cog-text"> &rarr; <strong>${res.actorName}</strong></span>
          </div>
          <div style="text-align: right;">
            <span class="cog-text-success" style="font-weight: bold; font-size: 12px;">+${res.actualHealed} HP</span>
            <span class="cog-text-muted" style="font-size: 10px;"> (${res.hpAfter}/${res.maxHp} HP)</span>
          </div>
        </div>
      `;
    }
  }).join('');

  const content = `
    <div class="cog-chat-card cog-round-end-card" style="border: 2px solid var(--cog-panel-border); border-radius: 4px; overflow: hidden; font-family: 'Oswald', sans-serif;">
      <div class="cog-dark cog-bg-header-fill cog-text-on-fill" style="padding: 6px 10px; font-weight: bold; font-size: 12px; text-transform: uppercase; display: flex; justify-content: space-between; align-items: center;">
        <span><i class="fa-solid fa-hourglass-end"></i> End of Round ${round} Effects</span>
        <span style="font-size: 10px; opacity: 0.85;">${results.length} Triggered</span>
      </div>
      <div class="cog-bg-surface" style="padding: 6px 8px;">
        ${rows}
      </div>
    </div>
  `;

  return globalThis.ChatMessage.create({
    content,
    speaker: { alias: 'Combat Tracker' }
  });
}

/**
 * Automatically trigger all debuffs that cause damage and all buffs that cause healing
 * across all combatants at the end of a combat round. Guarded per round: a second call for the same round (even
 * after the in-memory set is lost) returns nothing.
 * @param {object} combat
 * @param {number} [round=combat.round]
 * @returns {Promise<Array<object>>} List of applied effects
 */
export async function triggerRoundEndEffects(combat, round = combat.round) {
  const r = Number(round) || 1;
  combat._triggeredRoundEndEffects = combat._triggeredRoundEndEffects || new Set();
  const roundKey = `${combat.id || 'active'}-round-${r}`;
  const doneRound = Number(combat.getFlag?.(SYSTEM_ID, 'roundEndEffectsRound') ?? combat.flags?.[SYSTEM_ID]?.roundEndEffectsRound) || 0;
  if (combat._triggeredRoundEndEffects.has(roundKey) || doneRound >= r) {
    return [];
  }
  combat._triggeredRoundEndEffects.add(roundKey);
  if (typeof combat.setFlag === 'function') await combat.setFlag(SYSTEM_ID, 'roundEndEffectsRound', r);

  const currentFloor = getCurrentFloor();

  const results = [];
  const combatantsList = Array.from(combat.combatants || []);
  const ctx = {
    combat,
    round: r,
    floor: currentFloor,
    evaluate: (expr, actor) => evaluateEffectFormula(expr, { actor, floor: currentFloor })
  };

  for (const c of combatantsList) {
    const actor = c.actor || (globalThis.game?.actors?.get ? globalThis.game.actors.get(c.actorId) : null);
    if (!actor) continue;
    // Per combatant: debuffs, then buffs, then equipped gear
    results.push(...await roundEndDebuffEffects(actor, c, ctx));
    results.push(...await roundEndBuffHealing(actor, c, ctx));
    results.push(...await roundEndGearEffects(actor, c, ctx));
  }

  // Post Chat Card if any effects triggered
  if (results.length > 0) {
    await postRoundEndEffectsChatCard(results, r);
  }

  return results;
}
