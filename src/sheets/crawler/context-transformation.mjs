/**
 * Display data for transformations on the crawler sheet's Conditions tab: the stage badge, the Change,
 * Change form and Revert controls on an affliction's row, and the banner line at the top of the tab. All of it is read
 * from the affliction's structured fields and engine state; no name or description is ever read.
 */
import { COGRaceClassApplier } from '../../data/race-class-applier.mjs';
import { canSwitchDebuff } from '../../documents/actor/debuff-switch.mjs';
import { isAffliction, afflictionStage, transformState, formEntries } from '../../utils/character/transform-rules.mjs';

const loc = (key) => globalThis.game?.i18n?.localize?.(key) ?? key;
const fmt = (key, data) => globalThis.game?.i18n?.format?.(key, data) ?? key;

/** What a form row is called: its label, else the race's name, else the reference itself. */
function formName(row) {
  return row.label || COGRaceClassApplier.findRace(row.race)?.name || row.race;
}

/**
 * @param {Actor} actor
 * @param {object} item an affliction (a debuff with a `transform` block) of `actor`
 * @returns {object|null} null when the debuff is not an affliction
 */
export function afflictionView(actor, item) {
  if (!isAffliction(item)) return null;
  const stage = afflictionStage(item);
  const state = transformState(item);
  const forms = formEntries(item).map((row, index) => ({ index, name: formName(row) }));
  const acts = canSwitchDebuff(actor?.items?.get(item.id) ?? item);
  const isCrawler = actor?.type === 'crawler';
  const formIndex = Number.isInteger(Number(state.formIndex)) ? Number(state.formIndex) : -1;
  const changed = stage === 'changed';
  const current = forms.find((f) => f.index === formIndex);
  return {
    id: item.id,
    name: item.name,
    stage,
    stageLabel: loc(changed ? 'COG.Transform.Changed' : 'COG.Transform.Pending'),
    isChanged: changed,
    canChange: acts && stage === 'pending',
    canRevert: acts && changed,
    // A form switch needs a race change (crawlers only) and at least one form to switch between (or back from)
    canSwitchForm: acts && changed && isCrawler && forms.length > 0,
    formOptions: [
      { value: -1, label: loc('COG.Transform.OriginalBody'), selected: formIndex === -1 },
      ...forms.map((f) => ({ value: f.index, label: f.name, selected: f.index === formIndex }))
    ],
    banner: changed
      ? (current
        ? fmt('COG.Transform.ChangedInto', { actor: actor.name, form: current.name, affliction: item.name })
        : fmt('COG.Transform.ChangedOnly', { actor: actor.name, affliction: item.name }))
      : ''
  };
}
