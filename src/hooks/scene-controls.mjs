/**
 * Scene controls (7.17a): a toggle in the Token tool column that hides the crawler HUD overlays for this browser.
 * Foundry reruns `getSceneControlButtons` only on a reset render, so `refreshHudVisibility` re-renders the controls when
 * the state changes from elsewhere (the Shift+H keybinding, Configure Settings).
 */
import { isHudHidden, setHudHidden } from '../utils/effects/hud-visibility.mjs';
import { worldZeroZone, setWorldZeroZone } from '../utils/effects/zero-zone.mjs';

export function onGetSceneControlButtons(controls) {
  const tools = controls?.tokens?.tools;
  if (!tools || typeof tools !== 'object') return;
  tools.cogHideHud = {
    name: 'cogHideHud',
    order: 90,
    title: 'COG.Hud.HideTool',
    icon: 'fa-solid fa-eye-slash',
    toggle: true,
    active: isHudHidden(),
    onChange: (_event, active) => setHudHidden(active)
  };
  // GM only: the world zero zone switch (the player never sees this tool).
  tools.cogZeroZone = {
    name: 'cogZeroZone',
    order: 91,
    title: 'COG.Hud.ZeroZoneTool',
    icon: 'fa-solid fa-ban',
    toggle: true,
    visible: Boolean(globalThis.game?.user?.isGM),
    active: worldZeroZone(),
    onChange: (_event, active) => setWorldZeroZone(active)
  };
}
