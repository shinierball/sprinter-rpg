/**
 * Damage Reflection offer card and its "Reflect" button.
 *
 * `applyDamageTo` posts the offer when a `reflect` row's threshold was reached (`res.reflections`); the card is whispered to
 * the holder's owners and the GM. The click makes the attacker lose slots through `COGDamage.applyDamageToTarget({ slotLoss })`. Every
 * number comes from the holder's stored damage application, never from the card or the button. A GM applies directly; a player asks the GM through the
 * relay (the attacker is usually not theirs), and the GM checks that the player owns the holder named on the card.
 */
import { SYSTEM_ID } from '../../constants.mjs';
import { COGDamage } from '../../documents/actor/damage-pipeline.mjs';
import { resolveActorByUuid } from '../../utils/actor-uuid.mjs';
import { escapeAttr } from '../../utils/escape-attr.mjs';
import { registerRelayAction, requestRelay, isNoGmReason } from '../../utils/gm-relay.mjs';
import { messageAuthorId } from '../chat-relay.mjs';
import { indexDamageApplication } from '../damage-applications.mjs';
import { findDamageUndoRecord, isApplicationId, markDamageUndoReflected } from '../../utils/damage/damage-undo.mjs';
import { earnedReflections } from '../../utils/damage/damage-reflection.mjs';
import { runKeyed } from '../../utils/keyed-queue.mjs';

export const REFLECT_RELAY = 'chatReflectApply';
const REFLECT_ATTACK_NAME = 'Damage Reflection';
const MAX_REFLECT_SLOTS = 100;

const plural = (n) => (n === 1 ? '' : 's');

/**
 * The reflect record on an offer card, sanitized, or null when it is not one.
 * @param {object} message
 * `applicationId` and `reflectIndex` name the holder's stored damage application; the GM trusts that record, not these numbers (3.56a).
 * @returns {{ holderUuid: string, attackerUuid: string, slots: number, label: string, applied: boolean, applicationId: string, reflectIndex: number }|null}
 */
export function readReflectRecord(message) {
  const r = message?.flags?.[SYSTEM_ID]?.reflect;
  if (!r || typeof r !== 'object') return null;
  if (typeof r.holderUuid !== 'string' || !r.holderUuid || typeof r.attackerUuid !== 'string' || !r.attackerUuid) return null;
  const slots = Math.floor(Number(r.slots));
  if (!Number.isFinite(slots) || slots < 1) return null;
  return {
    holderUuid: r.holderUuid,
    attackerUuid: r.attackerUuid,
    slots: Math.min(MAX_REFLECT_SLOTS, slots),
    label: typeof r.label === 'string' ? r.label.slice(0, 120) : '',
    applied: r.applied === true,
    applicationId: isApplicationId(r.applicationId) ? r.applicationId : '',
    reflectIndex: Number.isInteger(r.reflectIndex) && r.reflectIndex >= 0 ? r.reflectIndex : -1
  };
}

/**
 * The GM's check of an offer against the holder's stored damage application: the record exists, is not undone, names the
 * same attacker, and earned the reflection at `reflectIndex`. The slots come from the record, never from the card.
 * @returns {{ ok: true, slots: number, label: string }|{ ok: false, reason: string }}
 */
function verifyReflection(record) {
  const holder = resolveActorByUuid(record.holderUuid);
  if (!holder || !record.applicationId) return { ok: false, reason: 'no-application' };
  const undo = findDamageUndoRecord(holder, record.applicationId);
  if (!undo || undo.undoneAt) return { ok: false, reason: 'no-application' };
  if (!undo.attackerUuid || undo.attackerUuid !== record.attackerUuid) return { ok: false, reason: 'attacker-mismatch' };
  const earned = earnedReflections(undo.reflect?.rows, undo.reflect?.slotsLost);
  const row = earned[record.reflectIndex];
  if (!row) return { ok: false, reason: 'not-earned' };
  if (Array.isArray(undo.reflect?.used) && undo.reflect.used.includes(record.reflectIndex)) return { ok: false, reason: 'already-applied' };
  const slots = Math.min(MAX_REFLECT_SLOTS, Math.max(1, Math.floor(Number(row.slots) || 1)));
  return { ok: true, slots, label: String(row.label ?? '') };
}

/** The offer card's HTML. `applied` swaps the button for a note. */
export function reflectOfferHtml({ holderName, attackerName, label, slots, applied = false }) {
  const what = `${escapeAttr(label || REFLECT_ATTACK_NAME)}: reflect <strong>${slots}</strong> Health Bar slot${plural(slots)} to <strong>${escapeAttr(attackerName)}</strong>?`;
  const action = applied
    ? `<div class="cog-text-success" style="font-size: 11px; margin-top: 4px;"><i class="fa-solid fa-check"></i> Reflected.</div>`
    : `<button type="button" class="cog-reflect-btn" data-action="crawlerApplyReflect" style="margin-top: 4px; cursor: pointer;">Reflect ${slots} slot${plural(slots)}</button>`;
  return `
    <div class="cog-chat-card cog-reflect-card cog-bg-surface-alt" style="border: 2px solid var(--cog-warning); border-radius: 4px; padding: 8px 10px;">
      <div class="cog-text-gold" style="font-weight: bold; font-size: 13px;"><i class="fa-solid fa-shield-halved"></i> ${escapeAttr(holderName)} lost enough slots to reflect</div>
      <div class="cog-text" style="font-size: 11px; margin-top: 4px;">${what}</div>
      ${action}
    </div>
  `;
}

function userIdsFor(holder) {
  const users = Array.from(globalThis.game?.users?.contents ?? globalThis.game?.users ?? []);
  return users.filter(u => u?.isGM || holder?.testUserPermission?.(u, 'OWNER')).map(u => u.id);
}

/**
 * Whisper one offer card per earned reflection to the holder's owners and the GM.
 * @param {{ holder: Actor, attacker: Actor|null, reflections: Array<{ label: string, slots: number }>, applicationId: string }} p
 * @returns {Promise<object[]>} the posted messages
 */
export async function postReflectOffers({ holder, attacker, reflections, applicationId = '' }) {
  const posted = [];
  if (!holder || !attacker || !Array.isArray(reflections) || !globalThis.ChatMessage?.create) return posted;
  for (const [reflectIndex, refl] of reflections.entries()) {
    const slots = Math.min(MAX_REFLECT_SLOTS, Math.max(1, Math.floor(Number(refl.slots) || 1)));
    const msg = await globalThis.ChatMessage.create({
      speaker: globalThis.ChatMessage.getSpeaker?.({ actor: holder }) || { alias: holder.name },
      whisper: userIdsFor(holder),
      content: reflectOfferHtml({ holderName: holder.name, attackerName: attacker.name, label: refl.label, slots }),
      flags: { [SYSTEM_ID]: { reflect: { holderUuid: holder.uuid, attackerUuid: attacker.uuid, slots, label: String(refl.label ?? ''), applied: false, applicationId, reflectIndex } } }
    });
    posted.push(msg);
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
 * Apply the reflection (GM client). The holder's stored damage application decides whether it is owed and for how many
 * slots (`verifyReflection`). Calls for one message run one after another, and the card and the application are marked
 * used before the damage is written, so a second request does nothing.
 * @returns {Promise<{ applied: boolean, reason?: string, result?: object }>}
 */
export function applyReflection(message) {
  return runKeyed(message?.id, () => applyReflectionNow(message));
}

async function applyReflectionNow(message) {
  const record = readReflectRecord(message);
  if (!record) return { applied: false, reason: 'invalid' };
  if (record.applied) return { applied: false, reason: 'already-applied' };
  const attacker = resolveActorByUuid(record.attackerUuid);
  const holder = resolveActorByUuid(record.holderUuid);
  if (!attacker) return { applied: false, reason: 'no-attacker' };
  const check = verifyReflection(record);
  if (!check.ok) return { applied: false, reason: check.reason };
  const slots = check.slots;
  await markDamageUndoReflected(holder, record.applicationId, record.reflectIndex);
  await message.update({ [`flags.${SYSTEM_ID}.reflect.applied`]: true });
  let result;
  try {
    result = await COGDamage.applyDamageToTarget({
      targetActor: attacker, slotLoss: slots, attackerActor: holder, attackName: REFLECT_ATTACK_NAME, attackType: 'Reflection',
      messageId: message.id ?? null
    });
  } catch (err) {
    await message.update({ [`flags.${SYSTEM_ID}.reflect.applied`]: false });
    await markDamageUndoReflected(holder, record.applicationId, record.reflectIndex, false);
    throw err;
  }
  await message.update({
    content: reflectOfferHtml({ holderName: holder?.name ?? '', attackerName: attacker.name, label: record.label, slots, applied: true })
  });
  if (result?.applicationId && !result.error) {
    await indexDamageApplication(message, {
      applicationId: result.applicationId, targetUuid: attacker.uuid, targetName: attacker.name,
      actualDamage: result.actualDamage, lines: result.perTarget?.lines
    });
  }
  return { applied: true, result, slots };
}

registerRelayAction(REFLECT_RELAY, {
  authorize(payload, user) {
    const message = globalThis.game?.messages?.get?.(payload?.messageId);
    return Boolean(message) && mayReflect(message, user);
  },
  async apply(payload) {
    const message = globalThis.game?.messages?.get?.(payload?.messageId);
    if (!message) throw new Error('Damage Reflection: the card no longer exists.');
    const res = await applyReflection(message);
    return { applied: res.applied, reason: res.reason ?? null, slots: res.slots ?? null };
  }
});

/**
 * "Reflect" button on an offer card.
 * @param {Event} event
 * @param {HTMLElement} button
 * @param {ChatMessage} message
 */
export async function handleApplyReflect(event, button, message) {
  const record = readReflectRecord(message);
  const warn = (text) => globalThis.ui?.notifications?.warn?.(`Sprinter RPG | ${text}`);
  if (!record) return;
  if (record.applied) {
    warn('This reflection was already used.');
    return;
  }
  const user = globalThis.game?.user;
  if (!mayReflect(message, user, record)) {
    warn('Only the GM or the owner of the item holder can reflect this damage.');
    return;
  }
  button.disabled = true;
  const res = await requestRelay(REFLECT_RELAY, { messageId: message.id }, { direct: Boolean(user?.isGM) });
  if (!res.ok) {
    button.disabled = false;
    if (!isNoGmReason(res.reason)) warn('The GM did not apply the reflection.');
    return;
  }
  const attacker = resolveActorByUuid(record.attackerUuid);
  if (res.result?.applied) globalThis.ui?.notifications?.info?.(`Sprinter RPG | ${attacker?.name ?? 'The attacker'} loses ${res.result.slots ?? record.slots} Health Bar slot${plural(res.result.slots ?? record.slots)}.`);
  else if (res.result?.reason === 'already-applied') warn('This reflection was already used.');
  else if (res.result?.reason) warn('The GM could not match this reflection to a damage application.');
}
