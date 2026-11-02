/**
 * Render-time work: per-client visibility of interrupt prompt buttons.
 */

import { resolveActorByUuid } from '../../utils/actor-uuid.mjs';

// An interrupt button is shown only to its interrupter's owners and the GM.
function findInterrupter(btn) {
  const cid = btn.dataset?.combatantId;
  if (cid && game.combat?.combatants) {
    const list = game.combat.combatants;
    const arr = Array.isArray(list) ? list : (list.contents || Array.from(list.values?.() || []));
    const cbt = arr.find(x => x?.id === cid);
    if (cbt?.actor) return cbt.actor;
  }
  return resolveActorByUuid(btn.dataset?.actorUuid);
}

/**
 * Hide each interrupt button the user neither owns nor GMs, and any prompts container
 * whose buttons are all hidden.
 * @param {HTMLElement} root the rendered message element
 */
export function hideForeignInterruptButtons(root) {
  const triggerInterruptButtons = Array.from(root.querySelectorAll('.cog-trigger-interrupt-btn'));
  const containers = new Set();
  for (const btn of triggerInterruptButtons) {
    const container = typeof btn.closest === 'function' ? btn.closest('.cog-interrupt-prompts-container') : null;
    if (container) containers.add(container);
    if (game.user?.isGM || findInterrupter(btn)?.isOwner) continue;
    if (btn.style) btn.style.display = 'none';
    if (btn.dataset) btn.dataset.cogHidden = 'true';
  }
  for (const container of containers) {
    const inner = typeof container.querySelectorAll === 'function'
      ? Array.from(container.querySelectorAll('.cog-trigger-interrupt-btn')) : [];
    if (inner.length > 0 && inner.every(b => b.dataset?.cogHidden === 'true') && container.style) {
      container.style.display = 'none';
    }
  }
}

/**
 * Hide the GM's own card controls (`data-gm-only="true"`, e.g. a declared attack's "Resolve now") from players.
 * @param {HTMLElement} root the rendered message element
 */
export function hideGmOnlyButtons(root) {
  if (game.user?.isGM) return;
  for (const el of Array.from(root.querySelectorAll('[data-gm-only="true"]'))) {
    if (el.style) el.style.display = 'none';
  }
}
