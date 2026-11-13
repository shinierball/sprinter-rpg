/**
 * Sprinter RPG — the pure maths of applying damage to one target (3.43 B2).
 *
 * Each function is one stage of `COGDamage.applyDamageToTarget` (damage-pipeline.mjs): it reads a target and the
 * numbers of the previous stage and returns the numbers of the next. Nothing here writes a document or imports from
 * `src/apps/`, so every stage can be unit-tested with plain objects.
 */

import { hasRuleFlag, RULE_FLAGS } from '../../utils/tag/tag-behaviour.mjs';
import { workingGear } from '../../utils/effects/gear-suppression.mjs';
import { droppedTickText } from '../../utils/roll/ticked-subject.mjs';
import { buildRollContext, actionTagsOf, roleTagsOf, parseRollContext, retargetContext, serializeRollContext } from '../../utils/roll/roll-context.mjs';
import { resolveTargetParts, resolveApplyRows, breakdownLines, multiplierOf, critAmountOf } from '../../utils/damage/per-target-damage.mjs';
import { clickTargetsOf } from '../../utils/roll/scalars.mjs';
import { damageTypeToElement, ENGINE_SITUATIONS, normalizeElementTag } from '../../data/tag-vocabulary.mjs';
import { amazingNames } from '../../utils/roll/amazing-success.mjs';

/**
 * The DR that still counts against Armor-Piercing damage: the `drBonus` of equipped gear carrying the Anti-Piercing
 * rule flag (a tag, never a name). All other DR is ignored by Armor-Piercing.
 * @param {Actor} actor
 * @returns {number}
 */
export function antiPiercingGearDr(actor) {
  let total = 0;
  for (const item of workingGear(actor, actor?.items, 'armor')) {
    if (hasRuleFlag(item, RULE_FLAGS.antiPiercing)) total += Number(item.system.drBonus) || 0;
  }
  return total;
}

/**
 * The factors a click puts on the damage: the slot-loss mode, the button's multiplier, the Evade and the Amazing Success.
 * @param {object} params
 * @param {number} params.multiplier the button's multiplier
 * @param {object|null} params.evade this target's linked Evade
 * @param {object|null} params.amazing this target's Amazing Success
 * @param {boolean} params.isCrit the clicked button is the Critical Hit one
 * @param {number} params.slotLoss Health Bar slots to lose (Damage Reflection)
 * @returns {{ slotsToLose: number, slotMode: boolean, mult: number, evadeMult: number, evadeDouble: number, evadeFloorBonus: number, amazingOn: boolean, amazingFloor: number }}
 */
export function hitFactors({ multiplier, evade, amazing, isCrit, slotLoss }) {
  const slotsToLose = Math.max(0, Math.floor(Number(slotLoss) || 0));
  const slotMode = slotsToLose > 0;

  const mult = multiplierOf(multiplier);
  // The Evade's multiplier is its own factor (0 is valid, so no `|| 1`), applied once after the button's: one floor.
  const evadeMult = evade && !evade.ignored && Number.isFinite(Number(evade.multiplier)) ? Number(evade.multiplier) : 1;
  // An Evade failure's book extras (E6.4): the Floor number joins the first damage type before DR, then a Natural 1 doubles
  // the whole hit (like the crit factor, after the bonus). An ignored Evade carries neither.
  // The degrees of failure are not additive (E6.5): a Natural 1's doubling replaces the Major Fail's Floor bonus.
  const evadeDouble = evade && !evade.ignored && evade.double === true ? 2 : 1;
  const evadeFloorBonus = evade && !evade.ignored && evadeDouble === 1 ? Math.max(0, Math.floor(Number(evade.floorBonus) || 0)) : 0;

  // An Amazing Success (E6.9) adds the Floor after the multipliers, like the Evade bonus; a Critical Hit supersedes it
  // and a fully evaded hit has nothing to add to. The tag follows this same decision.
  const amazingOn = Boolean(amazing) && !isCrit && evadeMult !== 0;
  const amazingFloor = amazingOn ? Math.max(0, Math.floor(Number(amazing.floorBonus) || 0)) : 0;
  return { slotsToLose, slotMode, mult, evadeMult, evadeDouble, evadeFloorBonus, amazingOn, amazingFloor };
}

/**
 * The card's context as it applies to this one target, Stage A of the per-target rows, and the target's `defense` context.
 * @param {object} params
 * @param {Actor} params.targetActor
 * @param {Actor|null} params.attackerActor
 * @param {object|string|null} params.rollContext the attack's serialized roll context
 * @param {boolean} params.isCrit
 * @param {boolean} params.amazingOn
 * @param {Array<object>|null} params.targetRows the card's snapshotted target rows
 * @param {Array<object>|null} params.clickTargets the click's batch
 * @param {Array<object>|null} params.parts the damage card's per-part amounts
 * @param {boolean} [params.intercepting] the target caught this hit for an ally (Catcher): its defence context says so
 * @returns {{ card: object|null, retargeted: object|null, stageA: object, attackTags: string[], defenseContext: object }}
 */
export function targetDamageContexts({ targetActor, attackerActor, rollContext, isCrit, amazingOn, targetRows, clickTargets, parts, intercepting = false }) {
  // Defense rows are judged against one `defense` context per target: `self.*` is the target, `attacker.*` the one
  // hitting it, and the unprefixed tags are the attack's own.
  const card = rollContext ? parseRollContext(rollContext) : null;
  // The card's context as it applies to this target: its subject.* tags are the target's (an asserted tick stays,
  // joined by the target's), and the Critical Hit tag follows the clicked button, not the roll.
  const retargeted = retargetContext(card, { other: targetActor, isCrit: Boolean(isCrit), isAmazing: amazingOn, attacker: attackerActor });
  // Deferred rows (E3.5) become ordinary target rows with this target's numbers, then Stage A: the attacker's target
  // rows that match this target, applied to the parts from their rolled bases.
  const batch = clickTargets ?? clickTargetsOf([targetActor]);
  const rows = retargeted
    ? resolveApplyRows(Array.isArray(targetRows) ? targetRows : [], { subject: targetActor, targets: batch, context: retargeted })
    : [];
  const resolved = resolveTargetParts({
    parts: Array.isArray(parts) ? parts : [],
    targetRows: rows,
    tags: retargeted?.tags ?? []
  });
  // A ticked subject tag the target contradicts was dropped (E8.14): say so on the breakdown.
  const warnings = (retargeted?.droppedTicks ?? []).map(d => ({ stage: 'attacker', text: droppedTickText(d) }));
  const stageA = warnings.length > 0 ? { ...resolved, lines: [...resolved.lines, ...warnings] } : resolved;
  const attackTags = actionTagsOf(retargeted ?? card);
  const defenseContext = buildRollContext({
    actor: targetActor,
    phase: 'defense',
    tags: intercepting ? [...attackTags, ENGINE_SITUATIONS.intercepting] : attackTags,
    other: attackerActor ?? null,
    otherRole: 'attacker',
    otherTags: attackerActor ? undefined : roleTagsOf(card, 'self')
  });
  return { card, retargeted, stageA, attackTags, defenseContext };
}

/**
 * The damage per type: the card's parts summed per type, else the typed-damage dictionary, else one legacy amount. Slot mode has none.
 * @param {object} params
 * @param {Array<{type?: string, amount?: number}>} params.parts Stage A's resolved parts
 * @param {boolean} params.slotMode
 * @param {object|null} params.typedDamage
 * @param {string} params.damageType
 * @param {number} params.rawDamage
 * @returns {{ damageBuckets: Record<string, number> }}
 */
export function damageBucketsFor({ parts, slotMode, typedDamage, damageType, rawDamage }) {
  const partBuckets = {};
  for (const part of parts) {
    const type = String(part?.type || 'Physical');
    partBuckets[type] = (partBuckets[type] || 0) + (Number(part?.amount) || 0);
  }
  const damageBuckets = slotMode ? {} : Object.keys(partBuckets).length > 0
    ? partBuckets
    : typedDamage && typeof typedDamage === 'object'
      ? { ...typedDamage }
      : (damageType ? { [damageType]: Number(rawDamage) || 0 } : { 'Physical': Number(rawDamage) || 0 });
  return { damageBuckets };
}

/**
 * Pass 1: what each damage type is up against (its reductions, Vulnerability, Immunity) and its starting amount.
 * @param {Actor} targetActor
 * @param {object} params
 * @param {Record<string, number>} params.damageBuckets
 * @param {object} params.factors `hitFactors` output
 * @param {object} params.defenseContext
 * @returns {{ entries: object[], conditionalDr: number, anyImmune: boolean, anyResistant: boolean, floorImmune: boolean, amazingImmune: boolean }}
 */
export function typeEntriesFor(targetActor, { damageBuckets, factors, defenseContext }) {
  const { mult, evadeMult, evadeDouble, evadeFloorBonus, amazingFloor } = factors;
  let anyImmune = false;
  let anyResistant = false;
  let conditionalDr = 0;
  const healthBar = { factor: 1, source: '' };
  const entries = [];
  for (const [dt, rawAmt] of Object.entries(damageBuckets)) {
    const scaled = Math.max(0, Math.floor((Number(rawAmt) || 0) * mult * evadeMult));
    const initialAmt = scaled * evadeDouble;
    const entry = { dt, initialAmt, isImmune: false, isResistant: false, vulnerable: false, suppressDr: false, sources: [], percent: 0, flat: 0, rounding: 'up', legacyHalf: false };
    if (typeof targetActor.getDamageReduction === 'function') {
      const red = targetActor.getDamageReduction(dt, defenseContext);
      entry.vulnerable = Boolean(red.vulnerable);
      entry.suppressDr = Boolean(red.suppressDr);
      entry.sources = Array.isArray(red.sources) ? red.sources : [];
      conditionalDr = Math.max(conditionalDr, Number(red.dr) || 0);
      entry.isImmune = Boolean(red.isImmune);
      entry.isResistant = !entry.isImmune && Boolean(red.isResistant);
      entry.percent = Number(red.percent) || 0;
      entry.flat = Number(red.flat) || 0;
      entry.rounding = red.rounding;
      if ((Number(red.hbFactor) || 1) > healthBar.factor) Object.assign(healthBar, { factor: Number(red.hbFactor), source: red.hbSource || '' });
    } else if (typeof targetActor.hasImmunity === 'function' && targetActor.hasImmunity(dt)) {
      entry.isImmune = true;
    } else if (typeof targetActor.hasResistance === 'function' && targetActor.hasResistance(dt)) {
      entry.isResistant = true;
      entry.legacyHalf = true;
    }
    if (entry.isImmune) anyImmune = true;
    if (entry.isResistant) anyResistant = true;
    entries.push(entry);
  }

  // The Floor bonus goes on the first damage type the target is not immune to (E6.5); immune to all, it is not added.
  // The Evade's and the Amazing Success's bonuses are separate and may land on the same entry (E6.9).
  const floorEntry = evadeFloorBonus > 0 || amazingFloor > 0 ? entries.find(e => !e.isImmune) : null;
  if (floorEntry) floorEntry.initialAmt += evadeFloorBonus + amazingFloor;
  const floorImmune = evadeFloorBonus > 0 && !floorEntry;
  const amazingImmune = amazingFloor > 0 && !floorEntry;
  return { entries, conditionalDr, anyImmune, anyResistant, floorImmune, amazingImmune, healthBar };
}

/**
 * The DR this hit meets. Conditional DR rows are per-hit (the largest any bucket matched, so an all-damage row is not
 * counted per type). Armor-Piercing ignores DR except that of equipped armor with the Anti-Piercing benefit.
 * @param {Actor} targetActor
 * @param {object} params
 * @param {boolean} params.ignoreDR
 * @param {boolean} params.slotMode
 * @param {number} params.extraDr "+N DR against the triggering attack" from the target's interrupt
 * @param {number} params.conditionalDr
 * @returns {{ dr: number, antiPiercingDr: number, interruptDr: number }}
 */
export function totalDrFor(targetActor, { ignoreDR, slotMode, extraDr, conditionalDr }) {
  const antiPiercingDr = ignoreDR ? antiPiercingGearDr(targetActor) : 0;
  // The target's interrupt to this attack adds its DR (Catcher); Armor-Piercing ignores it with the rest.
  const interruptDr = ignoreDR || slotMode ? 0 : Math.min(1000, Math.max(0, Math.floor(Number(extraDr) || 0)));
  const dr = ignoreDR ? antiPiercingDr : (Number(targetActor.system?.attributes?.dr?.total ?? targetActor.system?.attributes?.dr?.value) || 0) + conditionalDr + interruptDr;
  return { dr, antiPiercingDr, interruptDr };
}

/**
 * Pass 2, in the book's order (Chapter 2, "Applying Damage Resistance Effects"): DR first, spent across the
 * damage types in order (skipping a type a `suppress_dr` row covers and a type that is immune); then
 * Resistance and percentage reductions (Resistance counted once per type, see `getDamageReduction`); then
 * Vulnerability doubles; then Immunity zeroes the type.
 *
 * The DR pool is spent in the defender's favour (E6.6): Vulnerable types first (a point saves 2), then plain
 * types (saves 1), then types with a percentage reduction / Resistance (saves about half), then types with a
 * flat reduction (a point may be wasted); an immune or `suppress_dr` type takes none. Ties keep card order.
 * The breakdown stays in card order; each type records the DR it took as `drUsed` (set on its entry).
 * @param {object[]} entries `typeEntriesFor` entries
 * @param {number} dr
 * @returns {{ typeBreakdown: Record<string, object>, totalAdjustedRaw: number, rawTotal: number }}
 */
export function spendDr(entries, dr) {
  const typeBreakdown = {};
  const drRank = e => e.vulnerable ? 0 : (e.percent > 0 || e.legacyHalf || e.isResistant) ? 2 : e.flat > 0 ? 3 : 1;
  let drLeft = dr;
  for (const e of entries.map((entry, i) => ({ entry, i })).sort((a, b) => drRank(a.entry) - drRank(b.entry) || a.i - b.i).map(x => x.entry)) {
    e.drUsed = 0;
    if (e.isImmune || e.suppressDr) continue;
    e.drUsed = Math.min(drLeft, e.initialAmt);
    drLeft -= e.drUsed;
  }
  let totalAdjustedRaw = 0;
  let rawTotal = 0; // the damage that reached the target's defenses (an immune type contributes nothing)
  for (const e of entries) {
    let amt = e.initialAmt;
    if (!e.isImmune) rawTotal += e.initialAmt;
    amt -= e.drUsed;
    if (e.legacyHalf) amt = Math.floor(amt / 2);
    if (e.percent > 0) {
      const reduction = e.rounding === 'up' ? Math.ceil(amt * e.percent) : Math.floor(amt * e.percent);
      amt = Math.max(0, amt - reduction);
    }
    if (e.flat > 0) amt = Math.max(0, amt - e.flat);
    if (e.vulnerable) amt *= 2;
    if (e.isImmune) amt = 0;
    typeBreakdown[e.dt] = {
      initial: e.initialAmt,
      final: amt,
      drUsed: e.drUsed,
      isImmune: e.isImmune,
      isResistant: e.isResistant,
      vulnerable: e.vulnerable,
      suppressDr: e.suppressDr,
      sources: e.sources
    };
    totalAdjustedRaw += amt;
  }
  return { typeBreakdown, totalAdjustedRaw, rawTotal };
}

/**
 * Deduct from Temporary Health Bars first slot-by-slot, then legacy Temp HP, then whole regular bars.
 * @param {Actor} targetActor
 * @param {object} params
 * @param {number} params.damageAfterDR the damage that survived DR and the other reductions
 * @param {Record<string, object>} params.typeBreakdown
 * @param {boolean} params.slotMode
 * @param {number} params.slotsToLose
 * @param {number} params.hpPerBar
 * @returns {object} every pool number the result and the update need; `damageAfterDR` is the slot-mode overwrite when
 *   the hit is a slot loss
 */
export function spendHpPools(targetActor, { damageAfterDR, typeBreakdown, slotMode, slotsToLose, hpPerBar }) {
  const tb = targetActor.system?.attributes?.hp?.tempBars;
  let tbCount = Number(tb?.count) || 0;
  const tbHpPerSlot = Number(tb?.hpPerSlot) || 0;
  let tbCurrentSlotHp = Number(tb?.currentSlotHp) || (tbCount > 0 ? tbHpPerSlot : 0);
  const tbCountBefore = tbCount;
  const hasTempBars = tbCount > 0 && tbHpPerSlot > 0;
  // An element-limited pool (`element.<type>`) takes only damage of that element; the rest passes it by to the regular bars.
  const tbElement = hasTempBars && !slotMode ? normalizeElementTag(tb?.element) : '';
  let passedDamage = 0;
  let absorbableDamage = damageAfterDR;
  if (tbElement) {
    absorbableDamage = Object.entries(typeBreakdown)
      .filter(([dt]) => damageTypeToElement(dt) === tbElement)
      .reduce((sum, [, row]) => sum + (Number(row.final) || 0), 0);
    passedDamage = damageAfterDR - absorbableDamage;
  }

  let tempBarsRemainingHp = 0;
  if (hasTempBars) {
    tempBarsRemainingHp = (tbCount - 1) * tbHpPerSlot + tbCurrentSlotHp;
  }

  // Slot-loss mode: the HP the lost slots hold. Temporary slots go first (the partly spent one first of all), then
  // regular bars; the normal pools pass below then removes exactly those slots.
  if (slotMode) {
    const tempSlots = hasTempBars ? Math.min(slotsToLose, tbCount) : 0;
    const tempHpAfter = tempSlots > 0 ? (tbCount - tempSlots) * tbHpPerSlot : tempBarsRemainingHp;
    damageAfterDR = (tempBarsRemainingHp - tempHpAfter) + (slotsToLose - tempSlots) * hpPerBar;
    absorbableDamage = damageAfterDR;
  }

  let tempBarsDamage = 0;
  let damagePenetrating = absorbableDamage;

  if (hasTempBars && damagePenetrating > 0) {
    if (damagePenetrating <= tempBarsRemainingHp) {
      tempBarsDamage = damagePenetrating;
      tempBarsRemainingHp -= damagePenetrating;
      damagePenetrating = 0;
    } else {
      tempBarsDamage = tempBarsRemainingHp;
      damagePenetrating -= tempBarsRemainingHp;
      tempBarsRemainingHp = 0;
    }

    if (tempBarsRemainingHp <= 0) {
      tbCount = 0;
      tbCurrentSlotHp = 0;
    } else {
      tbCount = Math.ceil(tempBarsRemainingHp / tbHpPerSlot);
      const rem = tempBarsRemainingHp % tbHpPerSlot;
      tbCurrentSlotHp = rem === 0 ? tbHpPerSlot : rem;
    }
  }
  damagePenetrating += passedDamage;

  // Deduct from legacy Temp HP point-for-point if any penetrating damage remains
  const currentTemp = Number(targetActor.system?.attributes?.hp?.temp) || 0;
  const currentHp = Number(targetActor.system?.attributes?.hp?.value) || 0;
  let legacyTempRemaining = Math.max(0, currentTemp - tempBarsDamage);
  let legacyTempDamage = 0;

  if (!hasTempBars && !slotMode && currentTemp > 0 && damagePenetrating > 0) {
    if (damagePenetrating <= currentTemp) {
      legacyTempDamage = damagePenetrating;
      legacyTempRemaining = currentTemp - damagePenetrating;
      damagePenetrating = 0;
    } else {
      legacyTempDamage = currentTemp;
      legacyTempRemaining = 0;
      damagePenetrating = damagePenetrating - currentTemp;
    }
  }

  const tempDamage = tempBarsDamage + legacyTempDamage;
  const tempRemaining = hasTempBars ? tempBarsRemainingHp : legacyTempRemaining;

  // Only remove full damage bars rounded down from regular HP. Excess damage is ignored.
  const barsRemoved = Math.floor(damagePenetrating / hpPerBar);
  // Slots this hit took: the regular slots plus the temporary slots it emptied (Q164: lifesteal, reflection).
  const slotsLost = barsRemoved + (hasTempBars ? Math.max(0, tbCountBefore - tbCount) : 0);
  const damageToHp = barsRemoved * hpPerBar;
  const excessDamage = damagePenetrating - damageToHp;
  const actualDamage = tempDamage + damageToHp;

  const newHp = Math.max(0, currentHp - damageToHp);
  const isLethal = currentHp > 0 && newHp === 0;
  return {
    damageAfterDR, hasTempBars, hasTempBarsField: Boolean(tb), tbCount, tbHpPerSlot, tbCurrentSlotHp, tbElement,
    passedDamage, tempBarsRemainingHp, tempBarsDamage, tempDamage, tempRemaining,
    barsRemoved, slotsLost, damageToHp, excessDamage, actualDamage, newHp, isLethal
  };
}

/**
 * The actor update for the pools after a hit, and the HP-pool snapshot for the undo record.
 * @param {Actor} targetActor
 * @param {object} pools `spendHpPools` output
 * @param {object} before `snapshotHpPools` taken before the write
 * @returns {{ actorUpdates: object, after: object }}
 */
export function hpPoolUpdates(targetActor, pools, before) {
  const { newHp, tempRemaining, hasTempBars, hasTempBarsField, tbCount, tbCurrentSlotHp, tbHpPerSlot } = pools;
  const actorUpdates = {
    'system.attributes.hp.value': newHp,
    'system.attributes.hp.temp': tempRemaining
  };
  if (hasTempBars || hasTempBarsField) {
    actorUpdates['system.attributes.hp.tempBars.count'] = tbCount;
    actorUpdates['system.attributes.hp.tempBars.currentSlotHp'] = tbCurrentSlotHp;
    if (tbCount === 0) {
      actorUpdates['system.attributes.hp.tempBars.source'] = '';
      actorUpdates['system.attributes.hp.tempBars.sourceUuid'] = '';
      actorUpdates['system.attributes.hp.tempBars.element'] = '';
    }
  }
  const after = {
    hp: newHp,
    temp: tempRemaining,
    tempBars: before.tempBars
      ? {
        count: tbCount,
        currentSlotHp: tbCurrentSlotHp,
        hpPerSlot: tbHpPerSlot,
        source: tbCount === 0 ? '' : before.tempBars.source,
        sourceUuid: tbCount === 0 ? '' : before.tempBars.sourceUuid,
        element: tbCount === 0 ? '' : before.tempBars.element
      }
      : null
  };
  return { actorUpdates, after };
}

/**
 * The per-target record of a hit: the parts applied, the Amazing and Evade records, the breakdown lines and the
 * target's own roll context.
 * @param {object} p
 * @returns {{ damagePartsApplied: object[], amazingRecord: object|null, lines: object[], evadeRecord: object|null, perTargetContext: object|null }}
 */
export function perTargetRecord({ stageA, card, retargeted, factors, isCrit, typeBreakdown, dr, ignoreDR, antiPiercingDr, interruptDr, extraDrLabel, evade, amazing, floorImmune, amazingImmune, damageBuckets, healthBar = null }) {
  const { mult, evadeDouble, amazingOn, amazingFloor, slotMode, slotsToLose } = factors;
  const damagePartsApplied = Object.entries(damageBuckets).map(([type, amount]) => ({ type, amount: Number(amount) || 0 }));
  const amazingRecord = amazingOn ? { floorBonus: amazingFloor, immune: amazingImmune } : null;
  const lines = breakdownLines({
    stageA, multiplier: mult, isCrit: Boolean(isCrit), critAmount: critAmountOf(stageA.parts), typeBreakdown, dr, ignoreDR: ignoreDR && !antiPiercingDr,
    evade: evade && floorImmune ? { ...evade, floorImmune: true } : evade,
    amazing: amazingOn ? { ...amazingRecord, triggers: amazing.triggers, found: amazingNames(amazing.triggers) } : null
  });
  if (interruptDr > 0) lines.push({ stage: 'dr', text: `+${interruptDr} DR${extraDrLabel ? ` (${String(extraDrLabel).slice(0, 40)})` : ''}` });
  if (healthBar && healthBar.factor > 1 && !slotMode) lines.push({ stage: 'dr', text: `Health Bars ×${healthBar.factor}${healthBar.source ? ` (${String(healthBar.source).slice(0, 40)})` : ''}` });
  if (slotMode) lines.push({ stage: 'crit', text: `Lost ${slotsToLose} Health Bar slot${slotsToLose === 1 ? '' : 's'}` });
  const evadeRecord = evade ? { messageId: evade.messageId ?? null, outcome: evade.outcome, multiplier: evade.multiplier, floorBonus: evadeDouble === 2 ? 0 : Number(evade.floorBonus) || 0, double: evade.double === true, ignored: Boolean(evade.ignored), rolls: evade.rolls ?? 1 } : null;
  // This target's context: its subject.* tags, the button's crit, and the rows that went into its numbers (frozen
  // rows named on the card, plus the target rows that matched).
  const perTargetContext = retargeted
    ? { ...serializeRollContext(retargeted), appliedRowKeys: [...new Set([...card.appliedRowKeys, ...stageA.matchedRowKeys])] }
    : null;
  return { damagePartsApplied, amazingRecord, lines, evadeRecord, perTargetContext };
}
