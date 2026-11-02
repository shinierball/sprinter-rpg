/**
 * The stages of casting a spell (3.43): toggle-off, gates, cost, Mana confirmation, payment, healing, cast effects,
 * conditions and the session record. `COGActor#rollSpell` strings them together; each takes the caster first.
 */
import { offersSpellAttack } from '../../utils/spell-cast-link.mjs';
import { applySpellConditions, spellSkipsCaster } from './spell-card-parts.mjs';
import { getItemAllTags, getTagDefinition } from '../../data/tags.mjs';
import { getHpPerBar } from '../../apps/combat-metrics.mjs';
import { COGSessionEngine } from '../../apps/session-manager.mjs';
import { SYSTEM_ID } from '../../constants.mjs';
import { resolveReachedRankBreaks } from '../../utils/rank-breaks.mjs';
import { gateAttackRange, findOutOfRange } from '../../utils/attack-range.mjs';
import { rankBreakConditionRounds } from '../../utils/durations.mjs';
import { buildRollContext, extendContext } from '../../utils/roll-context.mjs';
import { confirmRuleBreak } from '../../utils/rule-break.mjs';
import { gateItemCooldown, gateGrantedSpellCooldown } from './cooldown-gate.mjs';
import { computeManaCost, resolveManaCostSituations } from '../../utils/narrow-modifiers.mjs';
import { isAuraItem, isAreaTagSet, isHealingItem } from '../../utils/tag-mechanics.mjs';
import { igniteLight, isLit, isSelfLightSpell, extinguish as extinguishLight } from './light-source.mjs';
import { auraDismissedMessage, grantItemTempBars, healingBarsFor, cleanseListFor } from './use-card-parts.mjs';
import { spellFailedCardHtml } from './spell-cast-card.mjs';
import { cardMessageOptions } from '../../utils/chat-mode.mjs';

/**
 * Casting an active aura dismisses it, and recasting a lit self light puts it out without spending Mana (3.16c).
 * Synchronous on purpose: a cast that is not a toggle-off reaches its cooldown gate in the same tick, as callers and
 * tests that open the gate's dialog right after calling `rollSpell` expect.
 * @param {Actor} actor the caster
 * @param {Item} spell
 * @returns {Promise<*>|null} the promise of the posted card, or null when this cast is not a toggle-off
 */
export function toggleOffSpell(actor, spell) {
  const sys = spell.system || {};
  const isAura = isAuraItem(spell);

  // If an aura is currently active, casting it toggles/dismisses it
  if (isAura && sys.active) return dismissActiveAura(actor, spell);

  // Recasting a lit self light (Torch) puts it out, without spending mana (3.16c)
  const isSelfLight = !isAura && isSelfLightSpell(spell);
  if (isSelfLight && isLit(spell)) return putOutLight(actor, spell);
  return null;
}

async function dismissActiveAura(actor, spell) {
  await actor.deactivateAura(spell);
  return ChatMessage.create(auraDismissedMessage(actor, spell, {
    cardClass: 'cog-spell-card', subtitle: 'Aura Deactivated', flags: { isSpellCast: true }
  }), cardMessageOptions(actor));
}

async function putOutLight(actor, spell) {
  await extinguishLight(spell);
  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="cog-chat-card cog-spell-card cog-aura-dismissed"><h3 class="cog-text">${spell.name} — DISMISSED</h3><div class="cog-text-secondary"><i class="fa-solid fa-power-off"></i> <strong>${actor.name}</strong> put out the light.</div></div>`,
    flags: { [SYSTEM_ID]: { isSpellCast: true, isLightDismiss: true } }
  }, cardMessageOptions(actor));
}

/**
 * The cooldown gate and the range gate (each a Rule Break the caster can confirm).
 * @param {Actor} actor
 * @param {Item} spell
 * @param {object} opts
 * @returns {Promise<{ isAura: boolean, isSelfLight: boolean, isGrantedSpell: boolean, cooldownGate: object, castRange: object }|null>}
 *   null when the caster declined a gate
 */
export async function gateSpellCast(actor, spell, opts) {
  const isAura = isAuraItem(spell);
  const isSelfLight = !isAura && isSelfLightSpell(spell);

  // A spell granted by gear is an inherent spell: it costs no Mana and its grant's cooldown limits it (3.12c, Q-F)
  const isGrantedSpell = Boolean(spell.isGranted && spell.grantSources?.length);

  // The cooldown gate. A scroll or gear that casts the spell carries the limit itself (`useLoot`), so it is skipped there.
  const carriedByItem = Boolean(opts.originItem || opts.isConsumable || opts.isItemEffect);
  const cooldownGate = carriedByItem
    ? { proceed: true, flags: {}, commit: async () => {} }
    : (isGrantedSpell
        ? await gateGrantedSpellCooldown(actor, spell, { options: opts })
        : await gateItemCooldown(actor, spell, { options: opts }));
  if (!cooldownGate.proceed) return null;

  // Range (3.48-8): a spell does not take hold of a target beyond its range unless the caster confirms a Rule Break.
  // An attack spell's range is judged at its attack roll, an aura is self. Cancelled before Mana or the cooldown is spent.
  const castRange = (!isAura && !offersSpellAttack(spell))
    ? await gateAttackRange(actor, spell, actor._attackTargetEntries(opts), { options: opts })
    : { proceed: true, ruleBreak: false, outOfRange: [], flags: {} };
  if (!castRange.proceed) return null;

  return { isAura, isSelfLight, isGrantedSpell, cooldownGate, castRange };
}

/**
 * The Mana the cast costs and the caster has: free casts, the favored penalty and the `manaCostModifiers` rows.
 * @param {Actor} actor
 * @param {Item} spell
 * @param {object} opts
 * @param {{ isGrantedSpell: boolean }} gates
 * @returns {Promise<{ isFreeCast: boolean, baseManaCost: number, favoredPenalty: number, isFavored: boolean, manaMods: object, manaCost: number, currentMana: number }>}
 */
export async function resolveSpellCost(actor, spell, opts, { isGrantedSpell }) {
  const sys = spell.system || {};
  const spellTags = spell.allTags || getItemAllTags(spell);
  const isFreeCast = Boolean(
    isGrantedSpell ||
    opts.freeCast ||
    opts.noMana ||
    opts.manaCost === 0 ||
    opts.originItem ||
    opts.isConsumable ||
    opts.isItemEffect ||
    sys.freeCast
  );
  const baseManaCost = Math.max(0, Number(sys.manaCost) || 0);

  // Check Favored spell mechanics (+1 MP for non-favored classes when caster has a class)
  const favoredTags = Array.from(spellTags).filter(t => typeof t === 'string' && t.startsWith('favored.'));

  let isFavored = true;
  let favoredPenalty = 0;

  const actorArchetypes = typeof actor.getArchetypeTags === 'function' ? actor.getArchetypeTags() : new Set();
  if (favoredTags.length > 0 && actorArchetypes.size > 0) {
    isFavored = favoredTags.some(ft => {
      const def = getTagDefinition(ft);
      const targetArchetype = def?.references || `archetype.${ft.replace(/^favored\./, '')}`;
      return targetArchetype && actorArchetypes.has(targetArchetype);
    });

    if (!isFavored) {
      favoredPenalty = 1;
    }
  }

  // manaCostModifiers rows (race/class/gear/buff/debuff): adds first, then multiplies, rounded up (spec 3.6)
  let manaMods = { cost: baseManaCost + favoredPenalty, breakdown: [] };
  if (!isFreeCast && opts.manaCost === undefined) {
    const costContext = buildRollContext({ actor, phase: 'manaCost', item: spell, other: null });
    const costSituations = await resolveManaCostSituations(actor, costContext, opts);
    manaMods = computeManaCost(actor, baseManaCost + favoredPenalty, extendContext(costContext, { situations: costSituations }));
  }
  const effectiveCost = isFreeCast ? 0 : (opts.manaCost !== undefined ? Number(opts.manaCost) : manaMods.cost);
  const manaCost = effectiveCost;
  const rawMana = actor.system?.attributes?.mana?.value !== undefined
    ? Number(actor.system.attributes.mana.value)
    : (Number(actor.system?.attributes?.mana?.max) || 0);
  const currentMana = Number.isFinite(rawMana) ? rawMana : 0;
  return { isFreeCast, baseManaCost, favoredPenalty, isFavored, manaMods, manaCost, currentMana };
}

/**
 * Insufficient Mana is a Rule Break the caster can confirm (CONTRIBUTING rule 2); without a confirmation the cast fails.
 * @param {Actor} actor
 * @param {Item} spell
 * @param {{ manaCost: number, currentMana: number }} cost
 * @param {object} opts
 * @returns {Promise<boolean>} true when the shortfall was confirmed as a Rule Break
 */
export async function confirmSpellMana(actor, spell, cost, opts) {
  let manaRuleBreak = false;
  if (cost.manaCost > 0 && cost.currentMana < cost.manaCost) {
    const res = await confirmRuleBreak({
      title: 'Insufficient Mana',
      message: `Insufficient Mana (${cost.currentMana}/${cost.manaCost}). Cast ${spell.name} anyway as a Rule Break?`,
      options: opts
    });
    manaRuleBreak = res.confirmed;
  }
  return manaRuleBreak;
}

/**
 * The refusal path: warn, then post the failed card. The cooldown is not committed.
 * @param {Actor} actor
 * @param {Item} spell
 * @param {object} cost the `resolveSpellCost` result
 * @returns {Promise<*>} the posted message
 */
export async function postSpellFailedCard(actor, spell, cost) {
  const { manaCost, baseManaCost, favoredPenalty, isFavored, currentMana } = cost;
  globalThis.ui?.notifications?.warn?.(`Sprinter RPG | ${actor.name} has insufficient Mana to cast ${spell.name}! (Needs ${manaCost} MP, has ${currentMana} MP)`);

  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: spellFailedCardHtml(actor, spell, cost),
    flags: {
      [SYSTEM_ID]: {
        isSpellCast: true,
        spellFailed: true,
        reason: 'insufficient_mana',
        manaCost,
        baseManaCost,
        favoredPenalty,
        isFavored,
        currentMana
      }
    }
  }, cardMessageOptions(actor));
}

/**
 * Subtract Mana on a successful cast (free casts never subtract) and start the cooldown timer.
 * @param {Actor} actor
 * @param {{ manaCost: number, currentMana: number }} cost
 * @param {{ cooldownGate: object }} gates
 * @returns {Promise<{ updates: object, newMana: number }>} `updates` is the pending actor update, which healing adds to
 */
export async function paySpellCost(actor, cost, { cooldownGate }) {
  const updates = {};
  const newMana = Math.max(0, cost.currentMana - cost.manaCost);
  if (actor.system?.attributes?.mana && cost.manaCost > 0) {
    updates['system.attributes.mana.value'] = newMana;
  }
  // The cast goes ahead: the cooldown timer starts now (hit or miss)
  await cooldownGate.commit();
  return { updates, newMana };
}

/**
 * A healing spell's heal on the caster: Health Bars (or a HoT) and the cleanses.
 * Mutates `updates`: a self heal adds its hp keys, so Mana and hp reach the actor in one update.
 * @param {Actor} actor
 * @param {Item} spell
 * @param {object} opts
 * @param {object} updates the pending actor update from `paySpellCost`
 * @returns {Promise<object|null>} the heal record carried on the card and flags, or null when the spell does not heal
 */
export async function applySpellHealing(actor, spell, opts, updates) {
  if (!isHealingItem(spell)) return null;
  const sys = spell.system || {};
  const cleansedDebuffs = [];
  const hpPerBar = getHpPerBar(actor);
  const effectiveRank = Math.max(Number(sys.modifiedRank) || 0, Number(sys.rank) || 0, 1);

  // Calculate bars to heal from barsFormula, with the cumulative healing bonuses from rank breaks
  const resolvedBreaks = resolveReachedRankBreaks(spell, effectiveRank);
  const barsToHeal = healingBarsFor(actor, sys.healing?.barsFormula || '1', resolvedBreaks);
  const debuffsToCleanse = cleanseListFor(sys, resolvedBreaks);

  const targetFilter = sys.healing?.targetFilter || sys.healing?.targetType || '';
  const isExplicitSelf = opts.target === 'self' || targetFilter === 'self';
  const isExplicitNonSelf = (targetFilter === 'ally' || targetFilter === 'allies' || targetFilter === 'area') && !isExplicitSelf;
  const isSelfTarget = isExplicitSelf || !isExplicitNonSelf;

  const isHoT = Boolean(sys.healing?.isHoT);
  const hotRounds = Number(sys.healing?.hotRounds) || 3;

  const currentHp = Number(actor.system?.attributes?.hp?.value ?? actor.system?.attributes?.hp?.max ?? 0);
  const maxHp = Number(actor.system?.attributes?.hp?.max) || (10 * hpPerBar);
  let newHp = currentHp;
  let actualHealed = 0;
  let newPct = maxHp > 0 ? Math.min(100, Math.max(0, Math.round((currentHp / maxHp) * 100))) : 100;

  if (isSelfTarget) {
    if (isHoT) {
      await actor.applyHoT({ name: `${spell.name} (HoT)`, healBars: barsToHeal, rounds: hotRounds });
    } else {
      const healAmt = barsToHeal * hpPerBar;
      newHp = Math.min(maxHp, currentHp + healAmt);
      actualHealed = Math.max(0, newHp - currentHp);
      newPct = maxHp > 0 ? Math.min(100, Math.max(0, Math.round((newHp / maxHp) * 100))) : 100;
      if (actor.system?.attributes?.hp) {
        updates['system.attributes.hp.value'] = newHp;
        updates['system.attributes.hp.pct'] = newPct;
      }
    }
    for (const deb of debuffsToCleanse) {
      const c = await actor.cleanseDebuff(deb);
      cleansedDebuffs.push(...c);
    }
  }

  return {
    hasHealing: true,
    hpPerBar,
    barsToHeal,
    maxHealAmount: barsToHeal * hpPerBar,
    actualHealed,
    currentHp,
    newHp,
    maxHp,
    newPct,
    target: isSelfTarget ? 'self' : (targetFilter || 'allies'),
    isSelfTarget,
    isHoT,
    hotRounds,
    debuffsToCleanse,
    cleansedDebuffs
  };
}

/**
 * Mana is paid (or the Rule Break confirmed): the light comes on (3.16c), the aura starts, and temporary bars are
 * granted, in that order.
 * @param {Actor} actor
 * @param {Item} spell
 * @param {{ isAura: boolean, isSelfLight: boolean }} gates
 * @returns {Promise<{ auraData: object|null, nonAuraTempBars: object|null }>}
 */
export async function applySpellCastEffects(actor, spell, { isAura, isSelfLight }) {
  const sys = spell.system || {};
  if (isSelfLight) await igniteLight(actor, spell);

  let auraData = null;
  if (isAura) {
    auraData = await actor.activateAura(spell);
  }

  let nonAuraTempBars = null;
  const hasTempBars = Boolean(sys.tempBars?.hasTempBars);
  if (hasTempBars && !isAura) {
    const spellRank = Math.max(Number(sys.modifiedRank) || 0, Number(sys.rank) || 0, 1);
    const resolvedBreaks = resolveReachedRankBreaks(spell, spellRank);
    nonAuraTempBars = await grantItemTempBars(actor, spell, resolvedBreaks);
  }
  return { auraData, nonAuraTempBars };
}

/**
 * The conditions the cast inflicts: Targeted or Burst Area spells apply them to in-range targets at the cast.
 * @param {Actor} actor
 * @param {Item} spell
 * @param {object} opts
 * @param {{ isAura: boolean, castRange: object }} gates
 * @returns {Promise<{ offersAttack: boolean, conditionTags: string[], isBurstOrArea: boolean, conditionRounds: *, appliedConditionTargets: object[], pendingConditions: object[], conditionTargetUuids: string[] }>}
 */
export async function applySpellCastConditions(actor, spell, opts, { isAura, castRange }) {
  const sys = spell.system || {};
  const spellTags = spell.allTags || getItemAllTags(spell);
  // An attack spell's cast card offers the attack roll; its conditions come with the hit (3.47).
  const offersAttack = offersSpellAttack(spell);

  // Evaluate condition tags to inflict (Targeted or Burst Area)
  const conditionTags = actor.getItemInflictedConditions(spell, { isCrit: opts.isCrit === true });
  if (opts.conditionTag) conditionTags.push(opts.conditionTag);
  if (Array.isArray(opts.conditionTags)) {
    for (const ct of opts.conditionTags) {
      if (ct && !conditionTags.includes(ct)) conditionTags.push(ct);
    }
  }

  const isBurstOrArea = Boolean(
    (sys.area?.hasArea && !isAura) ||
    (sys.delivery === 'burst') ||
    (isAreaTagSet(spellTags) && (Number(sys.area?.radius) > 0 || Number(sys.area?.lineLength) > 0)) ||
    opts.isBurst
  );
  const appliedConditionTargets = [];
  const pendingConditions = [];
  let conditionTargetUuids = [];
  // A reached duration bonus makes the spell's conditions last (structured rounds + bonus) combat rounds (Q-B3).
  const conditionRounds = rankBreakConditionRounds(spell);

  // An aura never applies its debuffs at the cast: the Step 5 pulse stamps them (3.40 d). An attack spell's hit card applies them (3.47).
  if (!isAura && !offersAttack && conditionTags.length > 0 && opts.applyConditions !== false && opts.applyDebuffs !== false) {
    const targets = actor.resolveActionTargets(spell, opts).filter(t => !findOutOfRange(castRange.outOfRange, {
      uuid: (t.actor ?? t)?.uuid ?? null, actorId: (t.actor ?? t)?.id ?? null, tokenId: t.actor ? (t.id ?? t.document?.id ?? null) : null
    }));
    conditionTargetUuids = targets.filter(t => !spellSkipsCaster(actor, spell, t.actor ?? t, isBurstOrArea)).map(t => (t.actor ?? t)?.uuid).filter(Boolean);
    appliedConditionTargets.push(...await applySpellConditions(actor, spell, targets, { conditionTags, isBurstOrArea, conditionRounds, pending: pendingConditions }));
  }
  return { offersAttack, conditionTags, isBurstOrArea, conditionRounds, appliedConditionTargets, pendingConditions, conditionTargetUuids };
}

/**
 * Record the cast in the session log. Synchronous: the write is fire-and-forget and its failure is ignored.
 * @param {Actor} actor
 * @param {Item} spell
 * @param {{ isFreeCast: boolean, manaCost: number }} cost
 * @param {object|null} healInfo
 */
export function recordSpellCast(actor, spell, cost, healInfo) {
  const freeCastSuffix = cost.isFreeCast ? ' [0 MP Free Cast / Item Effect]' : '';
  COGSessionEngine.recordRoll({
    actor,
    roll: { total: 0, formula: cost.manaCost > 0 ? `${cost.manaCost} MP` : '0 MP' },
    type: 'spell',
    name: spell.name,
    notes: healInfo
      ? `Cast Heal (+${healInfo.actualHealed} HP to self, ${healInfo.newHp}/${healInfo.maxHp} HP)${freeCastSuffix}`
      : `Cast ${spell.name} (${cost.manaCost} MP)${freeCastSuffix}`
  }).catch(() => {});
}
