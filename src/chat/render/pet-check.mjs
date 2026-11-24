/**
 * Render-time block on pet check cards: the Difficulty and, once the GM has settled a taming card, what it did to the pet's
 * attitude. The card's flags are the truth (`flags.sprinter-rpg.check` and the GM's `petResult`); this only decorates, with
 * createElement and textContent, so a pet's name or attitude never goes through innerHTML.
 */
import { readFlag } from '../../utils/flags.mjs';
import { readCheckRecord, isSuccessOutcome } from '../../utils/roll/check-assists.mjs';
import { PET_ATTITUDES, PET_CHECK_KINDS, PET_GUIDANCE } from '../../data/rules/pet-rules.mjs';
import { PET_RESULT_FLAG } from '../../documents/actor/pet-checks.mjs';
import { PET_THROWN_FLAG, ridingCardInfo } from '../../documents/actor/pet-thrown.mjs';

function el(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  node.textContent = text;
  return node;
}

/** What each guidance result says on the card (core book p. 232). */
const GUIDANCE_LINES = Object.freeze({
  none: 'It stays out of the fight. Its handler may try again with a later Action.',
  limited: 'It fights this combat: two Actions a round, Evade, Move or Attack only, and one attack a round.',
  free: 'It fights this combat: two Actions a round, of any kind.',
  hiding: 'It runs and hides until found after the fight.'
});

const attitudeLabel = (id) => PET_ATTITUDES[id]?.label ?? String(id ?? '');

/** A failed riding check: the GM's "Thrown" button (a player sees only the line), or what the click did. */
function appendThrown(doc, block, message) {
  const info = ridingCardInfo(message);
  if (!info?.mayBeThrown) return;
  if (readFlag(message, PET_THROWN_FLAG)) {
    block.append(el(doc, 'p', 'cog-pet-check__thrown', 'Thrown.'));
    return;
  }
  block.append(el(doc, 'p', 'cog-pet-check__thrown', 'A Fail: the GM may throw the rider.'));
  if (!globalThis.game?.user?.isGM) return;
  const button = el(doc, 'button', 'cog-apply-damage-btn', 'Thrown');
  button.type = 'button';
  button.dataset.action = 'crawlerPetThrown';
  block.append(button);
}

/**
 * Add the pet block to a rendered check card (nothing for any other card).
 * @param {HTMLElement} root the rendered message element
 * @param {ChatMessage} message
 */
export function renderPetCheck(root, message) {
  const ref = readCheckRecord(message)?.pet;
  if (!ref) return;
  const host = root?.querySelector?.('.message-content') ?? root;
  if (!ref || !host?.ownerDocument) return;
  host.querySelector?.('.cog-pet-check')?.remove?.();
  const doc = host.ownerDocument;
  const block = el(doc, 'div', 'cog-pet-check', '');
  block.dataset.petKind = ref.kind;
  block.append(el(doc, 'p', 'cog-pet-check__dc', ref.dc === null ? 'Difficulty not set' : `${PET_CHECK_KINDS[ref.kind]?.label ?? ref.kind}: Difficulty ${ref.dc}`));
  const result = readFlag(message, PET_RESULT_FLAG);
  if (result && typeof result.guidance === 'string') {
    block.append(el(doc, 'p', 'cog-pet-check__guidance', `${PET_GUIDANCE[result.guidance]?.badge ?? ''} ${GUIDANCE_LINES[result.guidance] ?? ''}`.trim()));
  } else if (result?.command) {
    const together = Number(result.command.count) > 1 ? `It and ${Number(result.command.count) - 1} ${Number(result.command.count) === 2 ? 'copy' : 'copies'} follow the new command.` : 'It follows the new command.';
    block.append(el(doc, 'p', 'cog-pet-check__command', isSuccessOutcome(result.outcome) ? `[COMMANDED] ${together}` : 'No new command: it keeps its last one.'));
  } else if (result?.stale === true) {
    block.append(el(doc, 'p', 'cog-pet-check__result', 'Not counted: a later attempt had already settled.'));
  } else if (result) {
    block.append(el(doc, 'p', 'cog-pet-check__result', result.to === result.from ? `Stays ${attitudeLabel(result.to)}.` : `${attitudeLabel(result.from)} to ${attitudeLabel(result.to)}.`));
    if (result.lockout) block.append(el(doc, 'p', 'cog-pet-check__lockout', 'No attempts to change this pet\'s attitude for 1 week.'));
    if (result.attacks) block.append(el(doc, 'p', 'cog-pet-check__attacks', 'It attacks.'));
    if (result.ruleBreak) block.append(el(doc, 'p', 'cog-pet-check__rule-break', 'Rule Break: tried too soon or inside the lockout.'));
  } else if (PET_CHECK_KINDS[ref.kind]?.resolve === 'attitude') {
    block.append(el(doc, 'p', 'cog-pet-check__note', '20 minutes of direct contact. The GM advances time.'));
  } else if (PET_CHECK_KINDS[ref.kind]?.resolve === 'thrown') {
    appendThrown(doc, block, message);
  }
  host.append(block);
}
