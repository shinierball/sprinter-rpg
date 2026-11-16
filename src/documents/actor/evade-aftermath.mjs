/**
 * What an Evade earns besides its damage (core pp. 79-80): the Advantage a Natural 20 or an Amazing Success gives on the
 * evader's next Attack against that Mob. The chat log is the memory: the Evade cards of the running combat and the attack
 * cards after them say what is owed and what was used, so a reroll, an assist or a deleted card moves it with no second write.
 */
import { resolveActorByUuid } from '../../utils/actor-uuid.mjs';
import { messageAuthorId } from '../../chat/chat-relay.mjs';
import { makeCardText } from '../../chat/popularity-checklist-card.mjs';
import { combatRefFor } from '../../utils/roll/check-assists.mjs';
import { owedEvadeAdvantage, combatEvadeInjuries } from '../../utils/attack/evade-link.mjs';
import { applyCondition } from './actor-conditions.mjs';
import { isDead } from './dying.mjs';
import { readChoiceOptions } from '../../utils/attack/attack-options.mjs';
import { EVADE_ADVANTAGE_SITUATION } from '../../data/tag-vocabulary.mjs';
import { DETECTED } from '../../data/rules/attack-situation-rules.mjs';

const KEY = 'COG.EvadeAftermath';

/** Localised text of the Evade aftermath (reasons and card lines), with the English default when no i18n is loaded. */
export const evadeAftermathText = makeCardText({
  [`${KEY}.ReasonNatural20`]: 'Evade Natural 20 against this mob',
  [`${KEY}.ReasonAmazing`]: 'Evade Amazing Success against this mob',
  [`${KEY}.LineMinor`]: 'Minor Injury when the fight ends',
  [`${KEY}.LineMajor`]: 'Major Injury when the fight ends',
  [`${KEY}.NoCombat`]: ' (no combat: apply it by hand)',
  [`${KEY}.LineAdvantage`]: 'Advantage on the next attack against {mob}',
  [`${KEY}.ThisMob`]: 'this mob',
  [`${KEY}.Card.Title`]: 'Evade Fallout',
  [`${KEY}.Card.Hint`]: 'Nothing lands until you press Apply.',
  [`${KEY}.Card.Minor`]: 'Minor Injury',
  [`${KEY}.Card.Major`]: 'Major Injury',
  [`${KEY}.Card.CauseMajorFail`]: 'Major Fail',
  [`${KEY}.Card.CauseNatural1`]: 'Natural 1',
  [`${KEY}.Card.Line`]: '{name}: {injury} ({cause} against {attacker}, round {round})',
  [`${KEY}.Card.LineNoAttacker`]: '{name}: {injury} ({cause}, round {round})',
  [`${KEY}.Card.Dead`]: 'Dead: Apply all skips this line.',
  [`${KEY}.Card.Apply`]: 'Apply',
  [`${KEY}.Card.ApplyAll`]: 'Apply all',
  [`${KEY}.Card.Landed`]: 'Landed: {name}',
  [`${KEY}.Card.GmOnly`]: 'Only the GM can apply Injuries.',
  [`${KEY}.Card.Gone`]: 'Could not find {name}: nothing landed.',
  [`${KEY}.Card.NotLanded`]: '{name}: the Injury did not land.',
  [`${KEY}.Card.AlreadyTitle`]: 'Already Applied',
  [`${KEY}.Card.AlreadyMessage`]: 'This Injury was already applied. Apply it again as a Rule Break?',
  [`${KEY}.Card.AlreadyReason`]: 'An Evade Injury applied twice.'
});

/** The canon debuffs an Evade's Injury lands as (Table 11, p. 97). */
const EVADE_INJURY_DEBUFFS = Object.freeze({ minor: 'minor-injury', major: 'major-injury' });

/**
 * An Evade message counts only when its author is the GM or owns the evader, and the evader resolves: a player can fake
 * an Evade only for an actor they could roll a real one for (E6.3).
 */
export function isTrustedEvade(message, record) {
  const evader = resolveActorByUuid(record.evaderUuid);
  if (!evader) return false;
  const author = game.users?.get?.(messageAuthorId(message));
  if (!author) return false;
  return Boolean(author.isGM) || Boolean(evader.testUserPermission?.(author, 'OWNER'));
}

/**
 * The Advantage reason `actor`'s attack on `target` gains from an earlier Evade (p. 79), or null. Only a mob is the target,
 * a mob never gains it, and only inside the running combat; a fixed string, so it names nobody.
 * @param {object} actor the attacker
 * @param {object|null} target the first target
 * @returns {string|null}
 */
export function evadeAdvantageReason(actor, target) {
  if (target?.type !== 'mob' || actor?.type === 'mob') return null;
  const combat = combatRefFor(actor);
  if (!combat) return null;
  const owed = owedEvadeAdvantage(globalThis.game?.messages, { rollerUuid: actor.uuid, targetUuid: target.uuid, combatId: combat.id, isTrusted: isTrustedEvade });
  if (!owed) return null;
  return evadeAftermathText(`${KEY}.${owed.advantage === 'natural_20' ? 'ReasonNatural20' : 'ReasonAmazing'}`);
}

/**
 * The owed Advantage as a pre-ticked line of the Attack Options window, or null when none is owed.
 * @param {object} actor the attacker
 * @param {object|null} target the first target
 * @returns {{ tag: string, label: string, source: string, reads: string, stock: boolean, detected: string, note: string }|null}
 */
export function evadeAdvantageLine(actor, target) {
  const label = evadeAdvantageReason(actor, target);
  return label ? { tag: EVADE_ADVANTAGE_SITUATION, label, source: '', reads: '', stock: false, detected: DETECTED.yes, note: '' } : null;
}

/**
 * Whether the attacker took the owed Advantage's line off: the window listed it and the choices (the window's, or a skipped
 * window's pre-filled ones) no longer tick it. A caller that answered the choices outright never saw the line.
 * @param {{ situations?: Array<{ tag: string }> }} model
 * @param {{ situations?: string[] }} choices
 * @param {object} options the roll options
 * @returns {boolean}
 */
export function evadeLineUnticked(model, choices, options) {
  if (!(model?.situations ?? []).some(o => o?.tag === EVADE_ADVANTAGE_SITUATION)) return false;
  if (readChoiceOptions(options)) return false;
  return !(choices?.situations ?? []).includes(EVADE_ADVANTAGE_SITUATION);
}

/**
 * The lines of the end-of-combat Injury card for one combat (pp. 80, 96): each Attack's latest trusted Evade that earned an
 * Injury (a Natural 1 a Major, a Major Fail a Minor), for whoever rolled it that is no mob (a pet or mercenary too). A Dead
 * actor's line is kept and marked; a Dying one is not.
 * @param {object} combat
 * @param {{ messages?: Array<object>|{ contents: object[] } }} [options]
 * @returns {Array<{ id: string, actorUuid: string, actorName: string, grade: 'minor'|'major', cause: 'major_fail'|'natural_1', attackerName: string, round: number|null, dead: boolean }>}
 */
export function evadeInjuryLines(combat, { messages = globalThis.game?.messages } = {}) {
  const lines = [];
  for (const entry of combatEvadeInjuries(messages, { combatId: combat?.id, isTrusted: isTrustedEvade })) {
    const actor = resolveActorByUuid(entry.evaderUuid);
    if (!actor || actor.type === 'mob') continue;
    lines.push({
      id: entry.key,
      actorUuid: actor.uuid,
      actorName: actor.name ?? '',
      grade: entry.grade,
      cause: entry.grade === 'major' ? 'natural_1' : 'major_fail',
      attackerName: (entry.attackerUuid ? resolveActorByUuid(entry.attackerUuid)?.name : '') || '',
      round: entry.round,
      dead: isDead(actor)
    });
  }
  return lines;
}

/**
 * Land one queued Injury as its canon debuff. The repeat rule does the rest: a second of a grade becomes the Long-Term form,
 * a third asks the GM. Null when the ruling is cancelled or no GM can answer.
 * @param {object} actor
 * @param {'minor'|'major'} grade
 */
export async function landEvadeInjury(actor, grade) {
  return applyCondition(actor, EVADE_INJURY_DEBUFFS[grade]);
}
