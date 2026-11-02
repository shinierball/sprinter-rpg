/** Step kind `popularity`: Cha Mod times `multiplier`, written by `mode` (`set` on Floor 3, `add` on Floors 4 and 5). Reads the working Cha. */
import { getCOGStatModifier } from '../../../documents/actor/actor-constants.mjs';
import { cleanInt } from '../state.mjs';

function amount(step, state) {
  const mod = getCOGStatModifier(state.abilities.cha.value);
  const multiplier = cleanInt(step.multiplier) ?? 1;
  return { mod, multiplier, value: mod * multiplier };
}

export const popularityStep = {
  kind: 'popularity',
  plan(step, state) {
    const a = amount(step, state);
    return { current: state.popularity, mode: step.mode ?? 'add', chaMod: a.mod, multiplier: a.multiplier, value: a.value };
  },
  resolve(step, stepSpec, state) {
    const a = amount(step, state);
    const before = state.popularity;
    state.popularity = (step.mode ?? 'add') === 'set' ? a.value : before + a.value;
    state.popularityChanged = true;
    state.log({
      step: step.id, kind: 'popularity', label: 'Popularity', formula: `Cha Mod ${a.mod} x ${a.multiplier}`,
      total: a.value, rolled: false, computed: true, before, after: state.popularity
    });
  }
};
