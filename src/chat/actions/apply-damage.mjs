/**
 * "Apply Damage to Target(s)" chat button.
 */
import { COGDamage } from '../../documents/actor/damage-pipeline.mjs';
import { getTagDefinition } from '../../data/tag-definitions.mjs';
import { elementToDamageType } from '../../data/tag-vocabulary.mjs';
import { parseRollContext } from '../../utils/roll/roll-context.mjs';
import { parseCardParts } from '../../utils/damage/damage-parts.mjs';
import { parseTargetRows, targetRowsFor } from '../../utils/damage/per-target-damage.mjs';
import { resolveActorByUuid, findTokenByActorUuid, isSameActor } from '../../utils/actor-uuid.mjs';
import { clickTargetsOf } from '../../utils/roll/scalars.mjs';
import { getActiveGM } from '../../utils/gm-relay.mjs';
import { applyCardEffect, canWriteTarget, registerChatApplier, messageAuthorId } from '../chat-relay.mjs';
import { multiplierOf } from '../../utils/damage/per-target-damage.mjs';
import { findEvadeFor } from '../../utils/attack/evade-link.mjs';
import { findInterceptionFor } from '../../utils/combat/interrupts.mjs';
import { tokensInCardArea } from './area-membership.mjs';
import { postReflectOffers } from './apply-reflect.mjs';
import { newApplicationId, setDamageUndoInflictedItems } from '../../utils/damage/damage-undo.mjs';
import { indexDamageApplication } from '../damage-applications.mjs';
import { appliedEffectLine } from '../../utils/item-describer/card-summary.mjs';
import { amazingSuccessFor, asTriggerConditionRefs, parseAsTriggers } from '../../utils/roll/amazing-success.mjs';
import { getCurrentFloor } from '../../utils/floor/current-floor.mjs';
import { parseOnHitCard } from '../../utils/attack/on-hit.mjs';
import { evadeFailDegree, meetsEvadeGate } from '../../utils/attack/evade-degrees.mjs';
import { conditionLabel } from '../../documents/actor/condition-data.mjs';
import { addDispelEntry } from '../../utils/effects/dispel.mjs';
import { isOutOfRangeOnMessage, rangeText } from '../../utils/attack/attack-range.mjs';
import { escapeAttr } from '../../utils/escape-attr.mjs';

/** The Amazing Success mode of a clicked button (E6.9 D6): `auto` (absent), `force` or `off`. */
function amazingModeOf(raw) {
  const mode = typeof raw === 'string' ? raw.trim() : '';
  return mode === 'force' || mode === 'off' ? mode : 'auto';
}

/** A JSON array from a data attribute (string, or already parsed); [] when absent or malformed. */
function readJsonArray(raw) {
  if (!raw) return [];
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

/**
 * Read the damage card and button into plain params. Pure: runs on the clicker and on the GM's copy.
 * @param {HTMLElement} button the [data-action] element
 * @returns {object|null} null when the button is not inside a damage card
 */
export function parseApplyDamage(button) {
  const card = button.closest('.cog-damage-card') || button.closest('.cog-chat-card');
  if (!card) return null;

  const rawTyped = card.dataset?.typedDamage;
  let typedDamage = null;
  if (rawTyped) {
    try {
      typedDamage = typeof rawTyped === 'string' ? JSON.parse(rawTyped) : rawTyped;
    } catch (_) {}
  }

  // Per-part amounts (with their rolled bases, so each target can recompute them), the card's target rows, and the
  // attack's context in `data-roll-context`: the target's conditional defenseModifiers resolve against it.
  // Only a Critical Hit button counts the card's extra Critical Hit dice parts.
  const isCrit = button.dataset?.crit === 'true' || button.dataset?.crit === true;
  const damageParts = parseCardParts(card.dataset?.damageParts, { crit: isCrit });
  const targetRows = targetRowsFor({ targetRows: parseTargetRows(card.dataset?.targetRows) });
  const rollContext = parseRollContext(card.dataset?.rollContext);

  const conditionTags = [];
  const rawConditionTags = button.dataset?.conditionTags || card?.dataset?.conditionTags;
  if (rawConditionTags) {
    try {
      const parsed = typeof rawConditionTags === 'string' ? JSON.parse(rawConditionTags) : rawConditionTags;
      if (Array.isArray(parsed)) conditionTags.push(...parsed);
      else if (parsed) conditionTags.push(parsed);
    } catch (_) {
      if (typeof rawConditionTags === 'string') conditionTags.push(...rawConditionTags.split(',').map(s => s.trim()).filter(Boolean));
    }
  }
  const singleCondition = button.dataset?.conditionTag || button.dataset?.conditionName || button.dataset?.inflictDebuff || card?.dataset?.inflictDebuff;
  if (singleCondition && !conditionTags.includes(singleCondition)) {
    conditionTags.push(singleCondition);
  }
  // Only a Critical Hit apply inflicts the crit-only debuffs; the normal button never does.
  const critDebuffs = isCrit ? readJsonArray(card?.dataset?.critDebuffs).filter(d => typeof d === 'string' && d) : [];
  for (const d of critDebuffs) if (!conditionTags.includes(d)) conditionTags.push(d);
  const rawDebuffs = card?.dataset?.debuffs;
  if (rawDebuffs) {
    try {
      const parsed = typeof rawDebuffs === 'string' ? JSON.parse(rawDebuffs) : rawDebuffs;
      if (Array.isArray(parsed)) {
        for (const d of parsed) if (!conditionTags.includes(d)) conditionTags.push(d);
      }
    } catch (_) {}
  }

  const onHit = parseOnHitCard(card.dataset);

  return {
    itemName: card.dataset?.itemName || 'Attack',
    attackType: card.dataset?.attackType || 'attack',
    rawDamage: Number(card.dataset?.damageValue) || 0,
    multiplier: multiplierOf(button.dataset?.multiplier),
    ignoreDR: Boolean(
      button.dataset?.ignoreDr === 'true' ||
      button.dataset?.ignoreDr === true ||
      card.dataset?.isArmorPiercing === 'true' ||
      card.dataset?.isArmorPiercing === true
    ),
    attackerUuid: card.dataset?.attackerUuid,
    typedDamage,
    damageParts,
    targetRows,
    rollContext,
    isCrit,
    damageType: card.dataset?.damageType || '',
    conditionTags,
    lifesteal: onHit.lifesteal,
    dispel: onHit.dispel,
    debuffPick: onHit.debuffPick,
    evadeFailDebuffs: onHit.evadeFail,
    slotLossDebuffs: onHit.slotLoss,
    sourceMessageId: typeof card.dataset?.sourceMessageId === 'string' && card.dataset.sourceMessageId ? card.dataset.sourceMessageId : null,
    ignoreEvade: button.dataset?.evade === 'ignore',
    asTriggers: parseAsTriggers(card.dataset?.asTriggers),
    amazingMode: amazingModeOf(button.dataset?.amazing),
    fallbackTargetUuid: button.dataset?.targetUuid || card.dataset?.targetUuid
  };
}

/**
 * One click's batch with its identity tags captured once, before the first write (E3.5, A13): a debuff the card puts on
 * target 1 must not change target 2's count. Keyed by the `ctx.targets` array, which is the same for every call of a batch.
 */
const clickBatches = new WeakMap();
function clickBatchOf(targets) {
  if (!Array.isArray(targets) || !targets.length) return null;
  if (!clickBatches.has(targets)) clickBatches.set(targets, clickTargetsOf(targets));
  return clickBatches.get(targets);
}

/**
 * An Evade message counts only when its author is the GM or owns the evader, and the evader resolves: a player can fake
 * an Evade only for an actor they could roll a real one for (E6.3).
 */
export function isTrustedEvade(message, record) {
  const evader = resolveActorByUuid(record.evaderUuid);
  if (!evader) return false;
  const author = game.users?.get?.(messageAuthorId(message));
  if (!author) return false;
  return Boolean(author.isGM) || Boolean(evader.testUserPermission?.(author, 'OWNER'));
}

/**
 * An interception card counts only when its author is the GM or owns the interrupter: a player can claim a Catcher's DR only for
 * an actor they own (the same rule as `isTrustedEvade`).
 */
function isTrustedInterception(message, record) {
  const interrupter = resolveActorByUuid(record.interrupterUuid);
  if (!interrupter) return false;
  const author = game.users?.get?.(messageAuthorId(message));
  if (!author) return false;
  return Boolean(author.isGM) || Boolean(interrupter.testUserPermission?.(author, 'OWNER'));
}

/**
 * This target's Amazing Success for the click (E6.9 D3/D6): none on a Critical Hit click or mode `off`; every target in
 * mode `force` (the source card's Floor, else the current one); otherwise the source attack card's record judges the target.
 * @returns {{ floorBonus: number, triggers: object[], forced: boolean }|null}
 */
function amazingFor(targetActor, params) {
  const mode = params.amazingMode ?? 'auto';
  if (params.isCrit || mode === 'off') return null;
  const source = params.sourceMessageId ? game.messages?.get?.(params.sourceMessageId) ?? null : null;
  const triggers = params.asTriggers ?? [];
  if (mode === 'force') {
    const floor = source ? amazingSuccessFor(source, targetActor).floor : null;
    return { floorBonus: floor ?? getCurrentFloor(), triggers, forced: true };
  }
  if (!source) return null;
  const as = amazingSuccessFor(source, targetActor);
  return as.amazing ? { floorBonus: as.floor ?? getCurrentFloor(), triggers, forced: false } : null;
}

/**
 * The lifesteal and dispel of the card's On Hit block, after the final damage is known (3.13-2). Neither happens to a
 * fully evaded target or to a hit that dealt nothing after DR and resistance. Runs on the writing client: with a GM
 * connected that is the GM, who may write the unowned attacker; otherwise `canApplyDamageLocally` has checked it.
 * @returns {Promise<{ lifesteal: { slots: number, healed: number, attackerName: string, skipped: boolean }|null,
 *   dispelled: Array<{ source: string, count: number }> }>}
 */
async function applyOnHitRiders({ targetActor, attacker, params, res, evaded }) {
  const none = { lifesteal: null, dispelled: [] };
  if (evaded || !res || res.error || !(Number(res.damageAfterDR) > 0)) return none;

  let lifesteal = null;
  const slotsLost = Number(res.slotsLost) || 0;
  const slots = (params.lifesteal ?? []).reduce((sum, e) => sum + (slotsLost >= e.minSlotsLost ? e.heal : 0), 0);
  if (slots > 0 && attacker && typeof attacker.applyHealingBars === 'function') {
    lifesteal = { slots, healed: 0, attackerName: attacker.name, skipped: false };
    if (game.user?.isGM || canWriteTarget(attacker)) {
      const healed = await attacker.applyHealingBars(slots);
      lifesteal.healed = healed?.actualHealed ?? 0;
    } else {
      lifesteal.skipped = true;
    }
  }

  const dispelled = [];
  for (const d of (params.dispel ?? [])) {
    await addDispelEntry(targetActor, {
      source: d.label || params.itemName, sourceUuid: params.attackerUuid ?? '', applicationId: res.applicationId,
      combatId: game.combat?.id ?? '', count: d.count, query: d.query
    });
    dispelled.push({ source: d.label || params.itemName, count: d.count });
  }
  return { lifesteal, dispelled };
}

/** The Life Drain heal as a breakdown line for the card's damage-application row (empty when there was no lifesteal). */
export function lifestealLines(lifesteal) {
  if (!lifesteal) return [];
  const plural = lifesteal.slots === 1 ? '' : 's';
  const text = lifesteal.skipped
    ? `Life Drain: heal ${lifesteal.attackerName} ${lifesteal.slots} slot${plural} by hand`
    : `Life Drain: ${lifesteal.attackerName} +${lifesteal.slots} slot${plural}`;
  return [{ stage: 'heal', text }];
}

/**
 * Ask which of a `pickOne` rider's debuffs to apply to this target (DialogV2.wait with one button per choice, the
 * pattern the Evade crawler and target pickers use). Runs on the client that applies. A single ref needs no prompt.
 * @param {string[]} refs
 * @param {{ title?: string, target?: string }} [ctx]
 * @returns {Promise<string|null>} the chosen ref, or null on Cancel or a closed window (nothing is applied)
 */
export async function chooseOneDebuff(refs, { title = '', target = '' } = {}) {
  if (!Array.isArray(refs) || !refs.length) return null;
  if (refs.length === 1) return refs[0];
  const DialogV2 = globalThis.foundry?.applications?.api?.DialogV2;
  if (typeof DialogV2?.wait !== 'function') return null;
  const who = target ? ` on ${escapeAttr(target)}` : '';
  const picked = await DialogV2.wait({
    window: { title: title || 'Choose a debuff' },
    content: `<p>Choose the debuff to inflict${who}.</p>`,
    buttons: [
      ...refs.map((ref, i) => ({ action: `pick${i}`, label: conditionLabel(ref) })),
      { action: 'cancel', label: 'Cancel' }
    ],
    rejectClose: false
  });
  const match = typeof picked === 'string' ? /^pick(\d+)$/.exec(picked) : null;
  return match ? refs[Number(match[1])] ?? null : null;
}

/** The refs to apply from gated entries: every `all` entry, and one prompted choice per `pickOne` group. */
async function resolvePicks(entries, targetActor, params) {
  const refs = [];
  const groups = new Map();
  for (const e of entries) {
    if (e.mode === 'pickOne' && e.group) {
      if (!groups.has(e.group)) groups.set(e.group, []);
      groups.get(e.group).push(e.ref);
    } else if (!refs.includes(e.ref)) {
      refs.push(e.ref);
    }
  }
  for (const list of groups.values()) {
    const ref = await chooseOneDebuff(list, { title: params.itemName, target: targetActor.name });
    if (ref && !refs.includes(ref)) refs.push(ref);
  }
  return refs;
}

/** Apply the parsed damage (and any condition tags) to one target. Runs on whichever client writes. */
export async function applyDamageTo(targetActor, params, ctx) {
  const attacker = resolveActorByUuid(params.attackerUuid);
  // A target the attack card marked out of range (3.48-8, not confirmed as a Rule Break) is not hit: no damage, rider or save.
  const sourceCard = params.sourceMessageId ? game.messages?.get?.(params.sourceMessageId) ?? null : null;
  if (sourceCard && isOutOfRangeOnMessage(sourceCard, targetActor, targetActor.token?.id ?? null)) {
    return { skipped: 'out-of-range', targetUuid: targetActor.uuid, targetName: targetActor.name, actualDamage: 0, conditions: [], inflictedItemIds: [] };
  }
  // This target's Evade for the attack the card answers, read from the writing client's chat log (E6.3).
  const link = params.sourceMessageId
    ? findEvadeFor(game.messages, { attackMessageId: params.sourceMessageId, targetUuid: targetActor.uuid, isTrusted: isTrustedEvade })
    : null;
  const evade = link ? { ...link, ignored: Boolean(params.ignoreEvade) } : null;
  const amazing = amazingFor(targetActor, params);
  // What this target's interrupt to this one attack adds (Catcher): +N DR and no rider debuffs. Found by the attack message
  // and the interrupter, so the next attack gets nothing.
  const interception = params.sourceMessageId
    ? findInterceptionFor(game.messages, { attackMessageId: params.sourceMessageId, interrupterUuid: targetActor.uuid, isTrusted: isTrustedInterception })
    : null;
  const res = await COGDamage.applyDamageToTarget({
    targetActor,
    rawDamage: params.rawDamage,
    typedDamage: params.typedDamage,
    parts: params.damageParts,
    rollContext: params.rollContext,
    isCrit: params.isCrit,
    targetRows: params.targetRows,
    clickTargets: clickBatchOf(ctx?.targets),
    damageType: params.damageType,
    attackerActor: attacker,
    attackName: params.itemName,
    attackType: params.attackType,
    ignoreDR: params.ignoreDR,
    multiplier: params.multiplier,
    evade,
    amazing,
    extraDr: interception?.drBonus ?? 0,
    extraDrLabel: interception?.name ?? '',
    intercepting: Boolean(interception),
    applicationId: newApplicationId(),
    messageId: ctx?.message?.id ?? null
  });

  const inflictedItemIds = [];
  const appliedEffects = [];
  const prevItemIds = new Set(Array.from(targetActor.items || []).map(i => i.id || i._id).filter(Boolean));
  // A fully evaded target takes no on-hit conditions (the book's Step 3); Ignore Evade applies them.
  const evaded = Boolean(evade && !evade.ignored && evade.multiplier === 0);
  // An interrupt with `ignoreDebuffs` (Catcher Rank 15) takes the hit without the debuffs attached to it.
  const ignoreRiders = interception?.ignoreDebuffs === true;
  // An Amazing Success's debuff triggers (E6.9 D9) go through the same loop for this target alone, after the card-wide
  // conditions; a crit click or a mode of `off` leaves `amazing` null, and a full Evade skips them like any on-hit debuff.
  const asRefs = amazing ? asTriggerConditionRefs(amazing.triggers).filter(ref => !(params.conditionTags || []).includes(ref)) : [];
  for (const cTag of (evaded || ignoreRiders ? [] : [...(params.conditionTags || []), ...asRefs])) {
    let created = null;
    if (typeof targetActor.applyCondition === 'function') {
      created = await targetActor.applyCondition(cTag, { source: params.itemName });
    } else if (typeof targetActor.applyDebuff === 'function') {
      created = await targetActor.applyDebuff(cTag, { source: params.itemName });
    }
    const createdId = created?.id || created?._id;
    if (createdId && !prevItemIds.has(createdId) && !inflictedItemIds.includes(createdId)) {
      inflictedItemIds.push(createdId);
    }
  }
  // The On Hit block's other lists (3.48-4a). Each ref lands once per target and is recorded for undo. A fully evaded
  // target or one whose interrupt ignores riders takes none. `pickOne` lists ask once per target on this client.
  if (!evaded && !ignoreRiders) {
    const anyHit = [];
    for (const pick of (params.debuffPick ?? [])) {
      const ref = await chooseOneDebuff(pick.refs, { title: pick.label || params.itemName, target: targetActor.name });
      if (ref) anyHit.push(ref);
    }
    // Evade-gated: this target's own Evade degree (no record, or Ignore Evade, is a plain fail).
    const degree = evadeFailDegree(evade);
    const gated = (params.evadeFailDebuffs ?? []).filter(e => meetsEvadeGate(degree, e.degree));
    // Slot loss: only when the hit removed at least `minSlotsLost` Health Bar slots from this target.
    const lost = res && !res.error ? Number(res.slotsLost) || 0 : 0;
    const slotLoss = (params.slotLossDebuffs ?? []).filter(e => lost >= e.minSlotsLost);
    const refs = [...anyHit, ...await resolvePicks(gated, targetActor, params), ...await resolvePicks(slotLoss, targetActor, params)];
    for (const ref of refs) {
      const created = typeof targetActor.applyCondition === 'function'
        ? await targetActor.applyCondition(ref, { source: params.itemName })
        : await targetActor.applyDebuff?.(ref, { source: params.itemName });
      const createdId = created?.id || created?._id;
      if (createdId && !prevItemIds.has(createdId) && !inflictedItemIds.includes(createdId)) inflictedItemIds.push(createdId);
      // These land with no card text of their own (the target's Evade or the slots lost decide them): say what landed (3.71 B6)
      if (created) appliedEffects.push({ stage: 'effect', text: await appliedEffectLine(ref) });
    }
  }

  const { lifesteal, dispelled } = await applyOnHitRiders({ targetActor, attacker, params, res, evaded });

  if (inflictedItemIds.length > 0 && res?.applicationId) {
    await setDamageUndoInflictedItems(targetActor, res.applicationId, inflictedItemIds);
  }

  if (res?.applicationId && !res.error) {
    await indexDamageApplication(ctx?.message, {
      applicationId: res.applicationId,
      targetUuid: targetActor.uuid,
      targetName: res.targetName ?? targetActor.name,
      actualDamage: res.actualDamage,
      lines: [...(res.perTarget?.lines ?? []), ...lifestealLines(lifesteal), ...appliedEffects]
    });
  }
  // Damage Reflection: the holder's player is offered the reflection; nothing is written to the attacker until they accept.
  if (res?.reflections?.length && !res.error) {
    try {
      await postReflectOffers({ holder: targetActor, attacker, reflections: res.reflections, applicationId: res.applicationId });
    } catch (err) {
      console.error('Sprinter RPG | Could not post the Damage Reflection offer:', err);
    }
  }
  return {
    ...res, applicationId: res?.applicationId, targetUuid: targetActor.uuid,
    targetName: res?.targetName ?? targetActor.name, conditions: [...params.conditionTags],
    inflictedItemIds, lifesteal, dispelled
  };
}

/**
 * Damage also writes the Combat metrics flag, the session ledger and kill trophies, which a player cannot
 * write. With a GM connected the GM applies all player damage so one client does the whole application.
 */
function canApplyDamageLocally(target, params) {
  const user = game.user;
  if (!user || user.isGM) return true;
  if (getActiveGM()) return false;
  const attacker = resolveActorByUuid(params.attackerUuid);
  return canWriteTarget(target) && (!attacker || canWriteTarget(attacker));
}

registerChatApplier('crawlerApplyDamage', { parse: parseApplyDamage, apply: applyDamageTo, canApplyLocally: canApplyDamageLocally });

/**
 * @param {Event} event
 * @param {HTMLElement} button the [data-action] element
 * @param {ChatMessage} message
 */
export async function handleApplyDamage(event, button, message) {
  const card = button.closest('.cog-damage-card') || button.closest('.cog-chat-card');
  const params = parseApplyDamage(button);
  if (!card || !params) return;

  const attacker = resolveActorByUuid(params.attackerUuid);

  let targetTokens = Array.from(game.user?.targets || []);
  // No targets of the user's own: whoever stands in the area this card placed, read now (E2.2).
  if (!targetTokens.length) targetTokens = tokensInCardArea(message, card);
  if (!targetTokens.length && canvas?.tokens) {
    targetTokens = canvas.tokens.controlled.filter(t => t.actor && !isSameActor(t.actor, attacker));
    // A player with nothing targeted would silently hit their own selected token; ask first. The GM path is unchanged.
    if (targetTokens.length && !game.user?.isGM) {
      const apply = await foundry.applications.api.DialogV2.confirm({
        window: { title: 'No Target' },
        content: '<p>No target. Apply to your own token?</p>',
        rejectClose: false
      });
      if (!apply) return;
    }
  }
  if (!targetTokens.length) {
    if (params.fallbackTargetUuid && canvas?.tokens?.placeables) {
      const found = findTokenByActorUuid(canvas.tokens.placeables, params.fallbackTargetUuid);
      if (found) targetTokens = [found];
    }
  }

  if (!targetTokens.length) {
    ui.notifications?.warn('Sprinter RPG | No targets selected! Please target or select at least one token on the canvas.');
    return;
  }

  const targetActors = targetTokens.map(t => t.actor).filter(Boolean);
  const { results } = await applyCardEffect('crawlerApplyDamage', { message, button, params, targets: targetActors });
  if (!results.length) return;

  const conditionTagsToApply = params.conditionTags;
  const applied = results.filter(r => r.skipped !== 'out-of-range');
  const summary = results.map(r => {
    if (r.skipped === 'out-of-range') return `<strong>${r.targetName}</strong>: ${rangeText('COG.AttackRange.Badge').toLowerCase()}, not hit`;
    let text = `<strong>${r.targetName}</strong>: ${r.actualDamage} net dmg`;
    if (r.tempBarsDamage > 0) {
      const only = r.tempBarsElement ? ` (${elementToDamageType(r.tempBarsElement) || r.tempBarsElement} only)` : '';
      text += ` (${r.tempBarsDamage} absorbed by bonus bars${only}, ${r.tempBarsRemaining ?? 0} bonus bars left)`;
    }
    if (r.tempBarsPassed > 0) {
      text += ` (${r.tempBarsPassed} of other damage passed the ${elementToDamageType(r.tempBarsElement) || 'element'}-only bonus bars)`;
    }
    text += ` (${r.barsRemoved ?? 0} regular bar${r.barsRemoved === 1 ? '' : 's'}, ${r.newHp} HP left`;
    if (r.excessDamage > 0) {
      text += `, ${r.excessDamage} excess ignored`;
    }
    text += ')';
    if (r.dying) text += r.dying.died ? ' (Dying: the countdown ran out)' : ` (Dying: ${r.dying.remaining} round${r.dying.remaining === 1 ? '' : 's'} left)`;
    if (r.lifesteal) {
      text += r.lifesteal.skipped
        ? ` (Life Drain: heal ${r.lifesteal.attackerName} ${r.lifesteal.slots} slot${r.lifesteal.slots === 1 ? '' : 's'} by hand)`
        : ` (Life Drain: ${r.lifesteal.attackerName} +${r.lifesteal.slots} slot${r.lifesteal.slots === 1 ? '' : 's'})`;
    }
    if (r.dispelled?.length) text += ` (Buffs dispelled${r.dispelled.some(d => d.count > 0) ? ` (${r.dispelled.reduce((n, d) => n + d.count, 0)})` : ''} until the combat ends)`;
    const notes = (r.perTarget?.lines ?? []).filter(l => l.stage === 'attacker' || l.stage === 'crit').map(l => l.text);
    if (notes.length) text += ` (${notes.join(', ')})`;
    return text;
  }).join(', ');
  const conditionNote = conditionTagsToApply.length > 0 ? ` and inflicted [${conditionTagsToApply.map(c => getTagDefinition(c)?.label || c).join(', ')}]` : '';
  ui.notifications?.info(`Sprinter RPG | Damage applied${conditionNote}: ${summary}`);

  card.querySelectorAll('.cog-damage-applied-feedback').forEach(el => el.remove());

  const feedbackHtml = `
        <div class="cog-damage-applied-feedback cog-bg-success-tint cog-text-success" style="margin-top: 6px; font-size: 11px; border: 1px solid var(--cog-success); padding: 4px 6px; border-radius: 3px; font-family: 'Oswald', sans-serif;">
          <i class="fa-solid fa-check"></i> Applied to ${applied.length} target(s). Logged to combat!
        </div>
      `;
  card.insertAdjacentHTML('beforeend', feedbackHtml);
}
