/** Step kind `raceClass`: records the chosen Race and Class identifiers; `applyFloorArrival` applies them last. Empty means choose later on the sheet. */
import { cleanText } from '../state.mjs';

export const raceClassStep = {
  kind: 'raceClass',
  plan(step, state) {
    return { hasRace: Boolean(state.snapshot.hasRace), hasClass: Boolean(state.snapshot.hasClass) };
  },
  resolve(step, stepSpec, state) {
    const race = cleanText(stepSpec?.race);
    const klass = cleanText(stepSpec?.class);
    if (!race && !klass) return;
    state.raceClass = { race, class: klass };
    state.log({ step: step.id, kind: 'raceClass', label: [race, klass].filter(Boolean).join(' / '), rolled: false });
  }
};
