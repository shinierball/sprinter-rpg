/**
 * Fast travel pace shuts out concealment (core p. 71; Question 1445 (d): Stealth too): a roll of Hide in Shadows or Stealth
 * while the party travels Fast asks a Rule Break and never blocks.
 */
import { confirmRuleBreak } from '../../utils/rule-break.mjs';
import { langText } from '../../utils/lang-text.mjs';
import { travelPace } from '../../utils/exploring/exploring-settings.mjs';
import { getRuleSkillIdentifier } from '../../utils/skill/rule-skills.mjs';

const TEXT = Object.freeze({
  'COG.TravelPace.ConcealTitle': 'Fast Pace',
  'COG.TravelPace.ConcealPrompt': 'The party is moving at a Fast pace: no Hide in Shadows or other concealment (core p. 71). Roll anyway as a Rule Break?'
});
const travelText = langText(TEXT);

/** The result of a roll that is not held back. */
const TRAVEL_GATE_CLEAR = Object.freeze({ proceed: true, ruleBreak: false, flags: Object.freeze({}) });

/**
 * @param {object} actor
 * @param {object} skill the Skill being rolled
 * @param {object} options the `rollSkill` options (`ruleBreak`, `interactive`)
 * @returns {Promise<{ proceed: boolean, ruleBreak: boolean, flags: object }>}
 */
export async function gateFastPaceConcealment(actor, skill, options = {}) {
  if (travelPace() !== 'fast') return TRAVEL_GATE_CLEAR;
  const identifier = String(skill?.system?.identifier ?? '');
  if (!identifier || ![getRuleSkillIdentifier('fastPaceHide'), getRuleSkillIdentifier('fastPaceSneak')].includes(identifier)) return TRAVEL_GATE_CLEAR;
  const reason = travelText('COG.TravelPace.ConcealPrompt');
  const verdict = await confirmRuleBreak({ title: travelText('COG.TravelPace.ConcealTitle'), message: reason, reason, options });
  return verdict.confirmed
    ? { proceed: true, ruleBreak: true, flags: { ruleBreak: true, travelRuleBreak: true } }
    : { proceed: false, ruleBreak: false, flags: {} };
}
