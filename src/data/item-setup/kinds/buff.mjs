/**
 * src/data/item-setup/kinds/buff.mjs
 * The buff page: its name, how long it lasts and one first effect (a stat, Damage Resistance, attack rolls or bonus damage).
 * More effects of every kind are added on the sheet.
 */
import { registerSetupKind } from '../registry.mjs';
import { NAME_FIELD, durationSpec, nameSpec } from '../answers.mjs';
import { firstEffectRows, FIRST_EFFECTS } from '../first-effect.mjs';
import { durationConfigText } from '../../../utils/time/durations.mjs';

/** How long a new buff lasts when the answer is unusable. */
const START_DURATION = Object.freeze({ value: 1, unit: 'hours' });

/** The "Duration (text)" note beside the timed answer; nothing when the config has no words, so the model default stays. */
const durationNote = (cfg) => { const duration = durationConfigText(cfg); return duration ? { duration } : {}; };

registerSetupKind({
  id: 'buff',
  icon: 'fa-angles-up',
  order: 90,
  createType: 'buff',
  fields: Object.freeze([
    NAME_FIELD,
    Object.freeze({ id: 'duration', type: 'duration' }),
    Object.freeze({ id: 'effect', type: 'choice', options: FIRST_EFFECTS.buff, rerender: true }),
    Object.freeze({ id: 'effectStat', type: 'choice', source: 'stats', when: { field: 'effect', in: ['stat'] } }),
    Object.freeze({ id: 'amount', type: 'number', min: 1, when: { field: 'effect', in: ['stat', 'dr', 'toHit'] } }),
    Object.freeze({ id: 'dice', type: 'text', placeholder: 'COG.ItemSetup.Kind.buff.dice.Placeholder', when: { field: 'effect', in: ['damage'] } })
  ]),
  start: () => ({ name: '', duration: { ...START_DURATION }, effect: 'stat', effectStat: 'str', amount: 1, dice: '' }),
  toSpec(answers) {
    const duration = durationSpec(answers?.duration);
    const durationConfig = duration.type ? duration : { type: START_DURATION.unit, value: START_DURATION.value };
    return { ...nameSpec(answers), system: { durationConfig, ...durationNote(durationConfig), ...firstEffectRows('buff', answers) } };
  }
});
