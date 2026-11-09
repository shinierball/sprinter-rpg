/**
 * Keeping actors in step with the zero zone. The zone state is derived while an actor is prepared and never written, so
 * when the zone flips (or a client loads a scene) every client re-prepares the affected actors. Only the active GM writes
 * what is stored on documents: token vision that comes from worn senses, and the gear auras.
 *
 * Every write here is the active GM's own, so no socketlib or relay call is needed; a client that is not the active GM
 * (a player, or a second GM) re-prepares and re-renders only.
 */
import { gearOfflineState, isGearSuppressed } from './gear-suppression.mjs';
import { isGearAura, isActivatedGearAura } from '../../documents/actor/gear-aura.mjs';
import { applyTokenVision } from '../../documents/actor/actor-vision.mjs';

/** True on the one connected GM client that runs system automation. */
export function isActiveGMSelf() {
  return globalThis.game?.users?.activeGM?.isSelf === true;
}

/** A subject is any actor that derives gear and Buff state (prepared with `system.gearOffline`), mobs and NPCs included. */
export function isGearSubject(actor) {
  return Boolean(actor?.system?.gearOffline);
}

const listOf = (coll) => (!coll ? [] : (Array.isArray(coll.contents) ? coll.contents : Array.from(coll.values?.() ?? coll)));

/** World actors plus the unlinked token actors of the scene on the canvas, de-duplicated, subjects only. */
export function subjectActorsInView() {
  const found = new Set(listOf(globalThis.game?.actors));
  for (const token of listOf(globalThis.canvas?.scene?.tokens)) {
    if (token?.actorLink === false && token.actor) found.add(token.actor);
  }
  return [...found].filter(isGearSubject);
}

/**
 * Re-vision and re-aura one actor for the zone it is in now. Active GM only (the caller checks). Idempotent: vision writes
 * only what differs, and an aura is touched only when its on/off state is wrong for the zone.
 *
 * - Going offline: every active passive gear aura that is suppressed ends. An activated gear aura ends only on a real
 *   transition (`transition: true`): a later sweep must not undo one the wearer started with a confirmed Rule Break.
 * - Coming back: every equipped passive gear aura that is not active starts again. Activated ones are never auto-started.
 * @param {object} actor
 * @param {boolean} offline the zone state after the re-prepare
 * @param {{ transition?: boolean, applyTokenVision?: Function }} [opts]
 */
export async function reconcileOfflineEffects(actor, offline, { transition = false, applyTokenVision: vision = applyTokenVision } = {}) {
  if (!actor) return;
  await vision(actor);
  const auras = Array.from(actor.items ?? []).filter(isGearAura);
  for (const item of auras) {
    const activated = isActivatedGearAura(item);
    if (offline) {
      if (!item.system.active || !isGearSuppressed(actor, item, 'aura')) continue;
      if (activated && !transition) continue;
      await actor.deactivateAura(item);
    } else if (!activated && item.system.equipped && !item.system.active) {
      await actor.activateAura(item);
    }
  }
}

/** The token HUD re-renders from src/hooks/ready.mjs when it shows this actor; an engine never imports a window (GEMINI 🧱 1). */
function refreshHud(actor) {
  globalThis.Hooks?.callAll?.('cogGearOfflineRefreshed', actor);
}

/**
 * Re-prepare the given actors for the current zone state (every client). Re-render those whose state changed. On the active
 * GM, also reconcile vision and gear auras.
 * @param {Iterable<object>} actors
 * @param {{ reconcile?: boolean }} [opts] `reconcile: false` skips the GM writes
 */
export async function refreshGearOffline(actors, { reconcile = true } = {}) {
  const gm = reconcile && isActiveGMSelf();
  for (const actor of Array.from(actors ?? [])) {
    if (!isGearSubject(actor)) continue;
    const before = actor.system.gearOffline.active === true;
    if (typeof actor.reset === 'function') actor.reset();
    else actor.prepareData?.();
    // A failed derivation leaves no snapshot; read the zone directly then.
    const after = (actor.system?.gearOffline ?? gearOfflineState(actor)).active === true;
    const changed = before !== after;
    if (changed) {
      actor.render?.(false);
      try {
        for (const token of actor.getActiveTokens?.() ?? []) token.renderFlags?.set?.({ refreshBars: true });
      } catch { /* No canvas. */ }
      await refreshHud(actor);
    }
    if (gm) await reconcileOfflineEffects(actor, after, { transition: changed });
  }
}

/** The GM's `ready`: moves made while no GM was connected. Reconciles vision and passive auras for every subject. */
export async function reconcileAllOnReady() {
  if (!isActiveGMSelf()) return;
  await refreshGearOffline(subjectActorsInView());
}

/** `canvasReady`: a new scene brings its own unlinked token actors. */
export async function refreshOnCanvasReady() {
  await refreshGearOffline(subjectActorsInView());
}
