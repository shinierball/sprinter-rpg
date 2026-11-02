/**
 * Render-time work: per-client visibility of contest card buttons. A Roll, Propose skill or Drop out button is shown only to the
 * owners of its participant's actor and the GM.
 */
import { resolveActorByUuid } from '../../utils/actor-uuid.mjs';

/** @param {HTMLElement} root the rendered message element */
export function hideForeignContestButtons(root) {
  if (!root?.querySelectorAll || globalThis.game?.user?.isGM) return;
  for (const btn of Array.from(root.querySelectorAll('.cog-contest-roll, .cog-contest-propose, .cog-contest-drop'))) {
    if (resolveActorByUuid(btn.dataset?.actorUuid)?.isOwner) continue;
    if (btn.style) btn.style.display = 'none';
  }
}
