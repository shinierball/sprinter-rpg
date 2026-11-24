/**
 * Rule skills: the specific skills a book rule names ("make an Unopposed Endurance Skill Check"). The engine asks the
 * registry (`src/utils/skill/rule-skills.mjs`) for the skill by rule id and never names the identifier itself, so a module can
 * remap a rule to another skill. `identifier` is a skill's `system.identifier`.
 */
export const RULE_SKILLS = Object.freeze({
  fatigueCheck: Object.freeze({ id: 'fatigueCheck', identifier: 'endurance', label: 'Fatigue check (grinding past the safe hours, long marches)' }),
  fastPaceHide: Object.freeze({ id: 'fastPaceHide', identifier: 'hide-in-shadows', label: 'Hide in Shadows (shut out at a Fast travel pace)' }),
  fastPaceSneak: Object.freeze({ id: 'fastPaceSneak', identifier: 'stealth', label: 'Stealth (shut out at a Fast travel pace)' }),
  appraisal:Object.freeze({ id: 'appraisal', identifier: 'determine-value', label: 'Item appraisal (inventory values)' })
});
