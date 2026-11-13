/**
 * HUD visibility (7.17a): a player hides the crawler HUD overlays (hotlist bar, actions panel, effects panel, floor clock,
 * crawler clock) for this browser. One client setting drives two body classes; one CSS rule hides every overlay that
 * carries HIDEABLE_HUD_CLASS. The overlays keep rendering, so collapse state and drag position survive and they are
 * correct the moment they come back. The `zeroZone` input of `hudVisibility` is the seam for the GM's zero zone (7.17b).
 */
import { SYSTEM_ID } from '../../constants.mjs';
import { clientInZeroZone } from './zero-zone.mjs';
import { zeroHealthState } from '../../documents/actor/zero-health-state.mjs';

export const HUD_HIDDEN_SETTING = 'hudHidden';
export const HIDEABLE_HUD_CLASS = 'cog-hideable-hud';
export const BODY_HIDDEN = 'cog-hud-hidden';
export const BODY_ZERO_ZONE_DARK = 'cog-zero-zone-dark';
const BODY_DYING_DARK = 'cog-dying-dark';

/**
 * Pure. Which body classes apply. A zero zone, or a player whose own character is Dying or Dead, darkens
 * players only (the GM keeps the overlays).
 * @returns {{ bodyClasses: string[], hidden: boolean, reason: 'zeroZone'|'dying'|'user'|null }}
 */
export function hudVisibility({ userHidden = false, zeroZone = false, dying = false, isGM = false } = {}) {
  const bodyClasses = [];
  if (userHidden) bodyClasses.push(BODY_HIDDEN);
  const dark = Boolean(zeroZone) && !isGM;
  if (dark) bodyClasses.push(BODY_ZERO_ZONE_DARK);
  const dyingDark = Boolean(dying) && !isGM;
  if (dyingDark) bodyClasses.push(BODY_DYING_DARK);
  const reason = dark ? 'zeroZone' : dyingDark ? 'dying' : userHidden ? 'user' : null;
  return { bodyClasses, hidden: reason !== null, reason };
}

/** True when this browser has hidden the HUD. A missing or throwing settings store reads as visible. */
export function isHudHidden() {
  try {
    return globalThis.game?.settings?.get?.(SYSTEM_ID, HUD_HIDDEN_SETTING) === true;
  } catch {
    return false;
  }
}

/** Whether this client's own character is Dying or Dead. */
function clientDying() {
  const state = zeroHealthState(globalThis.game?.user?.character);
  return state.dying || state.dead;
}

/** The current state: the client setting, the zero zone this client is in, and whether its character is Dying or Dead. */
export function currentHudState() {
  return hudVisibility({ userHidden: isHudHidden(), zeroZone: clientInZeroZone(), dying: clientDying(), isGM: Boolean(globalThis.game?.user?.isGM) });
}

export async function setHudHidden(on) {
  await globalThis.game?.settings?.set?.(SYSTEM_ID, HUD_HIDDEN_SETTING, Boolean(on));
  // In a zero zone the overlays stay dark whatever the player chooses; the notice is neutral, never naming the zone (617).
  if (currentHudState().reason === 'zeroZone') {
    globalThis.ui?.notifications?.info?.(globalThis.game?.i18n?.localize?.('COG.Hud.ZoneNotice') ?? 'COG.Hud.ZoneNotice');
  }
  return Boolean(on);
}

export async function toggleHudHidden() {
  return setHudHidden(!isHudHidden());
}

/** Make the body carry exactly the classes in `state.bodyClasses` (of the three this module owns). */
export function applyHudVisibility(doc = globalThis.document, state = currentHudState()) {
  const list = doc?.body?.classList;
  if (!list) return state;
  for (const cls of [BODY_HIDDEN, BODY_ZERO_ZONE_DARK, BODY_DYING_DARK]) list.toggle(cls, state.bodyClasses.includes(cls));
  return state;
}

/** Apply the body classes and refresh the scene-controls tool highlight. */
export function refreshHudVisibility() {
  const state = applyHudVisibility();
  try {
    globalThis.ui?.controls?.render?.({ reset: true });
  } catch {
    // Scene controls not drawn yet.
  }
  return state;
}
