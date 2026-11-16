/**
 * What one AI Favor spent for Damage Reduction is multiplied by: the world setting `aiFavorDrStat`. The book says "Con" for a
 * race that pays AI Favor when damaged; its own note on Stats and Mods says the short form means the modifier, so the Mod is
 * the default and the full score is one setting away. Read by the `paidDrStat` scale source (`utils/roll/scalars.mjs`) and
 * registered in `settings/register-settings.mjs`; nothing else knows the setting.
 */
import { SYSTEM_ID } from '../../constants.mjs';

/** World setting key: the number one AI Favor spent for DR is scaled by. */
export const PAID_DR_STAT_SETTING = 'aiFavorDrStat';
export const PAID_DR_STAT_MODES = Object.freeze({ MOD: 'mod', STAT: 'stat' });

/**
 * The current mode. Anything but `stat` (an unregistered setting, a stray value) reads as `mod`.
 * @returns {'mod'|'stat'}
 */
export function paidDrStatMode() {
  let raw;
  try { raw = globalThis.game?.settings?.get?.(SYSTEM_ID, PAID_DR_STAT_SETTING); } catch { raw = undefined; }
  return raw === PAID_DR_STAT_MODES.STAT ? PAID_DR_STAT_MODES.STAT : PAID_DR_STAT_MODES.MOD;
}
