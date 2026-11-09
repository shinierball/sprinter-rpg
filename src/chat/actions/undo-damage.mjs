/**
 * "Undo" button on a damage application row.
 *
 * Authorization follows 2.2c option (b): the GM may undo anything, a player only on targets they own. With a
 * GM connected a player's undo goes through the GM (as damage does). The request carries ids only
 * ({ messageId, applicationId, targetUuid }); every number comes from the record on the target.
 *
 * Known limits:
 *  - No-GM apply by a non-author: a player who applies damage from a card they did not author, with no GM
 *    connected, cannot write the message index, so that application gets no Undo row. The record still
 *    exists on the actor.
 *  - Records per actor: each actor keeps 20 records. Older applications report "can no longer be undone".
 *  - Inflicted conditions: conditions or debuffs applied by the same damage button are removed if still present.
 *  - Manual aggregate adjustments: manual adjustments to session crawler stats are preserved via adjustment
 *    ledger entries across undo and delete operations.
 *  - Archived combats are not touched.
 *  - Temp bars replaced since the hit are not restored (tempBarsSkipped).
 */
import { COGCombatMetrics } from '../../documents/combat-metrics.mjs';
import { findDamageUndoRecord, isApplicationId } from '../../utils/damage/damage-undo.mjs';
import { resolveActorByUuid } from '../../utils/actor-uuid.mjs';
import { getActiveGM, registerRelayAction, requestRelay } from '../../utils/gm-relay.mjs';
import { canWriteTarget } from '../chat-relay.mjs';
import { markDamageApplicationUndone } from '../damage-applications.mjs';

export const DAMAGE_UNDO_RELAY = 'chatDamageUndo';

/** Pure: { applicationId, targetUuid } from the button's data attributes, or null if either is invalid. */
export function parseUndoDamage(button) {
  const applicationId = button?.dataset?.applicationId;
  const targetUuid = button?.dataset?.targetUuid;
  if (!isApplicationId(applicationId) || typeof targetUuid !== 'string' || !targetUuid) return null;
  return { applicationId, targetUuid };
}

/**
 * Local (true) or through the GM (false). The caller has already checked ownership.
 */
function canUndoDamageLocally(target, applicationId) {
  const user = game.user;
  if (!user || user.isGM) return true;
  if (getActiveGM()) return false;
  const record = findDamageUndoRecord(target, applicationId);
  if (!record || record.undoneAt) return true;
  if (record.appliedByGM) return false;
  if (record.killTrophy) {
    const attacker = record.attackerUuid ? resolveActorByUuid(record.attackerUuid) : null;
    if (attacker && !canWriteTarget(attacker)) return false;
  }
  return canWriteTarget(target);
}

/** GM side: { message|null, applicationId, target } or null. Every other payload key is ignored. */
export function resolveUndoRequest(payload) {
  const reject = (reason) => {
    console.warn(`Sprinter RPG | Damage undo rejected: ${reason}`);
    return null;
  };
  if (!payload || typeof payload !== 'object') return reject('payload is not an object');
  const { messageId, applicationId, targetUuid } = payload;
  if (!isApplicationId(applicationId)) return reject('bad application id');
  if (typeof targetUuid !== 'string' || !targetUuid) return reject('bad target uuid');
  if (messageId != null && typeof messageId !== 'string') return reject('bad message id');
  const target = resolveActorByUuid(targetUuid);
  if (!target) return reject('target does not resolve');
  const message = messageId ? (globalThis.game?.messages?.get?.(messageId) ?? null) : null;
  return { message, applicationId, target };
}

registerRelayAction(DAMAGE_UNDO_RELAY, {
  authorize(payload, user) {
    const req = resolveUndoRequest(payload);
    if (!req) return false;
    return Boolean(user?.isGM || req.target.testUserPermission?.(user, 'OWNER'));
  },
  async apply(payload) {
    const req = resolveUndoRequest(payload);
    if (!req) throw new Error('Damage undo: request no longer resolves.');
    const result = await COGCombatMetrics.undoDamageApplication(req.target, req.applicationId);
    if (result.status !== 'not-found') await markDamageApplicationUndone(req.message, req.applicationId, req.target.uuid);
    return JSON.parse(JSON.stringify(result));
  }
});

/**
 * @param {Event} event
 * @param {HTMLElement} button the [data-action] element
 * @param {ChatMessage} message
 */
export async function handleUndoDamage(event, button, message) {
  const p = parseUndoDamage(button);
  if (!p) return;
  const warn = (m) => ui.notifications?.warn(m);
  const info = (m) => ui.notifications?.info(m);

  const target = resolveActorByUuid(p.targetUuid);
  if (!target) {
    warn('Sprinter RPG | That target no longer exists.');
    return;
  }
  if (!game.user.isGM && !canWriteTarget(target)) {
    warn(`Sprinter RPG | Only the GM can undo damage on ${target.name}.`);
    return;
  }

  let result;
  if (canUndoDamageLocally(target, p.applicationId)) {
    result = await COGCombatMetrics.undoDamageApplication(target, p.applicationId);
    if (result.status !== 'not-found') await markDamageApplicationUndone(message, p.applicationId, target.uuid);
  } else {
    const res = await requestRelay(
      DAMAGE_UNDO_RELAY,
      { messageId: message?.id ?? null, applicationId: p.applicationId, targetUuid: target.uuid },
      { direct: false }
    );
    if (!res.ok) {
      if (res.reason === 'rejected' || res.reason === 'error') warn(`Sprinter RPG | The GM did not undo this on ${target.name}.`);
      return;
    }
    result = res.result;
  }

  const name = target.name;
  if (result.status === 'undone') {
    info(`Sprinter RPG | Undid damage on ${name}: +${result.hpRestored} HP`
      + (result.tempRestored ? `, +${result.tempRestored} temp HP` : '')
      + (result.tempBarsSkipped ? ' (bonus bars changed since, not restored)' : '') + '.');
  } else if (result.status === 'already-undone') {
    info(`Sprinter RPG | That damage on ${name} was already undone.`);
  } else {
    warn(`Sprinter RPG | That damage on ${name} can no longer be undone.`);
  }
  if (result.status === 'undone' || result.status === 'already-undone') {
    button.disabled = true;
    button.closest?.('.cog-damage-application')?.classList.add('is-undone');
  }
}
