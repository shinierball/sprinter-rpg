/**
 * Render-time work: per-client visibility of party check card buttons. A Roll button is shown only to the owners of its
 * participant's actor and the GM.
 */
import { resolveActorByUuid } from '../../utils/actor-uuid.mjs';

/** @param {HTMLElement} root the rendered message element */
export function hideForeignPartyCheckButtons(root) {
  if (!root?.querySelectorAll || globalThis.game?.user?.isGM) return;
  for (const btn of Array.from(root.querySelectorAll('.cog-party-roll'))) {
    if (resolveActorByUuid(btn.dataset?.actorUuid)?.isOwner) continue;
    if (btn.style) btn.style.display = 'none';
  }
}
