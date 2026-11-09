/**
 * Text of the five-step combat round: Rule Break prompts and the tracker's declarations list.
 * The phase is called "Interrupt" in every new string.
 */

/** English fallbacks of the `COG.Combat.*` lang keys (lang/en.json holds the same text). */
export const COMBAT_ROUND_TEXT = Object.freeze({
  'COG.AuraPulse.Title': 'Aura Pulses: Round {round}',
  'COG.AuraPulse.Damage': '{amount} HP ({type})',
  'COG.AuraPulse.NoBarLost': 'no Health Bar lost ({type})',
  'COG.AuraPulse.DamageRoll': '{aura}: {formula} = {total} {type}',
  'COG.AuraPulse.Debuff': '+{debuff}',
  'COG.AuraPulse.Heal': '+{bars} bars',
  'COG.AuraPulse.Cleanse': 'cleansed {debuff}',
  'COG.AuraPulse.Failed': '{aura} failed on {name}: {message}',
  'COG.ZonePulse.Title': 'Zone Pulses: Round {round}',
  'COG.ZonePulse.Condition': '+{condition}',
  'COG.ZonePulse.Ended': '{zone} fades',
  'COG.ZonePulse.Placed': 'Area placed: {name}',
  'COG.ZonePulse.PlacedRounds': 'Lasts {rounds} round(s); it pulses at each Clean Up.',
  'COG.ZonePulse.PlacedUntilDismissed': 'Lasts until dismissed; it pulses at each Clean Up.',
  'COG.ZonePulse.PlacedMarker': 'Marks the area; it clears at the end of the round.',
  'COG.ZonePulse.Dismiss': 'Dismiss Zone',
  'COG.Combat.RuleBreakTitle': 'Rule Break',
  'COG.Combat.SkipStep': 'Jumping from {from} to {to} skips a step of the round. Jump ahead as a Rule Break?',
  'COG.Combat.BonusActionClaimed': '{name} has already claimed their AI Favor Bonus Action this round.',
  'COG.Combat.BonusActionNoFavor': '{name} does not have enough AI Favor ({favor} available, 1 required).',
  'COG.Combat.BonusActionAnyway': 'Spend it anyway as a Rule Break?',
  'COG.Combat.BonusActionLedger': 'Bonus Action ({name})',
  'COG.Combat.EndRoundOpenDeclarations': '{count} declared mob attack(s) are still unresolved. End the round anyway as a Rule Break?',
  'COG.Combat.Declarations': 'Declared Attacks',
  'COG.Combat.NoDeclarations': 'No mob attacks declared this round.',
  'COG.Combat.EvadeDC': 'Evade DC {dc}',
  'COG.Combat.AreaShort': 'Area',
  'COG.Combat.ResolveDeclared': 'Resolve now (Step 3)',
  'COG.Combat.StepPrev': 'Previous Combat Step',
  'COG.Combat.StepNext': 'Next Combat Step',
  'COG.Combat.EndRoundReset': 'End Round & Reset',
  'COG.Combat.EndRoundResetTip': 'Clean Up is done: end the round, reset every action and start the next round at Step 1.',
  'COG.Combat.StepsReadOnly': 'The GM moves the round along.',
  'COG.Combat.Resolved': 'Resolved',
  'COG.Combat.Redirected': 'Taunted',
  'COG.Combat.Intercepted': 'Caught',
  'COG.Combat.TargetStatus.declared': 'Awaiting Interrupt',
  'COG.Combat.TargetStatus.evaded': 'Evaded',
  'COG.Combat.TargetStatus.evaded-half': 'Evaded (half damage)',
  'COG.Combat.TargetStatus.hit': 'Evade failed',
  'COG.Combat.TargetStatus.resolved': 'Hit'
});

/** Localized text with a built-in English fallback (the test harness has no i18n). */
export function combatText(key, data = {}) {
  const i18n = globalThis.game?.i18n;
  if (i18n?.has?.(key) && typeof i18n.format === 'function') return i18n.format(key, data);
  return (COMBAT_ROUND_TEXT[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => String(data[k] ?? ''));
}
