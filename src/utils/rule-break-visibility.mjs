/**
 * Who sees a GM's Rule Breaks (3.22-8, Q227 (a)). The world setting `showGmRuleBreaks` (default on: the AI cheats
 * openly) decides. When off, a `[RULE BREAK]` badge on a card a GM produced renders for GMs only, and a Rule Break
 * chat line a GM produces is whispered to GMs. Players still see their own Rule Breaks either way.
 *
 * Every chat card builds its badge with `ruleBreakBadgeHtml`; the one render-time check (`hideGmRuleBreakBadges`,
 * run by the chat render hook for every message) strips the marked badges. A card never decides visibility itself.
 */
import { SYSTEM_ID } from '../constants.mjs';
import { withRuleBreak } from './rule-break.mjs';

/** World setting: whether players see the GM's Rule Breaks. */
export const SHOW_GM_RULE_BREAKS_SETTING = 'showGmRuleBreaks';

/** The attribute that marks a badge as a Rule Break badge for the render-time check. */
export const RULE_BREAK_BADGE_ATTR = 'data-rule-break-badge';

/** Whether players may see the Rule Breaks a GM makes; anything unreadable means yes. */
export function showGmRuleBreaks() {
  try {
    const value = globalThis.game?.settings?.get?.(SYSTEM_ID, SHOW_GM_RULE_BREAKS_SETTING);
    return value !== false;
  } catch {
    return true;
  }
}

/**
 * A `[RULE BREAK]` badge for a chat card.
 * @param {{ cls?: string, style?: string, text?: string, title?: string }} [p]
 * @returns {string}
 */
export function ruleBreakBadgeHtml({ cls = 'cog-state-badge cog-badge-rule-break', style = '', text = '[RULE BREAK]', title = '' } = {}) {
  const styleAttr = style ? ` style="${style}"` : '';
  const titleAttr = title ? ` title="${title}"` : '';
  return `<span class="${cls}" ${RULE_BREAK_BADGE_ATTR}${styleAttr}${titleAttr}>${text}</span>`;
}

/**
 * The render-time check: remove the Rule Break badges of a message a GM produced from a player's view.
 * @param {HTMLElement} root the rendered message element
 * @param {ChatMessage} message
 * @returns {number} how many badges were removed
 */
export function hideGmRuleBreakBadges(root, message) {
  if (!root?.querySelectorAll || showGmRuleBreaks() || globalThis.game?.user?.isGM) return 0;
  const author = message?.author ?? message?.user;
  if (author?.isGM !== true) return 0;
  const badges = [...root.querySelectorAll(`[${RULE_BREAK_BADGE_ATTR}]`)];
  for (const badge of badges) badge.remove();
  return badges.length;
}

/**
 * Chat data for a message that reports a Rule Break: stamped as one, and whispered to GMs when a GM produces it and
 * the setting is off.
 * @param {object} data ChatMessage create data
 * @returns {object}
 */
export function ruleBreakMessageData(data) {
  const stamped = withRuleBreak(data);
  if (!globalThis.game?.user?.isGM || showGmRuleBreaks()) return stamped;
  const whisper = globalThis.ChatMessage?.getWhisperRecipients?.('GM')?.map(u => u.id) ?? [];
  return whisper.length ? { ...stamped, whisper } : stamped;
}
