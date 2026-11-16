/**
 * Defence trigger offer cards (Damage Reflection and Retaliation) and their button.
 *
 * `applyDamageTo` posts one offer per earned row (`res.reflections`, `res.retaliations`); each card is whispered to the holder's
 * owners and the GM. A reflection's click makes the attacker lose slots through `COGDamage.applyDamageToTarget({ slotLoss })`, after a
 * chance die when the row has one (it reflects on a 1). A retaliation's click rolls the row's dice and deals that damage to the attacker
 * through an ordinary application (DR, Resistance and undo apply; it earns no offer of its own). Every number comes from the holder's stored
 * damage application, never from the card or the button. A row limited to once a combat or floor asks a Rule Break to be used again; the
 * clicking client asks, and the GM applies. A GM applies directly; a player asks the GM through the relay (the attacker is usually not
 * theirs), and the GM checks that the player owns the holder named on the card.
 */
import { SYSTEM_ID } from '../../constants.mjs';
import { COGDamage } from '../../documents/actor/damage-pipeline.mjs';
import { currentTokens } from '../../documents/actor/actor-popularity.mjs';
import { resolveActorByUuid } from '../../utils/actor-uuid.mjs';
import { escapeAttr } from '../../utils/escape-attr.mjs';
import { readFlag, writeFlag } from '../../utils/flags.mjs';
import { registerRelayAction, requestRelay, isNoGmReason } from '../../utils/gm-relay.mjs';
import { confirmRuleBreak, ruleBreakUpdate } from '../../utils/rule-break.mjs';
import { ruleBreakBadgeHtml } from '../../utils/rule-break-visibility.mjs';
import { messageAuthorId } from '../chat-relay.mjs';
import { indexDamageApplication } from '../damage-applications.mjs';
import { findDamageUndoRecord, isApplicationId, markDamageUndoReflected } from '../../utils/damage/damage-undo.mjs';
import { earnedReflections } from '../../utils/damage/damage-reflection.mjs';
import { TRIGGER_USAGE_FLAG, usesSoFar, withUses } from '../../utils/floor/trigger-usage.mjs';
import { runKeyed } from '../../utils/keyed-queue.mjs';
import { ownerAndGmIds } from '../../utils/owner-recipients.mjs';

export const REFLECT_RELAY = 'chatReflectApply';
const REFLECT_ATTACK_NAME = 'Damage Reflection';
const RETALIATE_ATTACK_NAME = 'Retaliation';
const MAX_REFLECT_SLOTS = 100;
/** The face of the chance die on which a reflection happens. */
const CHANCE_HIT = 1;
/** The kinds of offer card: what the card's `kind` flag may say. A card with none (one posted before retaliation existed) is a reflection. */
const KINDS = Object.freeze({ reflect: 'reflect', retaliate: 'retaliate' });
/** Where each kind's earned rows and used indexes sit on the holder's undo record. */
const UNDO_FIELD = Object.freeze({ reflect: 'reflect', retaliate: 'retaliate' });

const plural = (n) => (n === 1 ? '' : 's');

/**
 * The offer record on a card, sanitized, or null when it is not one.
 * @param {object} message
 * `applicationId` and `reflectIndex` name the holder's stored damage application; the GM trusts that record, not these numbers (3.56a).
 * @returns {{ kind: 'reflect'|'retaliate', holderUuid: string, attackerUuid: string, slots: number, label: string, applied: boolean, applicationId: string, reflectIndex: number }|null}
 */
export function readReflectRecord(message) {
  const r = message?.flags?.[SYSTEM_ID]?.reflect;
  if (!r || typeof r !== 'object') return null;
  if (typeof r.holderUuid !== 'string' || !r.holderUuid || typeof r.attackerUuid !== 'string' || !r.attackerUuid) return null;
  const kind = r.kind === KINDS.retaliate ? KINDS.retaliate : KINDS.reflect;
  const slots = Math.floor(Number(r.slots));
  if (kind === KINDS.reflect && (!Number.isFinite(slots) || slots < 1)) return null;
  return {
    kind,
    holderUuid: r.holderUuid,
    attackerUuid: r.attackerUuid,
    slots: kind === KINDS.reflect ? Math.min(MAX_REFLECT_SLOTS, slots) : 0,
    label: typeof r.label === 'string' ? r.label.slice(0, 120) : '',
    applied: r.applied === true,
    applicationId: isApplicationId(r.applicationId) ? r.applicationId : '',
    reflectIndex: Number.isInteger(r.reflectIndex) && r.reflectIndex >= 0 ? r.reflectIndex : -1
  };
}

/**
 * The GM's check of an offer against the holder's stored damage application: the record exists, is not undone, names the
 * same attacker, and earned the row at `reflectIndex`. Everything the click does comes from that row, never from the card.
 * @returns {{ ok: true, kind: string, row: object, holder: object, spent: boolean }|{ ok: false, reason: string }}
 */
function verifyTrigger(record) {
  const holder = resolveActorByUuid(record.holderUuid);
  if (!holder || !record.applicationId) return { ok: false, reason: 'no-application' };
  const undo = findDamageUndoRecord(holder, record.applicationId);
  if (!undo || undo.undoneAt) return { ok: false, reason: 'no-application' };
  if (!undo.attackerUuid || undo.attackerUuid !== record.attackerUuid) return { ok: false, reason: 'attacker-mismatch' };
  const field = UNDO_FIELD[record.kind];
  const earned = record.kind === KINDS.retaliate
    ? (Array.isArray(undo.retaliate?.rows) ? undo.retaliate.rows : [])
    : earnedReflections(undo.reflect?.rows, undo.reflect?.slotsLost);
  const row = earned[record.reflectIndex];
  if (!row) return { ok: false, reason: 'not-earned' };
  if (Array.isArray(undo[field]?.used) && undo[field].used.includes(record.reflectIndex)) return { ok: false, reason: 'already-applied' };
  return { ok: true, kind: record.kind, row, holder, spent: limitSpent(holder, row) };
}

/** Whether the row's once-per limit is already used up in the current combat or floor (a row with no limit never is). */
function limitSpent(holder, row) {
  if ((row.oncePer !== 'combat' && row.oncePer !== 'floor') || typeof row.key !== 'string' || !row.key) return false;
  return usesSoFar(readFlag(holder, TRIGGER_USAGE_FLAG), currentTokens(holder), row.oncePer, row.key) >= 1;
}

/** Count one use of the row against the holder's limit record (one write at a time per holder). */
function recordUse(holder, row) {
  if ((row.oncePer !== 'combat' && row.oncePer !== 'floor') || typeof row.key !== 'string' || !row.key) return Promise.resolve();
  return runKeyed(`triggerUsage:${holder.uuid ?? ''}`, () => writeFlag(holder, TRIGGER_USAGE_FLAG, withUses(readFlag(holder, TRIGGER_USAGE_FLAG), currentTokens(holder), [{ scope: row.oncePer, key: row.key }])));
}

/**
 * What the clicking client asks before it relays or applies: the stored row's limit is already used up. The client reads the holder's undo
 * record (a flag every client sees); the GM still checks the real numbers when it applies.
 * @returns {{ label: string, scope: 'combat'|'floor' }|null} null when the card is not a trigger card or its limit is free
 */
function spentLimitOf(record) {
  const check = verifyTrigger(record);
  return check.ok && check.spent ? { label: String(check.row.label || record.label || ''), scope: check.row.oncePer } : null;
}

/**
 * The offer card's HTML. `applied` swaps the button for a note (`note` replaces the default text, as when a chance die missed).
 * @param {{ holderName: string, attackerName: string, label: string, slots?: number, applied?: boolean, kind?: string, chance?: string, formula?: string, damageType?: string, note?: string, ruleBreak?: boolean }} p
 */
export function reflectOfferHtml({ holderName, attackerName, label, slots = 0, applied = false, kind = KINDS.reflect, chance = '', formula = '', damageType = '', note = '', ruleBreak = false }) {
  const retaliate = kind === KINDS.retaliate;
  const fallbackLabel = retaliate ? RETALIATE_ATTACK_NAME : REFLECT_ATTACK_NAME;
  const name = escapeAttr(label || fallbackLabel);
  const typed = damageType ? ` ${damageType}` : '';
  const slotWords = `${slots} Health Bar slot${plural(slots)}`;
  let what;
  let buttonText;
  if (retaliate) {
    what = `${name}: deal <strong>${escapeAttr(formula)}</strong>${escapeAttr(typed)} damage to <strong>${escapeAttr(attackerName)}</strong>?`;
    buttonText = escapeAttr(`Deal ${formula}${typed} to ${attackerName}`);
  } else if (chance) {
    what = `${name}: roll <strong>${escapeAttr(chance)}</strong>; on a ${CHANCE_HIT}, <strong>${escapeAttr(attackerName)}</strong> loses <strong>${escapeAttr(slotWords)}</strong>.`;
    buttonText = escapeAttr(`Roll ${chance} (attacker loses ${slots} slot${plural(slots)} on a ${CHANCE_HIT})`);
  } else {
    what = `${name}: reflect <strong>${slots}</strong> Health Bar slot${plural(slots)} to <strong>${escapeAttr(attackerName)}</strong>?`;
    buttonText = escapeAttr(`Reflect ${slots} slot${plural(slots)}`);
  }
  const doneText = note ? escapeAttr(note) : (retaliate ? 'Retaliated.' : 'Reflected.');
  const action = applied
    ? `<div class="cog-text-success" style="font-size: 11px; margin-top: 4px;"><i class="fa-solid fa-check"></i> ${doneText}${ruleBreak ? ` ${ruleBreakBadgeHtml({ cls: '' })}` : ''}</div>`
    : `<button type="button" class="cog-reflect-btn" data-action="crawlerApplyReflect" style="margin-top: 4px; cursor: pointer;">${buttonText}</button>`;
  const headline = retaliate ? 'was hit and may hit back' : 'lost enough slots to reflect';
  return `
    <div class="cog-chat-card cog-reflect-card cog-bg-surface-alt" style="border: 2px solid var(--cog-warning); border-radius: 4px; padding: 8px 10px;">
      <div class="cog-text-gold" style="font-weight: bold; font-size: 13px;"><i class="fa-solid fa-shield-halved"></i> ${escapeAttr(holderName)} ${headline}</div>
      <div class="cog-text" style="font-size: 11px; margin-top: 4px;">${what}</div>
      ${action}
    </div>
  `;
}

/**
 * Whisper one offer card per earned row to the holder's owners and the GM.
 * @param {{ holder: Actor, attacker: Actor|null, reflections?: Array<{ label: string, slots: number, chance?: string }>, retaliations?: Array<{ label: string, formula: string, damageType?: string }>, applicationId: string }} p
 * @returns {Promise<object[]>} the posted messages
 */
export async function postReflectOffers({ holder, attacker, reflections = [], retaliations = [], applicationId = '' }) {
  const posted = [];
  if (!holder || !attacker || !globalThis.ChatMessage?.create) return posted;
  const post = async (content, record) => {
    posted.push(await globalThis.ChatMessage.create({
      speaker: globalThis.ChatMessage.getSpeaker?.({ actor: holder }) || { alias: holder.name },
      whisper: ownerAndGmIds(holder),
      content,
      flags: { [SYSTEM_ID]: { reflect: { holderUuid: holder.uuid, attackerUuid: attacker.uuid, applied: false, applicationId, ...record } } }
    }));
  };
  for (const [reflectIndex, refl] of (Array.isArray(reflections) ? reflections : []).entries()) {
    const slots = Math.min(MAX_REFLECT_SLOTS, Math.max(1, Math.floor(Number(refl.slots) || 1)));
    const chance = typeof refl.chance === 'string' ? refl.chance : '';
    await post(reflectOfferHtml({ holderName: holder.name, attackerName: attacker.name, label: refl.label, slots, chance }), { kind: KINDS.reflect, slots, label: String(refl.label ?? ''), reflectIndex });
  }
  for (const [reflectIndex, row] of (Array.isArray(retaliations) ? retaliations : []).entries()) {
    await post(reflectOfferHtml({ holderName: holder.name, attackerName: attacker.name, label: row.label, kind: KINDS.retaliate, formula: row.formula, damageType: row.damageType }), { kind: KINDS.retaliate, label: String(row.label ?? ''), reflectIndex });
  }
  return posted;
}

/** A user may trigger the card: a GM, or an owner of the holder on a card a GM or that owner wrote. */
function mayReflect(message, user, record = readReflectRecord(message)) {
  if (!record || !user) return false;
  if (user.isGM) return true;
  const holder = resolveActorByUuid(record.holderUuid);
  if (!holder?.testUserPermission?.(user, 'OWNER')) return false;
  const author = globalThis.game?.users?.get?.(messageAuthorId(message));
  return Boolean(author) && (Boolean(author.isGM) || Boolean(holder.testUserPermission?.(author, 'OWNER')));
}

/**
 * Roll a trigger's dice and show the roll in chat. Returns the total.
 * @param {string} formula
 * @param {Actor} holder who the roll is for
 * @param {string} flavor
 */
async function rollTrigger(formula, holder, flavor) {
  const roll = await new Roll(formula).evaluate();
  await roll.toMessage?.({ speaker: globalThis.ChatMessage?.getSpeaker?.({ actor: holder }) ?? { alias: holder?.name }, flavor: escapeAttr(flavor) });
  return Number(roll.total) || 0;
}

/**
 * Apply the offer (GM client). The holder's stored damage application decides whether it is owed and what it does
 * (`verifyTrigger`). Calls for one message run one after another, and the card and the application are marked used before anything
 * is rolled or written, so a second request does nothing. A row whose once-per limit is spent needs `ruleBreak`, which the clicking
 * client has already asked for.
 * @param {object} message
 * @param {{ ruleBreak?: boolean }} [options]
 * @returns {Promise<{ applied: boolean, reason?: string, result?: object, slots?: number, rolled?: number, dealt?: number }>}
 */
export function applyReflection(message, options = {}) {
  return runKeyed(message?.id, () => applyReflectionNow(message, options));
}

async function applyReflectionNow(message, { ruleBreak = false } = {}) {
  const record = readReflectRecord(message);
  if (!record) return { applied: false, reason: 'invalid' };
  if (record.applied) return { applied: false, reason: 'already-applied' };
  const attacker = resolveActorByUuid(record.attackerUuid);
  if (!attacker) return { applied: false, reason: 'no-attacker' };
  const check = verifyTrigger(record);
  if (!check.ok) return { applied: false, reason: check.reason };
  if (check.spent && !ruleBreak) return { applied: false, reason: 'limit-spent' };
  const { holder, row } = check;
  const breaking = check.spent;
  const field = UNDO_FIELD[record.kind];
  const retaliate = record.kind === KINDS.retaliate;
  const slots = retaliate ? 0 : Math.min(MAX_REFLECT_SLOTS, Math.max(1, Math.floor(Number(row.slots) || 1)));
  const face = { holderName: holder?.name ?? '', attackerName: attacker.name, label: record.label, slots, kind: record.kind, chance: row.chance ?? '', formula: row.formula ?? '', damageType: row.damageType ?? '', ruleBreak: breaking };
  await markDamageUndoReflected(holder, record.applicationId, record.reflectIndex, true, field);
  await message.update({ [`flags.${SYSTEM_ID}.reflect.applied`]: true, ...(breaking ? ruleBreakUpdate() : {}) });
  const rollBack = async () => {
    await message.update({ [`flags.${SYSTEM_ID}.reflect.applied`]: false });
    await markDamageUndoReflected(holder, record.applicationId, record.reflectIndex, false, field);
  };
  let result;
  let rolled = null;
  let dealt = null;
  try {
    if (retaliate) {
      dealt = await rollTrigger(row.formula, holder, record.label || RETALIATE_ATTACK_NAME);
      result = await COGDamage.applyDamageToTarget({
        targetActor: attacker, attackerActor: holder, rawDamage: dealt, damageType: row.damageType || '',
        attackName: record.label || RETALIATE_ATTACK_NAME, attackType: 'Retaliation', noTriggers: true, messageId: message.id ?? null
      });
    } else if (row.chance) {
      rolled = await rollTrigger(row.chance, holder, record.label || REFLECT_ATTACK_NAME);
    }
    const reflects = !retaliate && (rolled === null || rolled === CHANCE_HIT);
    if (reflects) {
      result = await COGDamage.applyDamageToTarget({
        targetActor: attacker, slotLoss: slots, attackerActor: holder, attackName: REFLECT_ATTACK_NAME, attackType: 'Reflection',
        noTriggers: true, messageId: message.id ?? null
      });
    }
  } catch (err) {
    await rollBack();
    throw err;
  }
  await recordUse(holder, row);
  const note = !retaliate && rolled !== null && rolled !== CHANCE_HIT ? `Rolled ${rolled}: nothing is reflected.` : '';
  await message.update({ content: reflectOfferHtml({ ...face, applied: true, note }) });
  if (result?.applicationId && !result.error) {
    await indexDamageApplication(message, {
      applicationId: result.applicationId, targetUuid: attacker.uuid, targetName: attacker.name,
      actualDamage: result.actualDamage, lines: result.perTarget?.lines
    });
  }
  return { applied: true, result, slots, ...(rolled !== null ? { rolled } : {}), ...(dealt !== null ? { dealt } : {}) };
}

registerRelayAction(REFLECT_RELAY, {
  authorize(payload, user) {
    const message = globalThis.game?.messages?.get?.(payload?.messageId);
    return Boolean(message) && mayReflect(message, user);
  },
  async apply(payload) {
    const message = globalThis.game?.messages?.get?.(payload?.messageId);
    if (!message) throw new Error('Damage Reflection: the card no longer exists.');
    const res = await applyReflection(message, { ruleBreak: payload?.ruleBreak === true });
    return { applied: res.applied, reason: res.reason ?? null, slots: res.slots ?? null, rolled: res.rolled ?? null, dealt: res.dealt ?? null };
  }
});

/**
 * The offer card's button.
 * @param {Event} event
 * @param {HTMLElement} button
 * @param {ChatMessage} message
 */
export async function handleApplyReflect(event, button, message) {
  const record = readReflectRecord(message);
  const warn = (text) => globalThis.ui?.notifications?.warn?.(`Sprinter RPG | ${text}`);
  if (!record) return;
  if (record.applied) {
    warn('This offer was already used.');
    return;
  }
  const user = globalThis.game?.user;
  if (!mayReflect(message, user, record)) {
    warn('Only the GM or the owner of the item holder can use this offer.');
    return;
  }
  // The limit is asked here, on the client whose user clicked, then the GM is told it was confirmed.
  const spent = spentLimitOf(record);
  let ruleBreak = false;
  if (spent) {
    const asked = await confirmRuleBreak({
      title: `Once Per ${spent.scope === 'floor' ? 'Floor' : 'Combat'}`,
      message: escapeAttr(`${spent.label || 'This offer'} was already used this ${spent.scope}. Use it again as a Rule Break?`)
    });
    if (!asked.confirmed) return;
    ruleBreak = true;
  }
  button.disabled = true;
  const res = await requestRelay(REFLECT_RELAY, { messageId: message.id, ruleBreak }, { direct: Boolean(user?.isGM) });
  if (!res.ok) {
    button.disabled = false;
    if (!isNoGmReason(res.reason)) warn('The GM did not apply the offer.');
    return;
  }
  const attacker = resolveActorByUuid(record.attackerUuid);
  const who = attacker?.name ?? 'The attacker';
  const info = (text) => globalThis.ui?.notifications?.info?.(`Sprinter RPG | ${text}`);
  const out = res.result;
  if (out?.applied) {
    if (record.kind === KINDS.retaliate) info(`${who} takes ${out.dealt ?? 0} damage.`);
    else if (out.rolled !== null && out.rolled !== undefined && out.rolled !== CHANCE_HIT) info(`Rolled ${out.rolled}: nothing is reflected.`);
    else info(`${who} loses ${out.slots ?? record.slots} Health Bar slot${plural(out.slots ?? record.slots)}.`);
  } else if (out?.reason === 'already-applied') warn('This offer was already used.');
  else if (out?.reason === 'limit-spent') button.disabled = false;
  else if (out?.reason) warn('The GM could not match this offer to a damage application.');
}
