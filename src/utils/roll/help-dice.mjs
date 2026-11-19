/**
 * Help in the roll dialog: the client setting that decides whether the dialog opens for helpers alone, and the text of a
 * helper's line key. Pure reads; the lines themselves are built in `documents/actor/help-check.mjs`.
 */
import { SYSTEM_ID } from '../../constants.mjs';

export const HELP_PROMPT_SETTING = 'helpPrompt';

/** Whether this client asks who helps before an out-of-combat Skill Check (default on; on when the setting is not registered). */
export function helpPromptOn() {
  try {
    return globalThis.game?.settings?.get?.(SYSTEM_ID, HELP_PROMPT_SETTING) !== false;
  } catch {
    return true;
  }
}

/** The stable key of one helper line: the helper's uuid and the skill (an owned item id, or the catalog skill's identifier). */
export function helpLineKey(helperUuid, skillKey) {
  return `${helperUuid}|${skillKey}`;
}
