/**
 * Localized prompt text of the transformation engine and the race applier, with an English fallback when no i18n
 * catalogue is loaded (the same arrangement as `raceClassText`). A leaf module.
 */
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
  'COG.TransformCard.NotPending': '{affliction} is no longer waiting to change {actor}.',
  'COG.TransformCard.NotAllowed': 'Only the GM or an owner of {actor} can do that.',
  'COG.TransformCard.NotFound': 'That character or affliction could not be found.',
  'COG.TransformCard.RefusePolicy': 'This world does not allow Rule Breaks.',
  'COG.TransformCard.Secret': '{affliction} landed on {actor}. It is held secret.',
  'COG.TransformCard.Reveal': 'Reveal to the player',
  'COG.TransformCard.Keep': 'Keep secret',
  'COG.TransformCard.SecretKept': '{affliction} stays secret on {actor}. Reveal it from the Session Manager Secrets tab.',
  'COG.TransformCard.SecretGone': 'That secret is no longer held.',
  'COG.TransformCard.GMOnly': 'Only the GM can do that.'
};

/**
 * @param {string} key one of the `COG.Transform.*` prompt keys above
 * @param {object} [data]
 * @returns {string}
 */
export function transformText(key, data = {}) {
  const i18n = globalThis.game?.i18n;
  if (i18n?.has?.(key) && typeof i18n.format === 'function') return i18n.format(key, data);
  return (TEMPLATES[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => String(data[k] ?? ''));
}
