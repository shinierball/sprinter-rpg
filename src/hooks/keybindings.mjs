/**
 * Keybindings (3.19b): Next Step and Previous Step of the five-step combat round, usable with the tracker closed.
 * They call the same `combat.nextStep()` / `combat.previousStep()` as the tracker's step buttons. GM only; a player
 * pressing them gets nothing. Defaults (Shift+Period, Shift+Comma) are unused by core v14; both stay editable in
 * Configure Controls.
 */
import { SYSTEM_ID } from '../constants.mjs';
import { toggleHudHidden } from '../utils/effects/hud-visibility.mjs';
import { toggleWorldZeroZone } from '../utils/effects/zero-zone.mjs';

/** Run a step method on the active combat for a GM; returns true when the key press was handled. */
async function stepActiveCombat(method) {
  if (!globalThis.game?.user?.isGM) return false;
  const combat = globalThis.game.combat;
  if (!combat || typeof combat[method] !== 'function') return false;
  await combat[method]();
  globalThis.ui?.combat?.render?.();
  return true;
}

export function registerKeybindings() {
  const keybindings = globalThis.game?.keybindings;
  if (!keybindings?.register) return;
  const precedence = globalThis.CONST?.KEYBINDING_PRECEDENCE?.NORMAL ?? 1;
  keybindings.register(SYSTEM_ID, 'nextCombatStep', {
    name: 'COG.Keybindings.NextStep',
    hint: 'COG.Keybindings.NextStepHint',
    editable: [{ key: 'Period', modifiers: ['Shift'] }],
    restricted: true,
    precedence,
    onDown: () => stepActiveCombat('nextStep')
  });
  keybindings.register(SYSTEM_ID, 'previousCombatStep', {
    name: 'COG.Keybindings.PreviousStep',
    hint: 'COG.Keybindings.PreviousStepHint',
    editable: [{ key: 'Comma', modifiers: ['Shift'] }],
    restricted: true,
    precedence,
    onDown: () => stepActiveCombat('previousStep')
  });
  // 7.17a: hide / show the crawler HUD overlays for this browser. Any user; core v14 leaves Shift+H unbound.
  keybindings.register(SYSTEM_ID, 'toggleHud', {
    name: 'COG.Keybindings.ToggleHud',
    hint: 'COG.Keybindings.ToggleHudHint',
    editable: [{ key: 'KeyH', modifiers: ['Shift'] }],
    precedence,
    onDown: () => {
      toggleHudHidden();
      return true;
    }
  });
  // 7.17b: GM only, unbound by default.
  keybindings.register(SYSTEM_ID, 'toggleZeroZone', {
    name: 'COG.Keybindings.ToggleZeroZone',
    hint: 'COG.Keybindings.ToggleZeroZoneHint',
    editable: [],
    restricted: true,
    precedence,
    onDown: () => {
      toggleWorldZeroZone();
      return true;
    }
  });
}
