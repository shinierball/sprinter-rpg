/**
 * The button of a kill trigger's `check` offer (`crawlerAfterKillCheck`). The card is posted by `fireEventTriggers` and names the
 * holder and the skill identifier; the click rolls that skill for the holder (an untrained skill at Rank 0, as any skill) with
 * `situation.after_kill` ticked, against the Unopposed Difficulty (10 + 2 x Floor), so the card is born with its degree and an
 * Amazing Success can pay Popularity at once. Only the holder's owner or the GM may click; a card is used once.
 */
import { AFTER_KILL_SITUATION } from '../../data/tag-vocabulary.mjs';
import { resolveActorByUuid } from '../../utils/actor-uuid.mjs';
import { readFlag, flagPath } from '../../utils/flags.mjs';
import { skillStandIn } from '../../utils/skill/skill-stand-in.mjs';

/** The flag an offer card carries: `{ actorUuid, skill, used }`. */
export const AFTER_KILL_CHECK_FLAG = 'afterKillCheck';

/** The Difficulty an after-kill check is born with: the book's Unopposed formula, 10 + 2 x Floor. */
const AFTER_KILL_DIFFICULTY = Object.freeze({ mode: 'unopposed' });

/** The offer on a card, sanitized, or null when the message is not one. */
function readAfterKillCheck(message) {
  const r = readFlag(message, AFTER_KILL_CHECK_FLAG);
  if (!r || typeof r !== 'object' || typeof r.actorUuid !== 'string' || !r.actorUuid) return null;
  const skill = typeof r.skill === 'string' ? r.skill.trim() : '';
  return skill ? { actorUuid: r.actorUuid, skill, used: r.used === true } : null;
}

const warn = (text) => globalThis.ui?.notifications?.warn?.(`Sprinter RPG | ${text}`);

/** `crawlerAfterKillCheck`: roll the offered skill for the holder. */
export async function handleAfterKillCheck(event, button, message) {
  const offer = readAfterKillCheck(message);
  if (!offer) return null;
  const actor = resolveActorByUuid(offer.actorUuid);
  const user = globalThis.game?.user;
  if (!actor || !(user?.isGM || actor.testUserPermission?.(user, 'OWNER') || actor.isOwner)) {
    warn('Only the GM or the owner of the crawler can roll this check.');
    return null;
  }
  if (offer.used) {
    warn('This check was already rolled.');
    return null;
  }
  const skill = skillStandIn(actor, offer.skill);
  if (!skill) return null;
  if (button) button.disabled = true;
  // Mark the card before the roll, so a second click (here or on another client) is refused; the card may not be ours to update
  try {
    await message.update?.({ [flagPath(`${AFTER_KILL_CHECK_FLAG}.used`)]: true });
  } catch {
    // an unmarked card still has its button disabled on this client
  }
  return actor.rollSkill(skill, { situations: [AFTER_KILL_SITUATION], difficulty: { ...AFTER_KILL_DIFFICULTY } });
}
