/**
 * Strings of the attack choices engine: the pre-fill hints, the Rule
 * Break reasons and the confirm dialog. Each key lives in `lang/en.json` under `COG.AttackChoices`; this table is the
 * fallback when no i18n catalogue is loaded (headless tests, a world on another language that lacks the key).
 */
const TEXT = Object.freeze({
  'COG.AttackChoices.Hint.NotOffered': 'Your last pick is not available for this attack.',
  'COG.AttackChoices.Hint.Untrained': 'Last pick {name} is untrained now.',
  'COG.AttackChoices.Hint.Cooldown': 'Last pick {name} is on cooldown ({left}).',
  'COG.AttackChoices.Hint.Variant': 'Last pick variant not available at Rank {rank}.',
  'COG.AttackChoices.Reason.Untrained': "{name} is untrained (Rank 0). A Passive Skill can't be used without Ranks.",
  'COG.AttackChoices.Reason.Cooldown': '{name} is on cooldown ({left}).',
  'COG.AttackChoices.Reason.Multiple': 'More than one Damage Effect on one attack (only one is allowed).',
  'COG.AttackChoices.Reason.NotOffered': '{name} does not apply to {attack}.',
  'COG.AttackChoices.Reason.Variant': '{variant} needs {name} Rank {rank}.',
  'COG.SpellCast.Reason.NotCast': '{name} was not cast.',
  'COG.SpellCast.AttackTooltip': 'Roll Spell Attack for the latest cast (1d20 + Rank {rank} + {stat} Mod)',
  'COG.SpellCast.HudAttack': 'Roll Spell Attack: {name} (1d20 + Rank {rank} + {stat} Mod)',
  'COG.SpellCast.HudDamage': 'Roll Spell Damage: {name} ({formula})',
  'COG.SpellCast.RollAttack': 'Roll Spell Attack',
  'COG.SpellCast.DeclareAttack': 'Declare Attack',
  'COG.SpellCast.NotOwner': 'You do not own {name}.',
  'COG.AttackChoices.Confirm.Title': 'Rule Break Confirmation',
  'COG.AttackChoices.Confirm.Question': 'Proceed as a Rule Break?',
  'COG.AttackOptions.Title': '{name}: Attack Options',
  'COG.AttackOptions.RollAttack': 'Roll Attack',
  'COG.AttackOptions.RollDamage': 'Roll Damage',
  'COG.AttackOptions.RollHitEffects': 'Roll Hit Effects (no damage)',
  'COG.AttackOptions.Cancel': 'Cancel',
  'COG.AttackOptions.Formula': 'Plain roll: {formula}',
  'COG.AttackOptions.DamageEffect': 'Damage Effect',
  'COG.AttackOptions.Maneuvers': 'Maneuvers',
  'COG.AttackOptions.Situations': 'Situations',
  'COG.AttackOptions.CalledPlay': 'Called Play',
  'COG.AttackOptions.Mark': 'Mark for advancement',
  'COG.AttackOptions.MarkAttack': 'Attack skill',
  'COG.AttackOptions.MarkEffect': 'Damage Effect skill',
  'COG.AttackOptions.None': 'No Damage Effect',
  'COG.AttackOptions.NoneDesc': 'Standard attack without consuming an effect.',
  'COG.AttackOptions.AiFavor': 'AI Favor rating {n}',
  'COG.AttackOptions.Rank': 'R{n}',
  'COG.AttackOptions.RuleBreak': 'Rule Break',
  'COG.AttackOptions.Untrained': 'Untrained',
  'COG.AttackOptions.AddAnother': 'Add another (Rule Break)',
  'COG.AttackOptions.VariantNormal': 'Normal',
  'COG.AttackOptions.VariantNeeds': 'Rank {n}',
  'COG.AttackOptions.From': 'from {source}',
  'COG.AttackOptions.Used': '(already used this floor: Rule Break)',
  'COG.AttackOptions.ReadsAs': 'Reads as: {text}',
  'COG.AttackOptions.SkipHint': 'Shift-click an attack to roll your last pick without this window.'
});

/** A string by key, formatted with `{name}` data; works without a loaded i18n catalogue. */
export function attackText(key, data = {}) {
  const i18n = globalThis.game?.i18n;
  if (i18n?.has?.(key) && typeof i18n.format === 'function') return i18n.format(key, data);
  return (TEXT[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => String(data[k] ?? ''));
}
