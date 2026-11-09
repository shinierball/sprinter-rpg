/**
 * Zero zone (7.17b): the GM switches off the crawlers' enhancements. Crawlers never learn the word; they only feel it
 * (their HUD overlays go dark, 617). So there is no chat card and nothing player-visible names the zone; only the GM sees
 * the ZERO ZONE pill on the floor clock and the GM tool, keybinding and setting. Today the only source is one world
 * switch; the Region behavior (7.17d) adds a second source inside `zeroZoneFor` / `clientInZeroZone`.
 */
import { SYSTEM_ID } from '../../constants.mjs';
import { refreshHudVisibility } from './hud-visibility.mjs';
import { zoneTokensOf } from '../../documents/actor/zero-zone-gate.mjs';

export const ZERO_ZONE_SETTING = 'zeroZone';

/** The world switch. A missing or throwing settings store reads as off. */
export function worldZeroZone() {
  try {
    return globalThis.game?.settings?.get?.(SYSTEM_ID, ZERO_ZONE_SETTING) === true;
  } catch {
    return false;
  }
}

/** Which actors a zone affects: crawlers (anything with a hotlist). */
export function isZeroZoneSubject(actor) {
  return Boolean(actor?.system?.hotlist);
}

/** The Region behavior subtype (7.17d). On/off is core's `disabled`. */
export const ZERO_ZONE_BEHAVIOR_TYPE = 'zeroZone';

/** An enabled zero zone behavior on this region? A region that was just deleted from its scene no longer counts. */
function regionHoldsZone(region) {
  if (!region) return false;
  const scene = region.parent;
  if (typeof scene?.regions?.has === 'function' && region.id && !scene.regions.has(region.id)) return false;
  const behaviors = region.behaviors;
  if (!behaviors) return false;
  const list = Array.isArray(behaviors.contents) ? behaviors.contents : Array.from(behaviors.values?.() ?? behaviors);
  return list.some(b => b?.type === ZERO_ZONE_BEHAVIOR_TYPE && b.disabled !== true);
}

/**
 * The first region holding an enabled zero zone behavior that any of these token documents stands in, or null.
 * @param {Iterable<object>|null|undefined} tokens TokenDocuments
 */
function zeroZoneRegionOf(tokens) {
  for (const token of Array.from(tokens ?? [])) {
    const regions = token?.regions;
    if (!regions) continue;
    for (const region of Array.from(regions.values?.() ?? regions)) {
      if (regionHoldsZone(region)) return region;
    }
  }
  return null;
}

/**
 * Is this actor standing in a zero zone, whoever it is? Mobs and NPCs count: gear and buff suppression covers everyone in
 * the zone. World first; 7.17d adds the region source (`tokens`, an array or a function returning one, so a caller pays for
 * the token lookup only when a region source needs it).
 * Region source rule (7.17d): never use `actor.getActiveTokens()` (it follows the scene each client views, so clients could
 * disagree). An unlinked actor uses its own token; a linked actor uses `actor.getDependentTokens({ scenes: game.scenes.active })`.
 * @returns {{ active: boolean, source: 'world'|'region'|null, label: string }}
 */
export function zeroZoneOf(actor, { tokens } = {}) {
  if (worldZeroZone()) return { active: true, source: 'world', label: 'World' };
  const region = zeroZoneRegionOf(typeof tokens === 'function' ? tokens() : tokens);
  if (region) return { active: true, source: 'region', label: region.name || 'Region' };
  return { active: false, source: null, label: '' };
}

/** Is this actor in a zero zone, if the zone affects it as a crawler-like subject (it has a hotlist)? HUD and Rule Break gate. */
export function zeroZoneFor(actor, opts = {}) {
  if (!isZeroZoneSubject(actor)) return { active: false, source: null, label: '' };
  return zeroZoneOf(actor, opts);
}

/**
 * What darkens this client's HUD: the world switch, or a zone around a token this client controls. Read through the same
 * token reader the gate and the stat derivation use (an unlinked token itself, a linked actor's tokens on the active
 * scene), so every client agrees.
 */
export function clientInZeroZone() {
  if (worldZeroZone()) return true;
  try {
    for (const token of Array.from(globalThis.canvas?.tokens?.controlled ?? [])) {
      const actor = token?.actor;
      if (actor && zeroZoneFor(actor, { tokens: () => zoneTokensOf(actor) }).active) return true;
    }
  } catch { /* No canvas yet. */ }
  return false;
}

/** GM only. A player gets one neutral warning and no write. */
export async function setWorldZeroZone(on) {
  const g = globalThis.game;
  if (!g?.user?.isGM) {
    globalThis.ui?.notifications?.warn?.(g?.i18n?.localize?.('COG.Hud.GMOnly') ?? 'COG.Hud.GMOnly');
    return false;
  }
  await g.settings.set(SYSTEM_ID, ZERO_ZONE_SETTING, Boolean(on));
  return Boolean(on);
}

export async function toggleWorldZeroZone() {
  return setWorldZeroZone(!worldZeroZone());
}

/** Setting onChange, on every client: re-apply the body classes, redraw the GM pill. No chat card (617). */
export function onZeroZoneChange() {
  refreshHudVisibility();
  // Every client re-prepares its actors; the active GM also rewrites token vision and gear auras. Lazy: the refresh
  // module reaches documents that import this one.
  import('./gear-offline-refresh.mjs')
    .then(({ refreshGearOffline, subjectActorsInView }) => refreshGearOffline(subjectActorsInView()))
    .catch(err => console.warn('Sprinter RPG | Zero zone refresh failed:', err));
  // The floor clock re-renders from src/hooks/ready.mjs; an engine never imports a window (GEMINI 🧱 1).
  globalThis.Hooks?.callAll?.('cogZeroZoneChanged');
}
