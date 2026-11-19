/**
 * Localized prompt text of the transformation engine and the race applier, with an English fallback when no i18n
 * catalogue is loaded (the same arrangement as `raceClassText`). A leaf module.
 */
import { langText } from '../lang-text.mjs';
const TEMPLATES = {
  'COG.Transform.ConfirmChangeInto': 'Change {actor} into {form} now?',
  'COG.Transform.ConfirmChangeBy': '{actor} is changed by {affliction}. Apply it now?',
  'COG.Transform.HeldRevertInto': '{actor} has already changed into {form}. Revert anyway as a Rule Break?',
  'COG.Transform.HeldRevertBy': '{actor} is changed by {affliction}. Revert anyway as a Rule Break?',
  'COG.Transform.RaceReturnsTo': '{race} is what {actor} returns to when the change ends.',
  'COG.Transform.KeepTrained': 'The change is ending. Keep the skills {actor} trained while changed, at the ranks earned: {skills}?',
  // The reminder cards (identical to the `COG.TransformCard` entries in lang/en.json; a test keeps them in step)
  'COG.TransformCard.Landed': '{affliction} landed on {actor}.',
  'COG.TransformCard.Death': '{actor} is at 0 Health with {affliction} pending.',
  'COG.TransformCard.Change': 'Change {actor} now',
  'COG.TransformCard.NoRace': 'Only crawlers change race; the added effects still apply.',
  'COG.TransformCard.Held': '{actor} is held by {affliction}: its cure window is closed.',
  'COG.TransformCard.Revert': 'Revert as a Rule Break',
  'COG.TransformCard.HiddenEffect': 'A hidden effect',
  'COG.TransformCard.NotPending': '{affliction} is no longer waiting to change {actor}.',
  'COG.TransformCard.NotAllowed': 'Only the GM or an owner of {actor} can do that.',
  'COG.TransformCard.NotFound': 'That character or affliction could not be found.',
  'COG.TransformCard.RefusePolicy': 'This world does not allow Rule Breaks.',
  'COG.TransformCard.Secret': '{affliction} landed on {actor}. It is held secret.',
  'COG.TransformCard.Reveal': 'Reveal to the player',
  'COG.TransformCard.Keep': 'Keep secret',
  'COG.TransformCard.SecretKept': '{affliction} stays secret on {actor}. Reveal it from the Session Manager Secrets tab.',
  'COG.TransformCard.SecretGone': 'That secret is no longer held.',
  'COG.TransformCard.GMOnly': 'Only the GM can do that.',
  'COG.TransformCard.FloorStill': 'The floor changed. {actor} still carries {affliction}.',
  'COG.TransformCard.RestStill': '{actor} rested. {affliction} is still waiting to change them.',
  'COG.TransformCard.HeldFloor': 'The floor changed. {affliction} is held secret on {actor}.',
  'COG.TransformCard.HeldRest': '{actor} rested. {affliction} is held secret.',
  'COG.TransformCard.ChangeNow': 'Change now',
  'COG.TransformCard.WindowClosed': '{affliction} on {actor} can no longer be cured freely.',
  'COG.TransformCard.TakenOff': 'Taken off: {items}.',
  'COG.TransformCard.PutBack': 'Put back on: {items}.',
  'COG.TransformCard.LeftOff': 'Left off: {items}.',
  'COG.TransformCard.LeftOffFit': 'does not fit',
  'COG.TransformCard.LeftOffBroken': 'broken',
  'COG.TransformCard.LeftOffRuleBreak': 'needs a Rule Break'
};

/**
 * @param {string} key one of the `COG.Transform.*` prompt keys above
 * @param {object} [data]
 * @returns {string}
 */
export const transformText = langText(TEMPLATES);

/**
 * The name a public card shows for a debuff entry: a secret one is "A hidden effect" so no card names it before the GM
 * reveals it. `fallback` is the label the card would show otherwise (default: the entry's own name).
 * @param {{ name?: string, system?: { secret?: boolean } }|null|undefined} entry
 * @param {string} [fallback]
 * @returns {string}
 */
export function effectCardName(entry, fallback = entry?.name ?? '') {
  return entry?.system?.secret === true ? transformText('COG.TransformCard.HiddenEffect') : String(fallback ?? '');
}
