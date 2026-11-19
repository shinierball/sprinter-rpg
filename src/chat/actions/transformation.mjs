/**
 * Transformation chat buttons (7.1e): Change (landing and 0 Health cards) and Revert as a Rule Break (cure card).
 * Both write only the carrier and its own items, so the GM or an owner performs them directly on this client.
 */
import { resolveActorByUuid } from '../../utils/actor-uuid.mjs';
import { getRuleBreakMode, RULE_BREAK_MODES } from '../../utils/rule-break.mjs';
import { canWriteTarget } from '../chat-relay.mjs';
import { getCurrentFloor } from '../../utils/floor/current-floor.mjs';
import { afflictionStage, heldByCure } from '../../utils/character/transform-rules.mjs';
import { changeVictim, revertTransformation, changeNow } from '../../documents/actor/transformations.mjs';
import { reveal, listPending } from '../../documents/pending-secrets.mjs';
import { transformText } from '../../utils/character/transform-text.mjs';

const warn = (message) => globalThis.ui?.notifications?.warn?.(message);

/** The carrier and affliction a button names, or null with a notification. */
function resolve(button) {
  const actor = resolveActorByUuid(button.dataset?.targetUuid);
  const affliction = actor?.items.get(button.dataset?.afflictionId) ?? null;
  if (!actor || !affliction) { warn(transformText('COG.TransformCard.NotFound')); return null; }
  if (!canWriteTarget(actor)) { warn(transformText('COG.TransformCard.NotAllowed', { actor: actor.name })); return null; }
  return { actor, affliction };
}

/**
 * "Change" from a landing or 0 Health card: the GM or an owner fires the pending affliction (it asks a plain
 * confirmation, never a Rule Break). A player who does not own the carrier is refused.
 * @param {Event} event
 * @param {HTMLElement} button
 */
export async function handleChangeVictim(event, button) {
  const found = resolve(button);
  if (!found) return false;
  const { actor, affliction } = found;
  if (afflictionStage(affliction) !== 'pending') {
    warn(transformText('COG.TransformCard.NotPending', { actor: actor.name, affliction: affliction.name }));
    return false;
  }
  return changeVictim(actor, affliction);
}

/**
 * "Revert as a Rule Break" from a cure card for a changed affliction its cure window holds. Pressing it is the
 * confirmation, unless the world refuses Rule Breaks.
 * @param {Event} event
 * @param {HTMLElement} button
 */
export async function handleRevertTransformation(event, button) {
  const found = resolve(button);
  if (!found) return false;
  const { actor, affliction } = found;
  if (afflictionStage(affliction) !== 'changed') {
    warn(transformText('COG.TransformCard.NotPending', { actor: actor.name, affliction: affliction.name }));
    return false;
  }
  if (getRuleBreakMode() === RULE_BREAK_MODES.REFUSE) {
    warn(transformText('COG.TransformCard.RefusePolicy'));
    return false;
  }
  // A window that opened since the card was posted reverts freely (N10)
  return revertTransformation(actor, affliction, { ruleBreak: heldByCure(affliction, { floor: getCurrentFloor() }) });
}

/**
 * "Reveal to the player" on the GM's secret card: create the held debuff on its carrier as a normal landing. GM only
 * (the store is the GM's), so a player pressing a forwarded button is refused.
 * @param {Event} event
 * @param {HTMLElement} button
 */
export async function handleRevealSecret(event, button) {
  if (!globalThis.game?.user?.isGM) { warn(transformText('COG.TransformCard.GMOnly')); return false; }
  return Boolean(await reveal(button.dataset?.secretId));
}

/**
 * "Keep secret": the debuff stays in the store, off the carrier. It changes nothing; it tells the GM where to find it.
 * @param {Event} event
 * @param {HTMLElement} button
 */
export async function handleKeepSecret(event, button) {
  if (!globalThis.game?.user?.isGM) { warn(transformText('COG.TransformCard.GMOnly')); return false; }
  const record = listPending().find((r) => r.id === button.dataset?.secretId);
  if (!record) { warn(transformText('COG.TransformCard.SecretGone')); return false; }
  globalThis.ui?.notifications?.info?.(transformText('COG.TransformCard.SecretKept', { actor: record.actorName, affliction: record.name }));
  return true;
}

/**
 * "Change now" on a held secret's cue card: reveal the debuff and fire its change in one step. GM only, like Reveal.
 * @param {Event} event
 * @param {HTMLElement} button
 */
export async function handleChangeSecret(event, button) {
  if (!globalThis.game?.user?.isGM) { warn(transformText('COG.TransformCard.GMOnly')); return false; }
  if (!listPending().some((r) => r.id === button.dataset?.secretId)) { warn(transformText('COG.TransformCard.SecretGone')); return false; }
  return Boolean(await changeNow(button.dataset.secretId));
}
