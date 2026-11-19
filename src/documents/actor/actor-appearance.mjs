/**
 * How an actor's token looks while a form is laid over it. The image is derived, never stored: Foundry v14 applies the
 * actor's `tokenActiveEffectChanges` to every token of the actor (linked, unlinked, dropped later) each time it
 * prepares, so nothing is written to the actor, its prototype token or a placed token, and nothing needs restoring.
 */
import { formTokenImage } from '../../utils/character/overlay-state.mjs';

/** Priority of the image override among the token's other active-effect changes. */
const FORM_IMAGE_PRIORITY = 50;

/**
 * The token changes the form in force asks for: one `texture.src` override, or none.
 * @param {object} actor
 * @returns {Array<{ key: string, type: string, value: string, priority: number }>}
 */
function formTokenChanges(actor) {
  const src = formTokenImage(actor?.items ?? []);
  return src ? [{ key: 'texture.src', type: 'override', value: src, priority: FORM_IMAGE_PRIORITY }] : [];
}

/**
 * Called by `COGActor#applyActiveEffects` after Foundry has gathered the effects' token changes. Only the `initial`
 * phase takes the image, so a dynamic token ring takes its subject from the form's image.
 * @param {object} actor
 * @param {string} phase
 */
export function addFormTokenChanges(actor, phase) {
  if (phase !== 'initial') return;
  const changes = formTokenChanges(actor);
  if (!changes.length) return;
  actor.tokenActiveEffectChanges ??= {};
  (actor.tokenActiveEffectChanges.initial ??= []).push(...changes);
}
