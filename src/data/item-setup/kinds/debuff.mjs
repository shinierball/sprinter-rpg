/**
 * src/data/item-setup/kinds/debuff.mjs
 * The debuff page: its name (which makes the condition other rules apply), how bad, what ends it and one first effect.
 * A debuff with no effect is still a condition other things can check for.
 */
import { registerSetupKind } from '../registry.mjs';
import { NAME_FIELD, durationSpec, nameSpec, text } from '../answers.mjs';
import { firstEffectRows, FIRST_EFFECTS } from '../first-effect.mjs';
import { durationConfigText } from '../../../utils/time/durations.mjs';
import { DEBUFF_SEVERITIES } from '../../../models/items/debuff-model.mjs';

/** What ends a new debuff when the answer is unusable. */
const START_DURATION = Object.freeze({ value: 0, unit: 'combat' });

/** The "Duration (text)" note beside the timed answer; nothing when the config has no words, so the model default stays. */
const durationNote = (cfg) => { const duration = durationConfigText(cfg); return duration ? { duration } : {}; };

registerSetupKind({
  id: 'debuff',
  icon: 'fa-angles-down',
  order: 100,
  createType: 'debuff',
  fields: Object.freeze([
    NAME_FIELD,
    Object.freeze({ id: 'severity', type: 'choice', options: DEBUFF_SEVERITIES }),
    Object.freeze({ id: 'duration', type: 'duration' }),
    Object.freeze({ id: 'effect', type: 'choice', options: FIRST_EFFECTS.debuff, rerender: true }),
    Object.freeze({ id: 'effectStat', type: 'choice', source: 'stats', when: { field: 'effect', in: ['statPenalty'] } }),
    Object.freeze({ id: 'amount', type: 'number', min: 1, when: { field: 'effect', in: ['statPenalty', 'toHit'] } }),
    Object.freeze({ id: 'dice', type: 'text', placeholder: 'COG.ItemSetup.Kind.debuff.dice.Placeholder', when: { field: 'effect', in: ['perRound'] } }),
    Object.freeze({ id: 'damageType', type: 'choice', source: 'damageTypes', when: { field: 'effect', in: ['perRound'] } })
  ]),
  start: () => ({ name: '', severity: DEBUFF_SEVERITIES[0], duration: { ...START_DURATION }, effect: 'none', effectStat: 'str', amount: 1, dice: '', damageType: '' }),
  toSpec(answers) {
    const duration = durationSpec(answers?.duration);
    const durationConfig = duration.type ? duration : { type: START_DURATION.unit, value: START_DURATION.value };
    const severity = DEBUFF_SEVERITIES.includes(text(answers?.severity)) ? text(answers.severity) : DEBUFF_SEVERITIES[0];
    return { ...nameSpec(answers), system: { severity, durationConfig, ...durationNote(durationConfig), ...firstEffectRows('debuff', answers) } };
  }
});
