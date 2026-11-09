/**
 * Region and RegionBehavior document hooks (7.17e3b): when a zero zone behavior is created, enabled, disabled or deleted,
 * or its region is reshaped or deleted, every client re-prepares the actors with tokens on that scene and re-applies its
 * HUD classes. The active GM's client also reconciles vision and gear auras (inside `refreshGearOffline`). Pre-hooks are
 * never used: a pre-hook that returned false would cancel the document operation.
 */
import { ZERO_ZONE_BEHAVIOR_TYPE } from '../utils/effects/zero-zone.mjs';
import { refreshGearOffline } from '../utils/effects/gear-offline-refresh.mjs';
import { refreshHudVisibility } from '../utils/effects/hud-visibility.mjs';

const BOUNDARY_KEYS = ['shapes', 'elevation', 'levels', 'restriction'];

const listOf = (coll) => (!coll ? [] : (Array.isArray(coll.contents) ? coll.contents : Array.from(coll.values?.() ?? coll)));

/** The actors with a token on this scene (membership may have just changed for any of them). */
export function sceneActors(scene) {
  return new Set(listOf(scene?.tokens).map(t => t.actor).filter(Boolean));
}

async function refreshScene(scene) {
  try {
    await refreshGearOffline(sceneActors(scene));
    refreshHudVisibility();
  } catch (err) {
    console.warn('Sprinter RPG | Zero zone region refresh failed:', err);
  }
}

const holdsZoneBehavior = (region) => listOf(region?.behaviors).some(b => b?.type === ZERO_ZONE_BEHAVIOR_TYPE);

/** create/update/deleteRegionBehavior */
export async function onZoneBehaviorChange(behavior) {
  if (behavior?.type !== ZERO_ZONE_BEHAVIOR_TYPE) return;
  await refreshScene(behavior.parent?.parent ?? behavior.scene);
}

/** updateRegion: only a change of where the region is can move tokens in or out of a zone. */
export async function onRegionUpdate(region, changes) {
  if (!BOUNDARY_KEYS.some(key => changes && key in changes)) return;
  if (!holdsZoneBehavior(region)) return;
  await refreshScene(region.parent);
}

/** deleteRegion: its zone behavior goes with it. */
export async function onRegionDelete(region) {
  if (!holdsZoneBehavior(region)) return;
  await refreshScene(region.parent);
}

export function registerZeroZoneRegionHooks() {
  for (const hook of ['createRegionBehavior', 'updateRegionBehavior', 'deleteRegionBehavior']) {
    Hooks.on(hook, onZoneBehaviorChange);
  }
  Hooks.on('updateRegion', onRegionUpdate);
  Hooks.on('deleteRegion', onRegionDelete);
}
