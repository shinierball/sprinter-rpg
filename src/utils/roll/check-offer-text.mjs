/**
 * The words of the after-roll offers on a check card (`COG.CheckOffer.*` in lang/en.json), with English fallbacks for the
 * headless test world, which has no i18n.
 */

const TEXT = Object.freeze({
  Title: 'After the roll',
  RowReroll: 'Reroll: {label} ({source})',
  Shift: 'Use {label}: {from} → {to}',
  RerollCardFlavor: '{name}: reroll of {check} ({source})',
  Rerolled: 'Rerolled ({source}): {old} → {new}',
  Shifted: 'Shifted ({source}): {from} → {to}',
  Refused: 'The reroll was not applied ({reason}).',
  RuleBreak: 'Rule Break',
  AiFavorReroll: 'Reroll (1 AI Favor): {have} left',
  SourceAiFavor: 'AI Favor',
  Apply: "Apply to {name}'s check",
  NotApplied: 'This reroll has not reached its check yet. The GM can apply it.',
  LedgerReason: 'Reroll: {check}',
  LedgerNote: 'Rerolled: was {old}',
  RuleBreakTitle: 'Reroll Rule Break',
  Anyway: 'Reroll anyway as a Rule Break?',
  'Reason.natural-one': 'A Natural 1 cannot be rerolled.',
  'Reason.already-rerolled': 'This Check was already rerolled with AI Favor.',
  'Reason.no-favor': 'Not enough AI Favor ({have}/{need}).',
  'Reason.applied': 'The result was already applied.'
});

/**
 * Localized offer text: `COG.CheckOffer.<key>` through `game.i18n` when it knows the key, else the English fallback.
 * @param {keyof TEXT} key
 * @param {Record<string, string|number>} [data] `{name}` placeholders
 */
export function checkOfferText(key, data = {}) {
  const full = `COG.CheckOffer.${key}`;
  const i18n = globalThis.game?.i18n;
  try {
    const s = Object.keys(data).length ? i18n?.format?.(full, data) : i18n?.localize?.(full);
    if (typeof s === 'string' && s && s !== full) return s;
  } catch {
    // fall through to the fallback
  }
  return Object.entries(data).reduce((acc, [k, v]) => acc.replaceAll(`{${k}}`, String(v)), TEXT[key] ?? full);
}
