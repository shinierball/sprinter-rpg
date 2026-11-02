/**
 * Sheet-to-sheet item drops are transfers: the copy is created on the target actor, then the original is deleted
 * from the source actor. Sidebar, compendium and world-item drags have no source actor and still copy.
 * The source delete runs through the actor delete hooks (an equipped aura item ends its aura there); a user who
 * cannot delete from the source asks the GM through the relay. With no GM connected the copy stays on the source.
 */
import { registerRelayAction, requestRelay, isNoGmReason } from '../../utils/gm-relay.mjs';
import { resolveActorByUuid } from '../../utils/actor-uuid.mjs';

export const ITEM_TRANSFER_RELAY = 'transferItemDelete';

/** The actor a dropped item currently belongs to, or null for world / compendium items. */
function sourceActorOf(item) {
  const parent = item?.parent;
  return parent?.documentName === 'Actor' ? parent : null;
}

/** True when the dropped item is embedded on an actor other than `targetActor`. */
export function isCrossActorDrop(item, targetActor) {
  const source = sourceActorOf(item);
  return Boolean(source && source.uuid !== targetActor?.uuid);
}

function resolveRequest(payload) {
  const source = resolveActorByUuid(payload?.sourceActorUuid);
  const target = resolveActorByUuid(payload?.targetActorUuid);
  const item = source?.items?.get(payload?.itemId);
  return source && target && item ? { source, target, item } : null;
}

registerRelayAction(ITEM_TRANSFER_RELAY, {
  authorize(payload, user) {
    const req = resolveRequest(payload);
    if (!req) return false;
    if (user?.isGM) return true;
    return Boolean(req.target.testUserPermission?.(user, 'OWNER') && req.source.testUserPermission?.(user, 'OBSERVER'));
  },
  async apply(payload) {
    const req = resolveRequest(payload);
    if (!req) throw new Error('Item transfer: the source item no longer exists.');
    await req.item.delete();
    return true;
  }
});

/**
 * Finish a transfer after the copy was created on `targetActor`. No-op for same-actor and non-actor sources.
 * @param {Item} item the dragged (source) item
 * @param {Actor} targetActor
 * @returns {Promise<boolean>} true when the source was deleted
 */
export async function completeItemTransfer(item, targetActor) {
  if (!isCrossActorDrop(item, targetActor)) return false;
  const source = sourceActorOf(item);
  const payload = { sourceActorUuid: source.uuid, targetActorUuid: targetActor.uuid, itemId: item.id };
  const res = await requestRelay(ITEM_TRANSFER_RELAY, payload, { direct: Boolean(source.isOwner) });
  if (!res.ok) {
    if (!isNoGmReason(res.reason)) {
      globalThis.ui?.notifications?.warn(`Sprinter RPG | Could not remove "${item.name}" from ${source.name}; the copy was left on the source.`);
    }
    return false;
  }
  return true;
}
