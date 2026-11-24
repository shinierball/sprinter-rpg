/**
 * Page 0 window settings (two client-scope settings, so nothing here is world data): which page a character sheet opens
 * on, and the size the user last gave the play page. Pure of any sheet; `src/sheets/crawler/page-zero-window.mjs` uses it.
 */
import { SYSTEM_ID } from '../../constants.mjs';
import { readSetting } from './read-setting.mjs';

/** Client setting: where a character sheet opens. */
export const PAGE_ZERO_OPENING_SETTING = 'pageZeroOpening';
/** Client setting: the size the user last gave the sheet on page 0, `{ width, height }`. */
export const PAGE_ZERO_SIZE_SETTING = 'pageZeroSize';

/** The opening choices. `DEFAULT` follows the role: players open on the play page, the GM on the full sheet. */
export const PAGE_ZERO_OPENING = Object.freeze({ DEFAULT: 'default', PLAY: 'play', FULL: 'full' });

/** The size page 0 opens at the first time. */
const PAGE_ZERO_DEFAULT_SIZE = Object.freeze({ width: 400, height: 720 });

/**
 * Whether a user's sheets open on page 0 (before any check that the actor is offered page 0).
 * @param {User} [user=game.user]
 * @param {string} [choice] the setting value; read from the setting when omitted
 */
export function opensOnPageZero(user = globalThis.game?.user, choice = readSetting(PAGE_ZERO_OPENING_SETTING)) {
  if (choice === PAGE_ZERO_OPENING.PLAY) return true;
  if (choice === PAGE_ZERO_OPENING.FULL) return false;
  return !user?.isGM;
}

/** The remembered page 0 size, or the default when none is stored or the stored value is not a usable size. */
export function readPageZeroSize() {
  const stored = readSetting(PAGE_ZERO_SIZE_SETTING);
  const width = Number(stored?.width);
  const height = Number(stored?.height);
  if (!(width > 0) || !(height > 0)) return { ...PAGE_ZERO_DEFAULT_SIZE };
  return { width: Math.round(width), height: Math.round(height) };
}

/** Remember a page 0 size. Nothing is written when it is not a usable size or is already the stored one. */
export function savePageZeroSize({ width, height }) {
  if (!(Number(width) > 0) || !(Number(height) > 0)) return;
  const next = { width: Math.round(width), height: Math.round(height) };
  const stored = readSetting(PAGE_ZERO_SIZE_SETTING);
  if (stored && stored.width === next.width && stored.height === next.height) return;
  globalThis.game?.settings?.set?.(SYSTEM_ID, PAGE_ZERO_SIZE_SETTING, next);
}
