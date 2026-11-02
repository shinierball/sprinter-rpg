/**
 * The words of the Apply Buff button's second-copy Rule Break (3.85): Foundry's i18n when it has the key, else the
 * bundled default, which is identical to the entry in lang/en.json.
 */
const TEXT = Object.freeze({
  'COG.BuffCard.AppliedOnUse': 'Applied on use',
  'COG.BuffCard.DuplicateTitle': 'Buff Already Applied',
  'COG.BuffCard.DuplicateMessage': '{actor} already has {buff}. Apply a second copy as a Rule Break?',
  'COG.BuffCard.RuleBreakLine': '{actor} took a second copy of {buff} as a Rule Break.'
});

export function buffCardText(key, data = {}) {
  const i18n = globalThis.game?.i18n;
  if (i18n?.has?.(key) && typeof i18n.format === 'function') return i18n.format(key, data);
  return String(TEXT[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => String(data[k] ?? ''));
}
