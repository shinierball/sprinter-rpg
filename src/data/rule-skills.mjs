/**
 * Rule skills: the specific skills a book rule names ("make an Unopposed Endurance Skill Check"). The engine asks the
 * registry (`src/utils/rule-skills.mjs`) for the skill by rule id and never names the identifier itself, so a module can
 * remap a rule to another skill. `identifier` is a skill's `system.identifier`.
 */
export const RULE_SKILLS = Object.freeze({
  fatigueCheck: Object.freeze({ id: 'fatigueCheck', identifier: 'endurance', label: 'Fatigue check (grinding past the safe hours, long marches)' }),
  appraisal: Object.freeze({ id: 'appraisal', identifier: 'determine-value', label: 'Item appraisal (inventory values)' })
});
