/**
 * The XP weighting setting: how an encounter's XP pool is split between crawlers. Lives below the apps so the
 * settings registration and the tracker read one key and one default shape.
 */

/** World setting holding the saved XP weights (written by the combat archive's "Save Defaults"). */
export const XP_CONFIG_SETTING = 'xpConfig';

/** Percent of the pool each kind of contribution earns; the five total 100. */
export const DEFAULT_XP_WEIGHTS = Object.freeze({
  damageDealt: 35,
  damageTaken: 25,
  defensive: 15,
  tactical: 15,
  buff: 10
});
