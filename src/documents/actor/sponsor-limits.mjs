/**
 * The Sponsor add check (core p. 284): a fourth Sponsor, or one before the Fourth Floor, is a Rule Break the player
 * confirms. Both ways a Sponsor reaches a crawler (a drop, the sheet's [+]) call `confirmSponsorAdd` before they create.
 */
import { confirmRuleBreak } from '../../utils/rule-break.mjs';
import { effectiveFloor } from '../../utils/character/race-class-floor.mjs';
import { sponsorAddBreaks, sponsorPlayBreaks, sponsorText } from '../../data/rules/sponsor-rules.mjs';
import { cameraSessionBreaks, cameraText, SPONSORS_CHOICE } from '../../utils/roll/cameras.mjs';

/**
 * Ask whether `actor` may take one more Sponsor. A crawler only; other actors are not limited.
 * @param {object} actor
 * @param {{ name?: string, options?: object }} [config] `name` is the Sponsor's name for the question
 * @returns {Promise<{ ok: boolean, ruleBreak: boolean, reason?: string }>} `reason` is the reasons joined, or a refusal code
 */
export async function confirmSponsorAdd(actor, { name = '', options } = {}) {
  if (actor?.type !== 'crawler') return { ok: true, ruleBreak: false };
  const held = Array.from(actor.items ?? []).filter((i) => i.type === 'sponsor').length;
  const reasons = sponsorAddBreaks({ held, floor: effectiveFloor(actor) });
  if (!reasons.length) return { ok: true, ruleBreak: false };
  const reason = reasons.join(' ');
  const answer = await confirmRuleBreak({
    title: sponsorText('COG.Sponsor.Limits.Title'),
    message: sponsorText('COG.Sponsor.Limits.Add', { name }),
    reason,
    detailLines: reasons,
    options
  });
  if (!answer.confirmed) return { ok: false, ruleBreak: false, reason: answer.refusal ?? 'cancelled' };
  return { ok: true, ruleBreak: true, reason };
}

/**
 * Ask whether `actor` may play to `choice` now: the Sponsors floor rule (core p. 281) and the once-per-session limit
 * (core p. 281). Every reason joins one Rule Break question. A macro's `options.cameras` string never reaches here.
 * @param {object} actor
 * @param {string} choice an audience id; '' is nothing to ask
 * @param {{ options?: object }} [config]
 * @returns {Promise<boolean>} false when refused (the choice is dropped)
 */
export async function confirmCameraPlay(actor, choice, { options } = {}) {
  if (!choice) return true;
  const reasons = [
    ...(choice === SPONSORS_CHOICE ? sponsorPlayBreaks(effectiveFloor(actor)) : []),
    ...cameraSessionBreaks(actor)
  ];
  if (!reasons.length) return true;
  const answer = await confirmRuleBreak({
    title: sponsorText('COG.Sponsor.Limits.Title'),
    message: cameraText('COG.Cameras.Session.Question'),
    reason: reasons.join(' '),
    detailLines: reasons,
    options
  });
  return answer.confirmed;
}
