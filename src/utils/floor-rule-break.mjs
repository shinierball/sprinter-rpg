/**
 * The roll card's mark for a once-per-floor row used again on the same floor. `resolveRollToggles` reports it as
 * `floorRuleBreak`; the card then carries `ruleBreak: true` like the
 * mana and cooldown Rule Breaks and shows one line, so the GM sees it while adjudicating (CONTRIBUTING rule 2).
 */

export const FLOOR_RULE_BREAK_TEXT = '(once per floor) Rule Break';

/**
 * @param {{ floorRuleBreak?: boolean }|null|undefined} toggles the `resolveRollToggles` result
 * @returns {{ flags: { ruleBreak?: true }, html: string }} spread `flags` into the card flags; append `html` to its content
 */
export function floorRuleBreakCard(toggles) {
  if (toggles?.floorRuleBreak !== true) return { flags: {}, html: '' };
  return {
    flags: { ruleBreak: true },
    html: `<div class="cog-rule-break-line cog-text-accent" style="font-size: 11px; font-weight: bold; margin-top: 4px;">${FLOOR_RULE_BREAK_TEXT}</div>`
  };
}
