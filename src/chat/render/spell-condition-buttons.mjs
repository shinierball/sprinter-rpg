/**
 * Render-time work: the Inflict buttons of a spell card once every target has the condition.
 * The card is frozen HTML; its flags change as the GM relay applies conditions, and viewers differ, so the check runs
 * at render and reads only structured flags: `conditionTargetUuids` (who the card meant) against the applied actor ids
 * (`appliedTargets` on a cast card, `conditionsApplied.targets` on a hit card).
 *
 * Once every target is covered the GM keeps the buttons and players do not. While any target still waits, or the card
 * records no targets, the buttons stay for everyone so a failed relay can be retried.
 */
import { SYSTEM_ID } from '../../constants.mjs';
import { resolveActorByUuid } from '../../utils/actor-uuid.mjs';

/** True when the card records its targets and every one of them is in its applied list. */
function spellConditionsAllApplied(message) {
  const f = message?.flags?.[SYSTEM_ID];
  if (!f || typeof f !== 'object') return false;
  const targets = Array.isArray(f.conditionTargetUuids) ? f.conditionTargetUuids : [];
  if (targets.length === 0) return false;
  const applied = f.isSpellAttack === true ? f.conditionsApplied?.targets : f.appliedTargets;
  if (!Array.isArray(applied)) return false;
  return targets.every((uuid) => {
    const id = resolveActorByUuid(uuid)?.id;
    return Boolean(id) && applied.includes(id);
  });
}

/**
 * Hide a card's Inflict buttons from players once every target has the condition.
 * @param {HTMLElement} root the rendered message element
 * @param {ChatMessage} message
 * @returns {number} how many buttons were hidden
 */
export function hideSpentInflictButtons(root, message) {
  if (!root?.querySelectorAll || globalThis.game?.user?.isGM) return 0;
  if (!spellConditionsAllApplied(message)) return 0;
  const buttons = [...root.querySelectorAll('.cog-spell-condition-actions .cog-apply-condition-btn')];
  for (const btn of buttons) {
    if (btn.style) btn.style.display = 'none';
    if (btn.dataset) btn.dataset.cogHidden = 'true';
  }
  return buttons.length;
}
