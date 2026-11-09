/**
 * Aura movement hooks: when a token moves, appears or goes, the active GM re-syncs who is inside
 * every aura on that scene. Membership comes from our own distance maths, never from the Region's token list
 * (an attached Region recomputes with `noHook: true`), and the Region itself follows the caster through
 * `attachment.token`, so there is nothing to move here.
 */
import { isActiveGM } from '../utils/gm-relay.mjs';
import { isMarkerActor } from '../utils/area/marker.mjs';
import { centreAfterMovement } from '../utils/combat/movement-position.mjs';
import { activeAurasOnScene, syncAuraMembership, withAuraLock } from '../documents/actor/aura-pulse.mjs';

/** Moves for one scene that arrive within this window share one sync (a drag fires many). Tests may lower it. */
export const auraMovementConfig = { debounceMs: 75 };

/** Scene id -> the sync waiting to run. */
const pending = new Map();

/** The scene's tokens move or change: skip markers and tokens with no actor (they never carry or join an aura). */
const relevant = (tokenDoc) => {
  const actor = tokenDoc?.actor;
  return Boolean(actor) && !isMarkerActor(actor);
};

/** The aura items whose caster token is this one (a deleted token is no longer on the scene to be found). */
function aurasOfToken(tokenDoc, scene) {
  const holder = tokenDoc.actor;
  const items = holder?.items?.contents ?? Array.from(holder?.items ?? []);
  return items
    .filter(item => item?.system?.active && item.system.auraState?.tokenId === tokenDoc.id
      && (!item.system.auraState.sceneId || item.system.auraState.sceneId === scene?.id))
    .map(item => ({ holder, item }));
}

async function syncScene(scene, extra, centres) {
  if (!isActiveGM()) return;
  const found = [...activeAurasOnScene(scene, { combat: globalThis.game?.combat ?? null })];
  for (const entry of extra) if (!found.some(f => (f.item.uuid || f.item.id) === (entry.item.uuid || entry.item.id))) found.push(entry);
  await Promise.all(found.map(({ holder, item }) => withAuraLock(item.uuid, () => syncAuraMembership(holder, item, { centres }))));
}

/**
 * Queue a membership sync of every aura on the token's scene. Calls for the same scene inside the debounce window
 * coalesce into one run; the returned promise settles when that run is done.
 * @param {TokenDocument} tokenDoc
 * @param {{ deleted?: boolean, movement?: object|null }} [options] `movement`: the `moveToken` payload; the token is
 *   measured at its destination, since its document still holds the origin when the sync runs
 * @returns {Promise<void>}
 */
export function queueAuraSync(tokenDoc, { deleted = false, movement = null } = {}) {
  if (!isActiveGM() || !relevant(tokenDoc)) return Promise.resolve();
  const scene = tokenDoc.parent ?? globalThis.canvas?.scene;
  const key = scene?.id ?? '';
  let entry = pending.get(key);
  if (!entry) {
    entry = { extra: [], centres: new Map() };
    entry.promise = new Promise(resolve => {
      setTimeout(async () => {
        pending.delete(key);
        try { await syncScene(scene, entry.extra, entry.centres); } catch (err) { console.error('sprinter-rpg | aura sync failed', err); }
        resolve();
      }, auraMovementConfig.debounceMs);
    });
    pending.set(key, entry);
  }
  if (movement && !deleted) {
    const size = Number(globalThis.canvas?.grid?.size) || Number(scene?.grid?.size) || 50;
    entry.centres.set(tokenDoc.id, centreAfterMovement(tokenDoc, movement, size));
  }
  if (deleted) entry.extra.push(...aurasOfToken(tokenDoc, scene));
  return entry.promise;
}

export function onAuraTokenMove(tokenDoc, movement) { return queueAuraSync(tokenDoc, { movement }); }
export function onAuraTokenCreate(tokenDoc) { return queueAuraSync(tokenDoc); }
export function onAuraTokenDelete(tokenDoc) { return queueAuraSync(tokenDoc, { deleted: true }); }

export function registerAuraMovementHooks() {
  Hooks.on('moveToken', onAuraTokenMove);
  Hooks.on('createToken', onAuraTokenCreate);
  Hooks.on('deleteToken', onAuraTokenDelete);
}
