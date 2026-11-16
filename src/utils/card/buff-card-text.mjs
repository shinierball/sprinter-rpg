/**
 * The words of the Apply Buff button's second-copy Rule Break and the Apply buttons of a use card: Foundry's i18n when it has the key, else the
 * bundled default, which is identical to the entry in lang/en.json.
 */
const TEXT = Object.freeze({
  'COG.BuffCard.AppliedOnUse': 'Applied on use',
  'COG.BuffCard.DuplicateTitle': 'Buff Already Applied',
  'COG.BuffCard.DuplicateMessage': '{actor} already has {buff}. Apply a second copy as a Rule Break?',
  'COG.BuffCard.CapTitle': 'Buff at Its Cap',
  'COG.BuffCard.CapMessage': '{actor} already has {count} of {cap} copies of {buff}. Add another as a Rule Break?',
  'COG.BuffCard.RuleBreakLine': '{actor} took a second copy of {buff} as a Rule Break.',
  'COG.BuffCard.ApplyTo': 'Apply to {target}',
  'COG.BuffCard.Lasts': 'Lasts {duration}',
  'COG.BuffCard.To': 'To: {target}',
  'COG.BuffCard.WithinFeet': '{target} within {feet} ft',
  'COG.BuffCard.AtRank': 'Rank {rank}',
  'COG.BuffCard.Remove': 'Remove',
  'COG.BuffCard.AppliedTo': 'Applied to: {names}.',
  'COG.BuffCard.NotMeasured': 'Distance was not measured.',
  'COG.BuffCard.NotAllowed': "Only the caster's owner or a GM can apply this.",
  'COG.BuffCard.ReachTitle': 'Buff Beyond Its Rules',
  'COG.BuffCard.ReachMessage': 'Some recipients are outside what this buff reaches. Apply it to them anyway as a Rule Break?',
  'COG.BuffCard.Reason.out-of-reach': 'out of reach',
  'COG.BuffCard.Reason.not-on-scene': 'not on this scene',
  'COG.BuffCard.Reason.wrong-kind': 'not a valid kind of target',
  'COG.BuffCard.Reason.other-side': 'on the opposing side',
  'COG.BuffCard.Reason.immune': 'immune',
  'COG.BuffCard.RankTitle': 'Buff Rank',
  'COG.BuffCard.RankMessage': 'What Rank does {buff} land at? Closing this lands it at Rank 0, where every row counts.',
  'COG.BuffCard.RankLabel': 'Rank',
  'COG.BuffCard.RankConfirm': 'Land it',
  'COG.BuffCard.RankBreakTitle': 'Rank Beyond the Limit',
  'COG.BuffCard.RankBreakMessage': '{buff} at Rank {rank} is above the usual limit of Rank {cap}. Land it anyway as a Rule Break?'
});

export function buffCardText(key, data = {}) {
  const i18n = globalThis.game?.i18n;
  if (i18n?.has?.(key) && typeof i18n.format === 'function') return i18n.format(key, data);
  return String(TEXT[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => String(data[k] ?? ''));
}
