/**
 * Localized prompt text of the transformation engine and the race applier, with an English fallback when no i18n
 * catalogue is loaded (the same arrangement as `raceClassText`). A leaf module.
 */
const TEMPLATES = {
  'COG.Transform.ConfirmChangeInto': 'Change {actor} into {form} now?',
  'COG.Transform.ConfirmChangeBy': '{actor} is changed by {affliction}. Apply it now?',
  'COG.Transform.HeldRevertInto': '{actor} has already changed into {form}. Revert anyway as a Rule Break?',
  'COG.Transform.HeldRevertBy': '{actor} is changed by {affliction}. Revert anyway as a Rule Break?',
  'COG.Transform.RaceReturnsTo': '{race} is what {actor} returns to when the change ends.'
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
