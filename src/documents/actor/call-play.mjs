/**
 * Call a Play.
 *
 * The caller spends an Action on their turn and picks an ally. The caller's client rolls the resolved formula then
 * and posts it as the caller's own roll message (the trust source); the GM banks `{ formula, amount, rollMessageId }`
 * on the ally's combatant for the current round. The ally's next skill or attack roll lists it (pre-ticked); a used
 * Called Play is copied into the ally's check record with its destination fixed from the unassisted roll, then
 * removed from the combatant. Nothing is rolled at the ally's roll. The ally chooses how the play is carried out:
 * there is no proposed-action text.
 */
import { ruleBreakBadgeHtml } from '../../utils/rule-break-visibility.mjs';
import { SYSTEM_ID } from '../../constants.mjs';
import { escapeAttr, sameSideCombatants } from '../../utils/interrupts.mjs';
import { getAssistSpec, calledPlayDestination, rollerTokenIdOf } from '../../utils/check-assists.mjs';
import { rollAssistDice } from '../../utils/assist-roll.mjs';
import { CHECK_TAGS, isOutcomeTag, isFreeInterruptItem } from '../../utils/tag-mechanics.mjs';
import { matchesTagQueryIgnoring } from '../../utils/tag-query.mjs';
import { confirmRuleBreak, RULE_BREAK_REFUSALS } from '../../utils/rule-break.mjs';
import { isNoGmReason, getActiveGM } from '../../utils/gm-relay.mjs';
import { getCalledPlays } from '../combat.mjs';
import { assistText } from '../../chat/render/check-assists.mjs';

const CHECK_TAG_VALUES = new Set(Object.values(CHECK_TAGS));
const notify = (level, text) => globalThis.ui?.notifications?.[level]?.(text);
const warnedInvalid = new Set();

/** One console warning per item id for a skill whose assist formula is not a roll formula (D2). */
export function warnInvalidAssistOnce(item) {
  const key = item?.id ?? item?.uuid ?? item?.name ?? '';
  if (warnedInvalid.has(key)) return;
  warnedInvalid.add(key);
  console.warn(`Sprinter RPG | "${item?.name}" has an assist formula that is not a valid roll formula; rolling a normal check.`);
}

function combatantOf(combat, actor, tokenId = null) {
  const list = Array.isArray(combat?.combatants) ? combat.combatants : Array.from(combat?.combatants?.values?.() ?? combat?.combatants ?? []);
  return (tokenId ? list.find((c) => c?.tokenId === tokenId) : null) ?? list.find((c) => c?.actorId === actor?.id) ?? null;
}

// -- Pending Called Plays at the ally's roll ---------------------------------------------------------------------

/**
 * The roller's combatant's current-round Called Plays whose stored `when` matches the roll's check tags before the
 * roll (D6.1). Outcome tags are unknown before the roll, so a query that lists one passes. Empty outside the active
 * combat or for an actor with no combatant in it.
 * @param {object} actor the rolling ally
 * @param {{ tags?: Iterable<string> }} context the roll's context before situations
 * @param {{ tokenId?: string|null, combat?: object|null }} [opts]
 * @returns {object[]} entries as `getCalledPlays` returns them
 */
export function pendingCalledPlaysFor(actor, context, { tokenId = null, combat = globalThis.game?.combat } = {}) {
  if (!actor || !combat?.id) return [];
  const combatant = combatantOf(combat, actor, tokenId ?? rollerTokenIdOf(actor));
  if (!combatant) return [];
  const checkTags = new Set([...(context?.tags ?? [])].filter((t) => CHECK_TAG_VALUES.has(t)));
  return getCalledPlays(combatant, { round: Number(combat.round) })
    .filter((entry) => matchesTagQueryIgnoring(checkTags, entry.when, isOutcomeTag));
}

/**
 * The check-record entries for the Called Plays a roll uses. Reads the stored amount (rolled when the play was
 * called); each entry is judged on the roll without any Called Play (D16 a), so two plays never change each other's
 * destination.
 * @param {object} p
 * @param {object[]} p.entries the pending entries offered for this roll
 * @param {string[]} p.chosenIds the ids the roll uses
 * @param {{ total: number, d20?: number|null, dc?: number|null, firstTarget?: { dc?: number|null, bonus?: number }|null }} p.unassisted
 * @param {boolean} [p.hasDamage]
 * @returns {{ assists: object[] }}
 */
export function rollCalledPlays({ entries = [], chosenIds = [], unassisted = {}, hasDamage = false } = {}) {
  const chosen = new Set(chosenIds);
  const appliedTo = calledPlayDestination({ ...unassisted, hasDamage });
  const assists = [];
  for (const entry of entries) {
    if (!chosen.has(entry.id)) continue;
    assists.push({
      id: entry.id,
      at: Date.now(),
      source: 'called_play',
      fromUuid: entry.fromUuid,
      fromName: entry.fromName,
      skillName: entry.skillName,
      formula: entry.formula,
      amount: entry.amount,
      appliedTo,
      messageId: entry.messageId,
      rollMessageId: entry.rollMessageId,
      rollIndex: null,
      calledPlayId: entry.id,
      proposal: entry.proposal
    });
  }
  return { assists };
}

/**
 * Remove the Called Plays a posted check card used from the ally's combatant. A failure (no GM) leaves them pending;
 * the stale-round filter ends them at the next round (O10).
 * @param {object} actor the ally
 * @param {object|null} message the posted check card
 * @param {object[]} assists the entries `rollCalledPlays` returned
 */
export async function consumeCalledPlays(actor, message, assists = []) {
  const used = assists.filter((a) => a.calledPlayId);
  if (!used.length) return;
  const combat = globalThis.game?.combat;
  const combatant = combatantOf(combat, actor);
  if (!combatant || typeof combat?.consumeCalledPlay !== 'function' || !message?.id) return;
  for (const a of used) {
    const res = await combat.consumeCalledPlay({ combatantId: combatant.id, calledPlayId: a.calledPlayId, checkMessageId: message.id });
    if (!res.ok && !isNoGmReason(res.reason)) notify('warn', assistText('CalledPlayNotCleared'));
  }
}

// -- Calling a play --------------------------------------------------------------------------------------------

/** The ally the call is for: `options.ally`, else the first targeted token that is a same-side combatant, else a dialog. */
async function chooseAlly(actor, callerCbt, combat, options) {
  const allies = sameSideCombatants(actor, combat, { combatant: callerCbt });
  if (!allies.length) return { allies, chosen: null };
  const given = options.ally;
  if (given) {
    const givenId = typeof given === 'string' ? given : given.id;
    return { allies, chosen: allies.find((a) => a.combatant.id === givenId || a.actor.id === givenId) ?? null };
  }
  const targeted = typeof actor._attackTargetEntries === 'function' ? actor._attackTargetEntries(options) : [];
  for (const t of targeted) {
    const tokenId = t.token?.id ?? t.token?.document?.id ?? null;
    const hit = allies.find((a) => (tokenId && a.combatant.tokenId === tokenId) || a.actor.id === t.actor.id);
    if (hit) return { allies, chosen: hit };
  }
  const DialogV2 = globalThis.foundry?.applications?.api?.DialogV2;
  if (options.interactive === false || typeof DialogV2?.prompt !== 'function') return { allies, chosen: null };
  const rows = allies.map((a, i) => `<label class="cog-situation-toggle"><input type="radio" name="ally" value="${escapeAttr(a.combatant.id)}"${i === 0 ? ' checked' : ''}> ${escapeAttr(a.actor.name)}</label>`).join('');
  try {
    const picked = await DialogV2.prompt({
      window: { title: assistText('CalledPlayPickTitle') },
      content: `<p>${escapeAttr(assistText('CalledPlayPick'))}</p>${rows}`,
      ok: {
        label: assistText('CalledPlayPickOk'),
        callback: (_event, button) => {
          const radios = [...(button?.form?.querySelectorAll?.('input[name="ally"]') ?? [])];
          return (radios.find((el) => el.checked) ?? radios.find((el) => el.hasAttribute?.('checked')))?.getAttribute('value') ?? null;
        }
      },
      rejectClose: false,
      modal: true
    });
    return { allies, chosen: allies.find((a) => a.combatant.id === picked) ?? null };
  } catch {
    return { allies, chosen: null };
  }
}

async function postCallCard({ actor, skill, roll, formula, lines, allyName, combat, allyCombatantId, ruleBreak }) {
  const amount = roll.total;
  const title = allyName
    ? assistText('CalledPlayTitle', { name: actor.name, ally: allyName, amount, formula })
    : assistText('CalledPlayTitleByHand', { name: actor.name, amount, formula });
  const note = allyName ? '' : `<div class="cog-assist-card-lines">${escapeAttr(assistText('CalledPlayByHand'))}</div>`;
  const linesHtml = lines.length ? `<div class="cog-assist-card-lines">${escapeAttr(lines.join(', '))}</div>` : '';
  const ruleBreakHtml = ruleBreak ? ruleBreakBadgeHtml() : '';
  const rollHtml = typeof roll.render === 'function' ? await roll.render() : '';
  const content = `
    <div class="cog-chat-card cog-assist-card cog-called-play-card">
      <div class="cog-assist-card-title"><i class="fa-solid fa-bullhorn"></i> ${escapeAttr(title)} ${ruleBreakHtml}</div>
      ${linesHtml}${note}
      ${rollHtml}
    </div>
  `;
  const spec = getAssistSpec(skill);
  return roll.toMessage({
    speaker: globalThis.ChatMessage?.getSpeaker?.({ actor }) ?? { alias: actor.name },
    flavor: `<strong>${escapeAttr(actor.name)}</strong>: ${escapeAttr(skill.name)} (${escapeAttr(formula)})`,
    content,
    flags: {
      [SYSTEM_ID]: {
        isCalledPlay: true,
        combatId: combat?.id ?? null,
        round: combat ? Number(combat.round) || 0 : null,
        allyCombatantId: allyCombatantId ?? null,
        fromUuid: actor.uuid,
        itemId: skill.id,
        skillName: skill.name,
        formula,
        when: spec.when,
        ruleBreak
      }
    }
  });
}

/**
 * An assist skill rolled from the sheet that is not called (§4.4): an after-roll assist (Intervene) posts its dice with a
 * pointer to the Interrupt button on the ally's card; a skill with no moment posts the roll. No Action is recorded and
 * nothing is applied: only the card button on an ally's check does that.
 * @returns {Promise<object|null>} the posted message
 */
export async function postSheetAssistRoll(actor, skill, spec, options = {}) {
  let rolled;
  try {
    rolled = await rollAssistDice(actor, skill, options);
  } catch (err) {
    console.error('Sprinter RPG | Assist roll failed:', err);
    notify('error', assistText('RollFailed', { skill: skill.name }));
    return null;
  }
  const note = spec.moment === 'check' ? `<div class="cog-assist-card-lines">${escapeAttr(assistText('SheetNote'))}</div>` : '';
  const rollHtml = typeof rolled.roll.render === 'function' ? await rolled.roll.render() : '';
  const content = `
    <div class="cog-chat-card cog-assist-card">
      <div class="cog-assist-card-title"><i class="fa-solid fa-handshake-angle"></i> ${escapeAttr(skill.name)} +${escapeAttr(rolled.roll.total)}</div>
      ${note}
      ${rollHtml}
    </div>
  `;
  return rolled.roll.toMessage({
    speaker: globalThis.ChatMessage?.getSpeaker?.({ actor }) ?? { alias: actor.name },
    flavor: `<strong>${escapeAttr(actor.name)}</strong>: ${escapeAttr(skill.name)} (${escapeAttr(rolled.formula)})`,
    content,
    flags: { [SYSTEM_ID]: { isAssistRoll: true, source: 'sheet', assisterUuid: actor.uuid, itemId: skill.id, skillName: skill.name, formula: rolled.formula } }
  });
}

/**
 * Call a Play (§4.2): pick the ally, ask for a Rule Break when no Action is left, roll the resolved formula as the
 * caller's own roll message, record the Action, post the card and bank the amount on the ally's combatant. Without a
 * combat (or an ally) the roll is posted with "apply it by hand" and nothing is stored.
 * @param {object} actor the caller
 * @param {object} skill the Call a Play skill
 * @param {object} [options] `ally` (actor, combatant id), `situations`, `interactive`, `ruleBreak`
 * @returns {Promise<{ ok: boolean, reason?: string, message?: object, stored?: object, ruleBreak?: boolean }|null>}
 */
export async function callPlay(actor, skill, options = {}) {
  const spec = getAssistSpec(skill);
  if (!spec.valid) {
    notify('error', assistText('InvalidFormula', { skill: skill?.name }));
    return { ok: false, reason: 'invalid-formula' };
  }
  const combat = globalThis.game?.combat;
  const callerCbt = combat?.id ? combatantOf(combat, actor, rollerTokenIdOf(actor)) : null;
  let ally = null;
  if (callerCbt) {
    const picked = await chooseAlly(actor, callerCbt, combat, options);
    // Allies exist but none was named (dialog closed, no UI): nothing is spent.
    if (picked.allies.length && !picked.chosen) return { ok: false, reason: 'no-ally' };
    ally = picked.chosen;
  }
  const byHand = !callerCbt || !ally;

  let ruleBreak = false;
  const isFree = isFreeInterruptItem(skill);
  if (!byHand && !isFree) {
    const actions = combat.getCombatantActions?.(callerCbt) ?? null;
    if (actions && actions.spent >= actions.max) {
      const counts = { spent: actions.spent, max: actions.max };
      const res = await confirmRuleBreak({
        title: assistText('NoActionsTitle'),
        message: assistText('NoActionsConfirm', { ...counts, skill: skill.name }),
        reason: assistText('NoActionsReason', counts),
        options
      });
      if (!res.confirmed) {
        if (res.refusal !== RULE_BREAK_REFUSALS.CANCELLED) notify('warn', res.reason);
        return { ok: false, reason: 'refused' };
      }
      ruleBreak = true;
    }
  }

  // Roll before recording: a formula that throws spends nothing (D2).
  let rolled;
  try {
    rolled = await rollAssistDice(actor, skill, options);
  } catch (err) {
    console.error('Sprinter RPG | Called Play roll failed:', err);
    notify('error', assistText('RollFailed', { skill: skill.name }));
    return { ok: false, reason: 'roll-failed' };
  }

  if (!byHand && !isFree) {
    // Storing the play on the ally's combatant needs the GM, so refuse before spending the Action (one warning).
    if (!globalThis.game?.user?.isGM && !getActiveGM()) {
      notify('warn', assistText('NoGmAction'));
      return { ok: false, reason: 'no-gm-action' };
    }
    const recorded = await combat.recordCombatantAction(callerCbt, {
      type: spec.actionType || 'play',
      label: skill.name,
      note: assistText('CalledPlayNote', { ally: ally.actor.name })
    });
    if (!recorded?.success) {
      // The relay already warned (no GM for an unowned combatant): one warning per click.
      return { ok: false, reason: 'no-gm-action' };
    }
  }

  const message = await postCallCard({
    actor, skill, roll: rolled.roll, formula: rolled.formula, lines: rolled.lines,
    allyName: byHand ? '' : ally.actor.name, combat: byHand ? null : combat, allyCombatantId: ally?.combatant?.id, ruleBreak
  });
  if (byHand) return { ok: true, message, ruleBreak };
  if (!message?.id) return { ok: false, reason: 'no-message', ruleBreak };
  const stored = await combat.storeCalledPlay({ callMessageId: message.id });
  if (!stored.ok) {
    if (!isNoGmReason(stored.reason)) notify('warn', assistText('Refused', { reason: stored.reason }));
  }
  return { ok: stored.ok, reason: stored.reason, message, stored: stored.entry, ruleBreak };
}
