import { cardSummary, CARD_PROFILES } from '../../utils/item-describer/card-summary.mjs';
import { cardMessageOptions } from '../../utils/card/chat-mode.mjs';
import { escapeAttr, trustedHtml } from '../../utils/escape-attr.mjs';
import { outcomeWeight, outcomeWeightTotal } from '../../utils/loot/outcome-weights.mjs';
import { ENCHANT_ITEM_OUTCOME, RECHARGE_OUTCOME } from '../../utils/loot/outcome-defaults.mjs';
import { pickOwnedItem } from './item-pick.mjs';
import { pickRechargeTarget } from './recharge.mjs';
import { withFlags } from '../../utils/flags.mjs';
import { isScratchLootType } from '../../models/items/loot-model.mjs';
import { itemUsage, usageLabel } from '../../utils/tag/tag-mechanics.mjs';
import { confirmRuleBreak, RULE_BREAK_REFUSALS } from '../../utils/rule-break.mjs';
import { spendConsumableUnit } from '../actor/used-items.mjs';
import { ruleBreakBadgeHtml } from '../../utils/rule-break-visibility.mjs';
import { emitsLight, igniteLight } from '../actor/light-source.mjs';
import { cooldownLabel, hasCooldown } from '../../utils/time/cooldowns.mjs';
import { gateItemCooldown } from '../actor/cooldown-gate.mjs';
import { lifetimeKindsOf } from '../../data/rules/potion-rules.mjs';
import { gatePotionUse, askPotionRecipient, POTION_GATE_CLEAR } from './potion-gate.mjs';
import { gateActionBlock, actionBlockApplies, ACTION_BLOCK_CLEAR } from '../actor/action-block.mjs';
import { gateZeroZone, zeroZoneApplies, ZERO_ZONE_CLEAR } from '../actor/zero-zone-gate.mjs';
import { isActivatedGearAura, toggleGearAura } from '../actor/gear-aura.mjs';
import { resolveSingleOutcome, enchantWasRefused, outcomeCardSummary } from './resolve-outcome.mjs';
import { addKnownDeity } from '../actor/worship.mjs';
import { deityRecords } from '../../utils/deity/deity-names.mjs';
import { deityIdOf } from '../../utils/deity/worship-state.mjs';
import { say } from '../actor/vehicle-drive-common.mjs';
import { spellByIdentifier } from './spell-tome.mjs';
import { spendActivationUses } from '../actor/buff-activation.mjs';
import { rollSpellCard } from './spell-card.mjs';
import { isBoxTemplate } from '../actor/gm-only-items.mjs';
import { langText } from '../../utils/lang-text.mjs';

const WASTED_SCROLL_TEXT = '{name} read {item} with nothing equipped. The dumbass has wasted a valuable scroll. No reward. We do not encourage this behavior.';

/** The wasted-scroll line (lang `COG.Craft.WastedScroll`, with a built-in fallback when lang is not loaded). */
function wastedScrollText(name, item) {
  const i18n = globalThis.game?.i18n;
  if (i18n?.has?.('COG.Craft.WastedScroll') && typeof i18n.format === 'function') return i18n.format('COG.Craft.WastedScroll', { name, item });
  return WASTED_SCROLL_TEXT.replace('{name}', name).replace('{item}', item);
}

/** Why a box template item does not open, with the English default when the lang file is not loaded. */
const useText = langText(Object.freeze({
  'COG.LootBoxHeld.TemplateUse': "Loot boxes open from a crawler's Loot Boxes strip. This item is a box template."
}));

/**
 * Use a loot / consumable item (e.g. Normal Mana Potion, healing items, scratch-off lottery tickets, wands, scrolls)
 * or activate gear with on-use effects.
 * Refills resources, decrements uses/charges, checks scene limits, resolves outcome tables, and outputs rich chat cards.
 * @param {Item} item
 * @param {object} options
 * @returns {Promise<ChatMessage|object>}
 */
export async function useItem(item, options = {}) {
  const actor = item.actor;
  const sys = item.system || {};
  const itemName = item.name || 'Item';

  // A box item is a template, not a box anyone holds: held boxes are a crawler's entries, opened from its strip.
  if (isBoxTemplate(item)) {
    const message = useText('COG.LootBoxHeld.TemplateUse');
    globalThis.ui?.notifications?.info?.(message);
    return { error: 'box_template', message };
  }

  // A bearer who cannot take Actions asks first, so a declined gate asks nothing else.
  const actionBlockGate = actionBlockApplies(actor, 'item', options) ? await gateActionBlock(actor, 'item', { options }) : ACTION_BLOCK_CLEAR;
  if (!actionBlockGate.proceed) return { error: 'action_block_cancelled', message: `"${itemName}" was not used.` };

  // In a zero zone a player's crawler has no working interface: any use (loot box, gear aura, potion, scroll) asks first.
  const zeroZoneGate = actor && zeroZoneApplies(actor, options) ? await gateZeroZone(actor, item, { verb: 'Use', options }) : ZERO_ZONE_CLEAR;
  if (!zeroZoneGate.proceed) return { error: 'zero_zone_cancelled', message: `"${itemName}" was not used.` };

  // Activated gear that emits an aura: using it switches the aura on, using it again switches it off (3.17-6).
  // Gear that also has outcomes goes on to resolve them when it switches on; the aura alone costs nothing.
  if (actor && isActivatedGearAura(item)) {
    const wasActive = Boolean(sys.active);
    await toggleGearAura(item);
    if (wasActive || !(sys.outcomes?.length > 0)) {
      return ChatMessage.create(withFlags({
        speaker: ChatMessage.getSpeaker({ actor }),
        content: `<div class="cog-chat-card cog-item-card cog-aura-toggle"><strong>${escapeAttr(actor.name)}</strong> ${wasActive ? 'switched off' : 'switched on'} <strong>${escapeAttr(itemName)}</strong>.</div>`
      }, { isAuraToggle: true, auraItem: item.id, auraActive: !wasActive, ...zeroZoneGate.flags }), cardMessageOptions(actor));
    }
  }
  const lootType = String(sys.lootType || '').toLowerCase().trim();
  const isScratch = isScratchLootType(lootType);

  // 2. Uses / Charges / Quantity Check. The usage tag decides what a use spends (itemUsage); a used-up item is a
  // Rule Break, never a refusal (core directive 2).
  const usage = itemUsage(item);
  const hasCharges = Boolean(
    (lootType === 'wand' || sys.usesCharges || sys.hasCharges || (sys.charges && Number(sys.charges.max) > 0 && !isScratch)) &&
    sys.charges && Number(sys.charges.max) > 0
  );
  const currentCharges = hasCharges ? (Number(sys.charges.value) || 0) : 0;
  const rawQty = Number(sys.quantity);
  const currentQty = (sys.quantity === undefined || sys.quantity === null || !Number.isFinite(rawQty)) ? 1 : rawQty;
  // Only a consumable without charges spends quantity; a reusable or rechargeable item never touches it.
  const spendsQuantity = usage === 'consumable' && !hasCharges;

  // 2a. A scroll or wand that names a spell the actor cannot resolve is refused and kept: no generic card, nothing consumed (3.40 o4).
  if (sys.spellIdentifier && !(Array.isArray(sys.outcomes) && sys.outcomes.length > 0) && !spellByIdentifier(actor, sys.spellIdentifier)) {
    const msg = `"${itemName}" names a spell that could not be found ("${sys.spellIdentifier}"). It was not used.`;
    if (typeof ui !== 'undefined' && ui.notifications?.warn) ui.notifications.warn(msg);
    return { error: 'spell_not_found', message: msg };
  }

  // 2a'. A scroll of prayer names a god (p. 163): reading it teaches the reader that god. An unknown god keeps the scroll.
  const prayerId = actor ? String(sys.deity ?? '').trim() : '';
  const prayerDeity = prayerId ? deityRecords().find((d) => deityIdOf(d) === prayerId) ?? null : null;
  if (prayerId && !prayerDeity) {
    const msg = say('COG.Deity.Obligations.ScrollUnknown', '{item} names a god that could not be found ("{id}"). It was not used.', { item: itemName, id: prayerId });
    if (typeof ui !== 'undefined' && ui.notifications?.warn) ui.notifications.warn(msg);
    return { error: 'deity_not_found', message: msg };
  }

  // 2b. Usage gate: charges at 0, or a consumable already used up, asks for a Rule Break and records it on the card.
  let usageFlags = {};
  if (hasCharges ? currentCharges <= 0 : (spendsQuantity && currentQty <= 0)) {
    const reason = hasCharges ? `"${itemName}" has no charges remaining.` : `"${itemName}" has already been used up.`;
    const verdict = await confirmRuleBreak({
      title: 'Rule Break Confirmation',
      message: `${reason} Use it anyway as a Rule Break?`,
      reason,
      options
    });
    if (!verdict.confirmed) {
      if (verdict.refusal !== RULE_BREAK_REFUSALS.CANCELLED && typeof ui !== 'undefined' && ui.notifications?.warn) ui.notifications.warn(reason);
      return { error: 'depleted', message: reason };
    }
    usageFlags = { ruleBreak: true, usageRuleBreak: true };
  }

  // 2c. Cooldown gate (3.12c): on cooldown asks for a Rule Break; the record is written when the use goes ahead,
  // whether or not the item has outcomes. Items with no owner carry no record.
  const cooldownGate = actor ? await gateItemCooldown(actor, item, { options }) : { proceed: true, flags: {}, commit: async () => {} };
  if (!cooldownGate.proceed) return { error: 'cooldown_cancelled', message: `"${itemName}" is on cooldown.` };
  // Potion rules (9.8): who takes it, then Potion Sickness and the lifetime limit ask before anything is spent.
  const recipient = actor ? (options.recipient ?? await askPotionRecipient(actor, item, options)) : null;
  const potionGate = actor
    ? await gatePotionUse(actor, item, { recipient, options, outcomes: Array.isArray(sys.outcomes) ? sys.outcomes : [] })
    : POTION_GATE_CLEAR;
  if (!potionGate.proceed) return { error: 'potion_cancelled', message: `"${itemName}" was not used.` };
  // The lifetime kinds the use applied; a random outcome narrows it to the one rolled.
  let potionKinds = lifetimeKindsOf(sys.outcomes);
  // A `recharge` outcome refills one of the user's own items: the user picks it now, before anything is spent. A
  // cancelled pick ends the use; nothing able to take a recharge asks whether to use it anyway (no effect, no Rule Break).
  const rechargeRows = (Array.isArray(sys.outcomes) ? sys.outcomes : []).filter((o) => String(o?.type || '').toLowerCase().trim() === RECHARGE_OUTCOME);
  let recharge = null;
  if (actor && rechargeRows.length) {
    recharge = await pickRechargeTarget(actor, item, { rows: rechargeRows, options });
    if (recharge.cancelled) return { error: 'recharge_cancelled', message: `"${itemName}" was not used.` };
  }
  // An `enchant_item` outcome upgrades one equipped item: the user picks it now, before anything is spent (a buff-activation use included). A cancelled
  // pick ends the use with nothing spent. With nothing equipped the unit is spent and nothing is applied (wasted below).
  const enchantOutcomes = (Array.isArray(sys.outcomes) ? sys.outcomes : []).filter((o) => String(o?.type || '').toLowerCase().trim() === ENCHANT_ITEM_OUTCOME);
  let enchantTarget = null;
  const nothingEquipped = enchantOutcomes.length > 0
    && ![...(actor?.items ?? [])].some((i) => i.type === 'gear' && i.system?.equipped === true);
  if (enchantOutcomes.length && !nothingEquipped) {
    const equipped = [...(actor?.items ?? [])].filter((i) => i.type === 'gear' && i.system?.equipped === true);
    enchantTarget = await pickOwnedItem(actor, {
      candidates: equipped.map((item) => ({ item })),
      title: itemName,
      label: 'Item to enchant',
      okLabel: 'Enchant'
    });
    if (!enchantTarget) return { error: 'no_enchant_target', message: `"${itemName}" needs an equipped item to enchant. It was not used.` };
  }

  if (actor) await spendActivationUses(actor, [item]);
  const gateFlags = { ...cooldownGate.flags, ...usageFlags, ...(recharge?.ruleBreak ? { ruleBreak: true, rechargeRuleBreak: true } : {}), ...zeroZoneGate.flags, ...actionBlockGate.flags, ...potionGate.flags };
  // A confirmed Rule Break (no charges, used up, on cooldown) shows on the card like every other Rule Break card.
  const ruleBreakBadge = gateFlags.ruleBreak ? ` ${ruleBreakBadgeHtml()}` : '';

  // False when nothing was spent: a light source could not be lit (no token on the viewed scene), or every enchantment
  // the use tried was refused. The card's remaining count reads it.
  let unitSpent = true;
  const consumeItemUse = async () => {
    // A used light (torch) burns on as its own token whether or not this use deletes the stack: light it first, flagged
    // `consumed`, so the delete trigger leaves it alone (3.16c, Q128 a). Nothing lit, nothing taken.
    if (actor && emitsLight(item) && !(await igniteLight(actor, item, { consumed: true }))) {
      unitSpent = false;
      return;
    }
    await cooldownGate.commit();
    await potionGate.commit(potionKinds);
    if (prayerDeity) await addKnownDeity(actor, prayerDeity, { via: 'scroll' });
    // The last unit of a consumable leaves its used form; a consumed light leaves it when the light ends (3.76 B3).
    const unit = { quantity: currentQty, leaveForm: !(actor && emitsLight(item)) };
    if (hasCharges) {
      const next = Math.max(0, currentCharges - 1);
      if (usage === 'consumable' && next === 0) {
        // A multi-dose consumable took its last dose: one unit becomes its used form, and any units left start full.
        await spendConsumableUnit(item, actor, { ...unit, refillCharges: true });
      } else {
        await item.update({ 'system.charges.value': next });
      }
    } else if (spendsQuantity && currentQty > 0) {
      await spendConsumableUnit(item, actor, unit);
    }
  };

  // Nothing equipped to enchant: the unit is gone, nothing is applied, and the card says so.
  if (nothingEquipped) {
    await consumeItemUse();
    await ChatMessage.create(withFlags({
      speaker: actor ? ChatMessage.getSpeaker({ actor }) : undefined,
      content: `<div class="cog-chat-card cog-item-card"><p>${escapeAttr(wastedScrollText(actor?.name ?? 'Someone', itemName))}</p></div>`
    }, { ...gateFlags, wastedEnchant: true }), cardMessageOptions(actor));
    return { wasted: true, message: wastedScrollText(actor?.name ?? 'Someone', itemName) };
  }

  /** The "remaining" line of a card: charges for a counter, the stack for a consumable, nothing to count for the rest. */
  const remainingLabel = () => {
    const taken = unitSpent ? 1 : 0;
    if (hasCharges) return `<strong>Remaining Charges:</strong> ${Math.max(0, currentCharges - taken)} / ${escapeAttr(sys.charges.max)}`;
    if (spendsQuantity) return `<strong>Remaining Uses:</strong> ${Math.max(0, currentQty - taken)}`;
    return `<strong>${escapeAttr(usageLabel(usage))}</strong>`;
  };

  // 3. Multi-Outcome Logic
  const outcomes = Array.isArray(sys.outcomes) ? sys.outcomes : [];
  let executionMode = String(sys.executionMode || '').toLowerCase().trim();
  if (!executionMode) {
    executionMode = isScratch ? 'random' : (outcomes.length > 0 ? 'all' : 'none');
  }

  if (outcomes.length > 0) {
    // --- RANDOM SELECTION MODE (Scratch-Off / Gamble) ---
    if (executionMode === 'random') {
      const totalWeight = outcomeWeightTotal(outcomes);
      let rollVal;
      if (typeof Roll !== 'undefined') {
        const rollObj = await (new Roll(`1d${totalWeight}`)).evaluate();
        rollVal = rollObj.total;
      } else {
        rollVal = Math.floor(Math.random() * totalWeight) + 1;
      }

      let runningWeight = 0;
      let chosenOutcome = outcomes[0];
      for (const out of outcomes) {
        runningWeight += outcomeWeight(out);
        if (rollVal <= runningWeight) {
          chosenOutcome = out;
          break;
        }
      }

      // Read before the use can delete the item; only the rolled outcome's effect is described (3.71)
      const summaryHtml = await outcomeCardSummary(item, actor, [chosenOutcome]);
      // Consume only once the outcome resolved: a cast that throws leaves the scroll in the pack.
      potionKinds = lifetimeKindsOf([chosenOutcome]);
      // Destructured: each field the card prints is read by name, so the escaping rail can follow `outcomeHtml` to its builder.
      const {
        outcomeHtml, isDamageCard, evaluatedDmg, damageType, healBars, healAmount, buff, debuff, targetActor,
        enchantAttempts, enchantApplied, enchantDestroyed
      } = await resolveSingleOutcome(chosenOutcome, actor, item, false, { enchantTarget, recipient, recharge });
      // A refused or cancelled enchantment keeps the unit; a destroyed item still spends the scroll (the book's roll).
      if (enchantWasRefused({ enchantAttempts, enchantApplied, enchantDestroyed })) unitSpent = false;
      else await consumeItemUse();
      const remainingUsesLabel = remainingLabel();

      const cardHtml = `
        <div class="cog-chat-card cog-item-card ${isDamageCard ? 'cog-damage-card' : ''} cog-scratchoff-card"
          data-attacker-uuid="${escapeAttr(actor?.uuid || '')}"
          data-item-name="${escapeAttr(itemName)}"
          data-damage-value="${escapeAttr(evaluatedDmg)}"
          data-damage-type="${escapeAttr(damageType || '')}"
          data-target-uuid="${escapeAttr(targetActor?.uuid || '')}"
          style="font-family: var(--font-primary, sans-serif);">
          <div class="cog-chat-card-header" style="display: flex; align-items: center; gap: 8px; border-bottom: 2px solid var(--cog-magic); padding-bottom: 4px; margin-bottom: 6px;">
            <img class="cog-bg-icon-box" src="${escapeAttr(item.img || 'icons/svg/item-bag.svg')}" style="width: 34px; height: 34px; border: 1px solid var(--cog-border-strong); border-radius: 4px;" />
            <div>
              <h3 class="cog-text-strong" style="margin: 0; font-size: 15px; font-weight: bold;">${escapeAttr(itemName)}${ruleBreakBadge}</h3>
              <span class="cog-text-magic" style="font-size: 11px; text-transform: uppercase; font-weight: bold;">
                <i class="fa-solid fa-ticket"></i> Random Result
              </span>
            </div>
          </div>
          <div class="cog-text-muted" style="display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 4px;">
            <span>${remainingUsesLabel}</span>
            ${hasCooldown(sys) ? `<span><strong>Limit:</strong> ${escapeAttr(cooldownLabel(sys))}</span>` : ''}
          </div>
          ${outcomeHtml}
          ${summaryHtml}
        </div>
      `;

      return ChatMessage.create(withFlags({
        speaker: actor ? ChatMessage.getSpeaker({ actor }) : undefined,
        content: cardHtml
      }, {
        ...gateFlags,
        outcome: chosenOutcome,
        roll: rollVal,
        damage: evaluatedDmg,
        healBars,
        healAmount,
        buff,
        debuff,
        targetId: targetActor?.id || null
      }), cardMessageOptions(actor));
    }

    // --- ALL EFFECTS MODE (Guaranteed Consumable / Potion Combo / Activated Gear) ---
    const summaryHtml = await outcomeCardSummary(item, actor, outcomes);
    const outcomeHtmls = [];
    const appliedResults = [];
    let totalHealBars = 0;
    let totalDmg = 0;

    for (const out of outcomes) {
      const {
        outcomeHtml, evaluatedDmg, damageType, healAmount, healBars, buff, debuff, isDamageCard, targetActor, targetName,
        enchantAttempts, enchantApplied, enchantDestroyed
      } = await resolveSingleOutcome(out, actor, item, true, { enchantTarget, recipient, recharge });
      outcomeHtmls.push(outcomeHtml);
      // The stored result keeps every field the outcome resolver returned.
      appliedResults.push({
        outcomeHtml, evaluatedDmg, damageType, healAmount, healBars, buff, debuff, isDamageCard, targetActor, targetName,
        enchantAttempts, enchantApplied, enchantDestroyed
      });
      totalHealBars += healBars || 0;
      totalDmg += evaluatedDmg || 0;
    }
    // Spent unless every enchantment the use tried was refused or cancelled (nothing applied, nothing destroyed).
    const enchantTried = appliedResults.filter((r) => r.enchantAttempts > 0);
    const nothingTaken = enchantTried.length > 0 && enchantTried.every(enchantWasRefused)
      && enchantTried.length === appliedResults.length;
    if (nothingTaken) unitSpent = false;
    else await consumeItemUse();

    const remainingUsesLabel = remainingLabel();

    const headerColor = item.type === 'gear' ? 'var(--cog-accent)' : (lootType === 'wand' ? 'var(--cog-magic)' : 'var(--cog-success)');
    const headerTitle = item.type === 'gear' ? 'Activated Gear' : (lootType === 'wand' ? 'Wand Activated' : (lootType === 'scroll' ? 'Scroll Used' : 'Consumable Used'));
    const headerIcon = item.type === 'gear' ? 'fa-shield-halved' : (lootType === 'wand' ? 'fa-wand-magic-sparkles' : (lootType === 'scroll' ? 'fa-scroll' : 'fa-flask'));

    const multiCardHtml = `
      <div class="cog-chat-card cog-item-card cog-multi-effect-card ${totalDmg > 0 ? 'cog-damage-card' : ''}"
        data-attacker-uuid="${escapeAttr(actor?.uuid || '')}"
        data-item-name="${escapeAttr(itemName)}"
        data-damage-value="${escapeAttr(totalDmg)}"
        style="font-family: var(--font-primary, sans-serif);">
        <div class="cog-chat-card-header" style="display: flex; align-items: center; gap: 8px; border-bottom: 2px solid ${headerColor}; padding-bottom: 4px; margin-bottom: 6px;">
          <img class="cog-bg-icon-box" src="${escapeAttr(item.img || (lootType === 'wand' ? 'icons/svg/aura.svg' : (lootType === 'scroll' ? 'icons/svg/book.svg' : 'icons/svg/item-bag.svg')))}" style="width: 34px; height: 34px; border: 1px solid var(--cog-border-strong); border-radius: 4px;" />
          <div>
            <h3 class="cog-text-strong" style="margin: 0; font-size: 15px; font-weight: bold;">${escapeAttr(itemName)}${ruleBreakBadge}</h3>
            <span class="cog-fg-dyn" style="--cog-fg-dyn: ${headerColor}; font-size: 11px; text-transform: uppercase; font-weight: bold;">
              <i class="fa-solid ${headerIcon}"></i> ${headerTitle} (${outcomes.length} Effect${outcomes.length > 1 ? 's' : ''})
            </span>
          </div>
        </div>
        <div class="cog-text-muted" style="display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 4px;">
          <span>${remainingUsesLabel}</span>
          ${hasCooldown(sys) ? `<span><strong>Limit:</strong> ${escapeAttr(cooldownLabel(sys))}</span>` : ''}
        </div>
        ${sys.notes ? `<p class="cog-text-secondary" style="margin: 3px 0 6px 0; font-size: 11px;">${escapeAttr(sys.notes)}</p>` : ''}
        <div class="cog-outcomes-container" style="display: flex; flex-direction: column; gap: 4px;">
          ${outcomeHtmls.join('')}
        </div>
        ${summaryHtml}
      </div>
    `;

    return ChatMessage.create(withFlags({
      speaker: actor ? ChatMessage.getSpeaker({ actor }) : undefined,
      content: multiCardHtml
    }, {
      ...gateFlags,
      executionMode: 'all',
      itemType: item.type,
      lootType: sys.lootType,
      outcomes: outcomes,
      totalHealBars,
      totalDmg,
      results: appliedResults
    }), cardMessageOptions(actor));
  }

  // 4. Scrolls, Wands, & Direct Spell Consumables (without explicit outcome array)
  if (sys.spellIdentifier) {
    const match = spellByIdentifier(actor, sys.spellIdentifier);

    if (match) {
      await consumeItemUse();
      if (actor && typeof actor.rollSpell === 'function') {
        return actor.rollSpell(match, {
          zeroZoneChecked: true,
          freeCast: true,
          originItem: item,
          isConsumable: true,
          isItemEffect: true,
          itemRuleBreak: gateFlags.ruleBreak === true
        });
      }
      return rollSpellCard(match, {
        freeCast: true,
        originItem: item,
        isConsumable: true,
        isItemEffect: true
      });
    }
  }

  // 5. A plain consumable (no outcomes, no spell): the generic used-item card.
  const plainSummaryHtml = await cardSummary(item, CARD_PROFILES.use, { actor });
  await consumeItemUse();

  const remainingUsesLabel = hasCharges || !spendsQuantity
    ? remainingLabel()
    : (currentQty > 1 ? `<strong>Remaining Quantity:</strong> ${currentQty - 1}` : '<em>Last consumable used.</em>');
  const plainTitle = spendsQuantity ? 'Used Consumable' : (item.type === 'gear' ? 'Activated Gear' : 'Item Used');

  return ChatMessage.create(withFlags({
    speaker: actor ? ChatMessage.getSpeaker({ actor }) : undefined,
    content: `
      <div class="cog-chat-card cog-item-card" style="font-family: var(--font-primary, sans-serif);">
        <div class="cog-chat-card-header" style="display: flex; align-items: center; gap: 8px; border-bottom: 2px solid var(--cog-info); padding-bottom: 4px; margin-bottom: 6px;">
          <img class="cog-bg-icon-box" src="${escapeAttr(item.img || 'icons/svg/item-bag.svg')}" style="width: 32px; height: 32px; border: 1px solid var(--cog-border-strong); border-radius: 4px;" />
          <div>
            <h3 class="cog-text-strong" style="margin: 0; font-size: 15px; font-weight: bold;">${escapeAttr(itemName)}${ruleBreakBadge}</h3>
            <span class="cog-text-info" style="font-size: 11px; text-transform: uppercase; font-weight: bold;">${plainTitle}</span>
          </div>
        </div>
        <p style="margin: 2px 0; font-size: 12px;">${remainingUsesLabel}</p>
        ${sys.notes ? `<p style="margin: 4px 0; font-size: 12px;">${escapeAttr(sys.notes)}</p>` : ''}
        ${sys.description ? `<div style="font-size: 12px; margin-top: 4px;">${trustedHtml(item.system.description)}</div>` : ''}
        ${plainSummaryHtml}
      </div>
    `
  }, { ...gateFlags }), cardMessageOptions(actor));
}
