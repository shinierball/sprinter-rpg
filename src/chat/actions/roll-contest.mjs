/**
 * "Roll Opposed Contest" chat button.
 */
import { resolveActorByUuid, isSameActor } from '../../utils/actor-uuid.mjs';
import { isOutOfRangeOnMessage } from '../../utils/attack/attack-range.mjs';

/**
 * @param {Event} event
 * @param {HTMLElement} button
 * @param {ChatMessage} message
 */
export async function handleRollContest(event, button, message) {
  const initiatorActor = resolveActorByUuid(button.dataset?.initiatorUuid);
  const initiatorId = initiatorActor?.id ?? '';
  const initiatorName = button.dataset?.initiatorName || 'Initiator';
  const itemName = button.dataset?.itemName || 'Ability';
  const contestType = button.dataset?.contestType || 'dc';
  const targetStat = button.dataset?.targetStat || 'dex';
  const targetSkill = button.dataset?.targetSkill || '';
  const dc = Number(button.dataset?.dc) || 10;
  const initiatorTotal = Number(button.dataset?.initiatorTotal) || 10;
  const onFailDebuff = button.dataset?.onFailDebuff || '';
  // The initiator's contest rank and the fail debuff's rank-break rounds, resolved on the initiator's client (3.10)
  const sourceRank = Number(button.dataset?.sourceRank) || 0;
  const durationRounds = Math.max(0, Math.floor(Number(button.dataset?.durationRounds) || 0));
  const onFailNotes = button.dataset?.onFailNotes || '';
  const onSuccessNotes = button.dataset?.onSuccessNotes || '';

  let targetTokens = Array.from(game.user?.targets || []);
  if (!targetTokens.length && canvas?.tokens?.controlled) {
    targetTokens = canvas.tokens.controlled.filter(t => t.actor && !isSameActor(t.actor, initiatorActor));
  }
  let targetActors = targetTokens.map(t => t.actor).filter(Boolean);
  // An attack's save is never rolled by a mob (3.48-9); the GM adjudicates it.
  if (button.dataset?.noMobRoll) targetActors = targetActors.filter(a => a.type !== 'mob');
  // A target the attack could not reach (3.48-8) makes no save.
  targetActors = targetActors.filter(a => !isOutOfRangeOnMessage(message, a, a.token?.id ?? null));

  if (!targetActors.length) {
    ui.notifications?.warn('Sprinter RPG | Please target or select the defender token to roll the contest.');
    return;
  }

  for (const defender of targetActors) {
    if (typeof defender.rollContestResponse === 'function') {
      await defender.rollContestResponse({
        initiatorId,
        initiator: initiatorActor,
        initiatorName,
        itemName,
        contestType,
        targetStat,
        targetSkill,
        dc,
        initiatorTotal,
        onFailDebuff,
        sourceRank,
        durationRounds,
        onFailNotes,
        onSuccessNotes
      });
    }
  }
}
