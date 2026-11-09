/**
 * Region behavior "Zero Zone" (7.17d): a place on the map where crawlers' enhancements are offline. On/off is core's
 * `disabled` toggle, so the schema is empty. Region events reach every client, so each client re-prepares the moving
 * token's actor and re-applies its HUD classes; the active GM's client also reconciles vision and gear auras
 * (`refreshGearOffline`). Only the client of the user who moved the token whispers the owners, and what they read never
 * names the zone.
 */
import { SYSTEM_ID } from '../../constants.mjs';
import { isZeroZoneSubject, worldZeroZone } from '../../utils/effects/zero-zone.mjs';
import { refreshHudVisibility } from '../../utils/effects/hud-visibility.mjs';
import { refreshGearOffline } from '../../utils/effects/gear-offline-refresh.mjs';

const REGION_EVENTS = Object.freeze({
  tokenMoveIn: 'tokenMoveIn',
  tokenMoveOut: 'tokenMoveOut',
  regionBoundary: 'regionBoundary'
});

const listOf = (coll) => (!coll ? [] : (Array.isArray(coll.contents) ? coll.contents : Array.from(coll.values?.() ?? coll)));

/** Non-GM owners of an actor (the people who feel the zone). */
export function zoneNoticeRecipients(actor) {
  const users = listOf(globalThis.game?.users);
  return users.filter(u => u && !u.isGM && actor?.testUserPermission?.(u, 'OWNER')).map(u => u.id);
}

/**
 * Whisper the owners that their interface stopped responding. The wording is the HUD notice; "zero zone" is never shown.
 * Skipped when the world switch already has them dark.
 */
export async function whisperZoneEntered(actor) {
  if (!isZeroZoneSubject(actor) || worldZeroZone()) return null;
  const whisper = zoneNoticeRecipients(actor);
  if (!whisper.length) return null;
  const key = 'COG.Hud.ZoneNotice';
  const localized = globalThis.game?.i18n?.localize?.(key);
  const content = localized && localized !== key ? localized : 'Your interface isn\'t responding.';
  return globalThis.ChatMessage?.create?.({
    content,
    whisper,
    speaker: { alias: actor.name },
    flags: { [SYSTEM_ID]: { zoneNotice: true } }
  });
}

/** Every client: the token's actor is re-prepared for the zone it is in now, and the HUD classes follow. */
export async function onZoneTokenMove(event, { entered = false } = {}) {
  const actor = event?.data?.token?.actor ?? null;
  if (actor) await refreshGearOffline([actor]);
  refreshHudVisibility();
  if (entered && actor && event?.user?.isSelf === true) await whisperZoneEntered(actor);
}

/** Every client: the shape or height of the region changed, so token membership may have changed. */
async function onZoneBoundary(behaviorType) {
  const tokens = listOf(behaviorType?.scene?.tokens);
  const actors = new Set(tokens.map(t => t.actor).filter(Boolean));
  await refreshGearOffline(actors);
  refreshHudVisibility();
}

const BaseType = globalThis.foundry?.data?.regionBehaviors?.RegionBehaviorType ?? globalThis.foundry?.abstract?.TypeDataModel ?? class {};

export class ZeroZoneBehaviorType extends BaseType {
  /** @override */
  static LOCALIZATION_PREFIXES = ['BEHAVIOR.TYPES.zeroZone', 'BEHAVIOR.TYPES.base'];

  /** @override */
  static defineSchema() {
    return {};
  }

  /** @override Handlers run with the behavior as `this`. */
  static events = {
    [REGION_EVENTS.tokenMoveIn]: async function (event) { await onZoneTokenMove(event, { entered: true }); },
    [REGION_EVENTS.tokenMoveOut]: async function (event) { await onZoneTokenMove(event); },
    [REGION_EVENTS.regionBoundary]: async function () { await onZoneBoundary(this); }
  };
}
