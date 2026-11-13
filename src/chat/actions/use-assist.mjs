/**
 * Assist buttons.
 *
 * `crawlerUseAssist` (on a check card): the assister's client asks for a Rule Break when no Action is left, rolls the
 * skill's assist dice, records the Action, posts the assist card (its own roll message: the trust source), then asks
 * for the amend. `crawlerApplyAssist` (on an assist card, GM only): the retry when no GM was connected.
 *
 * The amend (`applyCheckAssist`) carries only the two message ids. Whoever writes (the GM, or the check card's author)
 * re-reads both messages, requires the assist message's author to be the GM or an owner of the assister, takes the
 * amount from that message's roll and writes one entry under `flags.sprinter-rpg.check.assists.<id>` with a dotted
 * update. Nothing numeric from a relay payload is used (2.2c rule).
 */
import { ruleBreakBadgeHtml } from '../../utils/rule-break-visibility.mjs';
import { SYSTEM_ID } from '../../constants.mjs';
import { registerRelayAction, requestRelay, isNoGmReason } from '../../utils/gm-relay.mjs';
import { resolveActorByUuid } from '../../utils/actor-uuid.mjs';
import { readCheckRecord, getAssistSpec, CHECK_RECORD_FLAG, MAX_RECORD_ASSISTS } from '../../utils/roll/check-assists.mjs';
import { rollAssistDice } from '../../utils/roll/assist-roll.mjs';
import { isFreeInterruptItem } from '../../utils/tag/tag-mechanics.mjs';
import { escapeAttr, trustedHtml } from '../../utils/escape-attr.mjs';
import { confirmRuleBreak, RULE_BREAK_REFUSALS } from '../../utils/rule-break.mjs';
import { canModifyMessage } from '../damage-applications.mjs';
import { messageAuthorId } from '../chat-relay.mjs';
import { assistText } from '../render/check-assists.mjs';
import { findCombatant } from '../../documents/combat/combatants.mjs';
import { withFlags } from '../../utils/flags.mjs';

/** Relay action for check-card amends; `payload.op` names the write (`apply`; B3 adds `resolve`). */
const ASSIST_APPLY_RELAY = 'checkAssist';

/** Message ids become flag keys; anything else could address another flag path. */
const ENTRY_ID = /^[A-Za-z0-9_-]{1,64}$/;

const str = (v) => (typeof v === 'string' ? v : '');
const notify = (level, text) => globalThis.ui?.notifications?.[level]?.(text);

function messageById(id) {
  if (typeof id !== 'string' || !id) return null;
  return globalThis.game?.messages?.get?.(id) ?? null;
}

function flagsOf(message) {
  const f = message?.flags?.[SYSTEM_ID];
  return f && typeof f === 'object' && !Array.isArray(f) ? f : null;
}

function userById(id) {
  if (!id) return null;
  const users = globalThis.game?.users;
  return users?.get(id) ?? null;
}

/** The assist message counts only when its author is the GM or an owner of the assister (the E6.3 Evade rule). */
export function isTrustedAssist(assistMessage, assister) {
  if (!assister) return false;
  const author = userById(messageAuthorId(assistMessage));
  if (!author) return false;
  return Boolean(author.isGM) || Boolean(assister.testUserPermission?.(author, 'OWNER'));
}

/** The total of the assist message's first roll, or null. */
function rolledAmount(message) {
  const roll = Array.isArray(message?.rolls) ? message.rolls[0] : null;
  const total = Number(roll?.total);
  return roll && Number.isFinite(total) ? total : null;
}

/**
 * Write one Intervene-style entry from an assist message into its check card. Runs on the client that may update
 * the check message (the GM, or its author). Every value comes from the two messages; the payload gives only ids.
 * @param {{ checkMessageId: string, assistMessageId: string }} payload
 * @returns {Promise<{ ok: boolean, reason?: string, entry?: object }>}
 */
export async function writeCheckAssist(payload = {}) {
  const checkMessageId = str(payload.checkMessageId);
  const assistMessageId = str(payload.assistMessageId);
  if (!ENTRY_ID.test(assistMessageId)) return { ok: false, reason: 'bad-id' };
  const checkMessage = messageById(checkMessageId);
  const assistMessage = messageById(assistMessageId);
  if (!checkMessage || !assistMessage) return { ok: false, reason: 'missing' };
  if (!canModifyMessage(checkMessage)) return { ok: false, reason: 'forbidden' };
  const record = readCheckRecord(checkMessage);
  if (!record) return { ok: false, reason: 'no-record' };
  const f = flagsOf(assistMessage);
  if (!f || f.isAssistRoll !== true || f.source !== 'interrupt' || f.checkMessageId !== checkMessageId) return { ok: false, reason: 'not-assist' };
  const assister = resolveActorByUuid(f.assisterUuid);
  if (!isTrustedAssist(assistMessage, assister)) return { ok: false, reason: 'untrusted' };
  const amount = rolledAmount(assistMessage);
  if (amount === null) return { ok: false, reason: 'no-roll' };
  if (record.assists.some((a) => a.id === assistMessageId || a.messageId === assistMessageId)) return { ok: false, reason: 'duplicate' };
  if (record.assists.length >= MAX_RECORD_ASSISTS) return { ok: false, reason: 'full' };
  const skill = assister.items?.get(str(f.itemId)) ?? null;
  const entry = {
    id: assistMessageId,
    at: Date.now(),
    source: 'interrupt',
    fromUuid: assister.uuid,
    fromName: str(assister.name),
    skillName: str(skill?.name) || str(f.skillName),
    formula: str(assistMessage.rolls[0]?.formula) || str(f.formula),
    amount,
    appliedTo: 'check',
    messageId: assistMessageId,
    rollMessageId: null,
    rollIndex: null,
    calledPlayId: null,
    proposal: ''
  };
  await checkMessage.update({ [`flags.${SYSTEM_ID}.${CHECK_RECORD_FLAG}.assists.${assistMessageId}`]: entry });
  return { ok: true, entry };
}

const ASSIST_OPS = {
  apply: {
    // The GM may apply any assist card; a player only the one they posted. The writer re-checks the trust rules.
    authorize(payload, user) {
      if (user?.isGM) return true;
      const assistMessage = messageById(payload?.assistMessageId);
      return Boolean(assistMessage && user?.id) && messageAuthorId(assistMessage) === user.id;
    },
    apply: (payload) => writeCheckAssist(payload)
  },
  resolve: {
    authorize: (payload, user) => checkResolveCalledPlay(payload, user).ok,
    apply: (payload, user) => writeResolveCalledPlay(payload, user)
  }
};

const RESOLVE_TARGETS = Object.freeze(['check', 'damage', 'none']);

/**
 * Check a `resolve` request (D14): `entryId` is an unresolved Called Play of the check card, `appliedTo` an allowed
 * destination, and `user` the GM, an owner of the caller (`fromUuid`) or an owner of the card's roller.
 * @returns {{ ok: true, message: object, record: object, entry: object } | { ok: false, reason: string }}
 */
function checkResolveCalledPlay(payload, user) {
  const entryId = str(payload?.entryId);
  const appliedTo = str(payload?.appliedTo);
  if (!ENTRY_ID.test(entryId) || !RESOLVE_TARGETS.includes(appliedTo)) return { ok: false, reason: 'bad-request' };
  const message = messageById(payload?.checkMessageId);
  const record = message ? readCheckRecord(message) : null;
  if (!record) return { ok: false, reason: 'no-record' };
  const entry = record.assists.find((a) => a.id === entryId);
  if (!entry || entry.source !== 'called_play') return { ok: false, reason: 'no-entry' };
  if (entry.appliedTo !== 'unresolved') return { ok: false, reason: 'resolved' };
  if (appliedTo === 'damage' && !record.hasDamage) return { ok: false, reason: 'no-damage' };
  const owns = (uuid) => Boolean(resolveActorByUuid(uuid)?.testUserPermission?.(user, 'OWNER'));
  if (!user?.isGM && !owns(entry.fromUuid) && !owns(record.rollerUuid)) return { ok: false, reason: 'forbidden' };
  return { ok: true, message, record, entry };
}

/** Write the chosen destination of an unresolved Called Play. Changes `appliedTo` only, never the amount. */
async function writeResolveCalledPlay(payload, user) {
  const res = checkResolveCalledPlay(payload, user);
  if (!res.ok) return res;
  await res.message.update({ [`flags.${SYSTEM_ID}.${CHECK_RECORD_FLAG}.assists.${res.entry.id}.appliedTo`]: payload.appliedTo });
  return { ok: true, appliedTo: payload.appliedTo };
}

function assistOp(payload) {
  const op = payload?.op;
  return typeof op === 'string' && Object.hasOwn(ASSIST_OPS, op) ? ASSIST_OPS[op] : null;
}

registerRelayAction(ASSIST_APPLY_RELAY, {
  authorize: (payload, user) => Boolean(assistOp(payload)?.authorize(payload, user)),
  async apply(payload, user) {
    const op = assistOp(payload);
    if (!op) throw new Error(`Unknown check assist op "${payload?.op}".`);
    return op.apply(payload, user);
  }
});

/**
 * Ask for the amend: locally when this client may update the check card, else through the GM.
 * @param {{ checkMessageId: string, assistMessageId: string }} payload anything else in it is dropped
 * @returns {Promise<{ ok: boolean, reason?: string, entry?: object }>}
 */
export async function applyCheckAssist(payload = {}) {
  const clean = { op: 'apply', checkMessageId: str(payload.checkMessageId), assistMessageId: str(payload.assistMessageId) };
  const checkMessage = messageById(clean.checkMessageId);
  if (checkMessage && canModifyMessage(checkMessage)) return writeCheckAssist(clean);
  const res = await requestRelay(ASSIST_APPLY_RELAY, clean, { direct: false });
  if (!res.ok) return { ok: false, reason: res.reason ?? 'no-gm' };
  return res.result && typeof res.result === 'object' && typeof res.result.ok === 'boolean' ? res.result : { ok: false, reason: 'error' };
}

/** The assister's own combatant when the button names none (or names one that is gone): the first whose actor is them. */
function combatantOfActor(combat, actor) {
  return (combat?.combatants ?? []).find((c) => c?.actorId === actor?.id) ?? null;
}

async function postAssistCard({ assister, skill, roll, formula, lines, checkMessageId, rollerName, ruleBreak }) {
  const title = assistText('CardTitle', { skill: skill.name, amount: roll.total, name: rollerName });
  const linesHtml = lines.length ? `<div class="cog-assist-card-lines">${escapeAttr(lines.join(', '))}</div>` : '';
  const ruleBreakHtml = ruleBreak ? ruleBreakBadgeHtml() : '';
  const rollHtml = typeof roll.render === 'function' ? trustedHtml(await roll.render()) : '';
  const content = `
    <div class="cog-chat-card cog-assist-card">
      <div class="cog-assist-card-title"><i class="fa-solid fa-handshake-angle"></i> ${escapeAttr(title)} ${ruleBreakHtml}</div>
      ${linesHtml}
      ${rollHtml}
    </div>
  `;
  return roll.toMessage(withFlags({
    speaker: globalThis.ChatMessage?.getSpeaker?.({ actor: assister }) ?? { alias: assister.name },
    flavor: `<strong>${escapeAttr(assister.name)}</strong>: ${escapeAttr(skill.name)} (${escapeAttr(formula)})`,
    content
  }, {
    isAssistRoll: true,
    source: 'interrupt',
    checkMessageId,
    assisterUuid: assister.uuid,
    itemId: skill.id,
    skillName: skill.name,
    formula,
    ruleBreak
  }));
}

/**
 * Use an after-roll assist on a check card (§4.1). Never blocks: spent Actions ask for a Rule Break.
 * @param {object} p
 * @param {object} p.checkMessage the check card
 * @param {string} p.assisterUuid
 * @param {string} [p.combatantId] the assister's combatant
 * @param {string} p.itemId the assist skill on the assister
 * @param {object} [p.options] roll options (`situations`, `interactive`, `ruleBreak`)
 * @returns {Promise<{ ok: boolean, reason?: string, assistMessage?: object, applied?: object, ruleBreak?: boolean }>}
 */
async function useCheckAssist({ checkMessage, assisterUuid, combatantId = '', itemId, options = {} } = {}) {
  const record = readCheckRecord(checkMessage);
  if (!record || !checkMessage?.id) {
    notify('warn', assistText('NoCheck'));
    return { ok: false, reason: 'no-record' };
  }
  const assister = resolveActorByUuid(assisterUuid);
  const skill = assister?.items?.get(itemId) ?? null;
  if (!skill) {
    notify('warn', assistText('NoSkill'));
    return { ok: false, reason: 'no-skill' };
  }
  const spec = getAssistSpec(skill);
  if (!spec.valid) {
    notify('error', assistText('InvalidFormula', { skill: skill.name }));
    return { ok: false, reason: 'invalid-formula' };
  }
  const combat = globalThis.game?.combat;
  const combatant = findCombatant(combat, combatantId) ?? combatantOfActor(combat, assister);
  if (!combatant || typeof combat?.recordInterruptAction !== 'function') {
    notify('warn', assistText('NotInCombat'));
    return { ok: false, reason: 'no-combat' };
  }
  const listed = typeof assister.getAvailableInterrupts === 'function'
    ? assister.getAvailableInterrupts().find((i) => i?.itemId === skill.id)
    : null;
  const interrupt = listed ?? { id: `item:${skill.id}`, itemId: skill.id, name: skill.name, item: skill, type: skill.type, isFree: isFreeInterruptItem(skill) };
  const isFree = Boolean(interrupt.isFree || interrupt.actionCost === 0);

  let ruleBreak = false;
  const actions = combat.getCombatantActions?.(combatant) ?? null;
  if (!isFree && actions && actions.spent >= actions.max) {
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

  // Roll before recording: a formula that throws spends nothing (D2). Nothing is shown until the Action is recorded.
  let rolled;
  try {
    rolled = await rollAssistDice(assister, skill, options);
  } catch (err) {
    console.error('Sprinter RPG | Assist roll failed:', err);
    notify('error', assistText('RollFailed', { skill: skill.name }));
    return { ok: false, reason: 'roll-failed' };
  }

  const rollerName = resolveActorByUuid(record.rollerUuid)?.name ?? '';
  const recorded = await combat.recordInterruptAction(combatant, interrupt, { note: `${skill.name} → ${rollerName}`, ruleBreak });
  if (recorded?.declined) return { ok: false, reason: 'refused' };
  if (!recorded?.success) {
    // recordCombatantAction's relay already warned (no GM for an unowned combatant): one warning per click.
    return { ok: false, reason: 'no-gm-action' };
  }

  const assistMessage = await postAssistCard({
    assister, skill, roll: rolled.roll, formula: rolled.formula, lines: rolled.lines, checkMessageId: checkMessage.id, rollerName, ruleBreak
  });
  if (!assistMessage?.id) return { ok: false, reason: 'no-message', ruleBreak };
  const applied = await applyCheckAssist({ checkMessageId: checkMessage.id, assistMessageId: assistMessage.id });
  if (!applied.ok) {
    // The relay already warned when no GM is connected; only other refusals get a message here.
    if (!isNoGmReason(applied.reason)) notify('warn', assistText('Refused', { reason: applied.reason }));
  }
  return { ok: applied.ok, reason: applied.reason, assistMessage, applied, ruleBreak };
}

/**
 * `crawlerUseAssist`: an Assist offer on a check card.
 * @param {Event} event
 * @param {HTMLElement} button
 * @param {ChatMessage} message the check card
 */
export async function handleUseAssist(event, button, message) {
  button.disabled = true;
  try {
    const res = await useCheckAssist({
      checkMessage: message,
      assisterUuid: button.dataset?.assisterUuid,
      combatantId: button.dataset?.combatantId || '',
      itemId: button.dataset?.itemId
    });
    if (!res.ok) button.disabled = false;
    return res;
  } catch (err) {
    console.error('Sprinter RPG | Assist failed:', err);
    button.disabled = false;
    notify('error', `Sprinter RPG | ${err.message}`);
    return { ok: false, reason: 'error' };
  }
}

/**
 * Choose where an unresolved Called Play goes (D14): locally when this client may update the check card, else
 * through the GM. Only `appliedTo` changes; the amount stays the rolled one.
 * @param {{ checkMessageId: string, entryId: string, appliedTo: 'check'|'damage'|'none' }} payload anything else is dropped
 * @returns {Promise<{ ok: boolean, reason?: string, appliedTo?: string }>}
 */
export async function resolveCalledPlay(payload = {}) {
  const clean = { op: 'resolve', checkMessageId: str(payload.checkMessageId), entryId: str(payload.entryId), appliedTo: str(payload.appliedTo) };
  const checkMessage = messageById(clean.checkMessageId);
  if (checkMessage && canModifyMessage(checkMessage)) return writeResolveCalledPlay(clean, globalThis.game?.user);
  const res = await requestRelay(ASSIST_APPLY_RELAY, clean, { direct: false });
  if (!res.ok) return { ok: false, reason: res.reason ?? 'no-gm' };
  return res.result && typeof res.result === 'object' && typeof res.result.ok === 'boolean' ? res.result : { ok: false, reason: 'error' };
}

/**
 * `crawlerResolveCalledPlay`: a "→ check" / "→ damage" / "No effect" button under an unresolved Called Play line.
 * @param {Event} event
 * @param {HTMLElement} button
 * @param {ChatMessage} message the check card
 */
export async function handleResolveCalledPlay(event, button, message) {
  button.disabled = true;
  try {
    const res = await resolveCalledPlay({ checkMessageId: message?.id, entryId: button.dataset?.entryId, appliedTo: button.dataset?.appliedTo });
    if (!res.ok) {
      button.disabled = false;
      if (!isNoGmReason(res.reason)) notify('warn', assistText('Refused', { reason: res.reason }));
    }
    return res;
  } catch (err) {
    console.error('Sprinter RPG | Called Play resolve failed:', err);
    button.disabled = false;
    notify('error', `Sprinter RPG | ${err.message}`);
    return { ok: false, reason: 'error' };
  }
}

/**
 * `crawlerApplyAssist`: the GM's Apply button on an assist card that never reached its check.
 * @param {Event} event
 * @param {HTMLElement} button
 * @param {ChatMessage} message the assist card
 */
export async function handleApplyAssist(event, button, message) {
  const f = flagsOf(message);
  if (!f?.checkMessageId || !message?.id) return { ok: false, reason: 'not-assist' };
  button.disabled = true;
  const res = await applyCheckAssist({ checkMessageId: f.checkMessageId, assistMessageId: message.id });
  if (res.ok) button.closest?.('.cog-assist-apply')?.remove?.();
  else {
    button.disabled = false;
    notify('warn', assistText('Refused', { reason: res.reason }));
  }
  return res;
}
