/**
 * Numbers and words of the stock attack reasons (core rulebook pp. 83-85). Pure data: the detectors read them.
 */

/** A target this many sizes larger gives Advantage, this many smaller gives Disadvantage (p. 85). */
export const SIZE_GAP_FOR_ADVANTAGE = 4;

/** What a detector says about one reason: ticked, left unticked on purpose, or unable to tell. */
export const DETECTED = Object.freeze({ yes: 'yes', no: 'no', unknown: 'unknown' });

/** Melee range is 5 ft, and 10 ft with a Reach weapon (p. 82). */
export const MELEE_REACH_FEET = 5;
export const REACH_WEAPON_FEET = 10;

/** Tags that make a weapon or attack a Reach one. */
export const REACH_TAGS = Object.freeze(['weaponProp.reach', 'weaponGroup.reach']);
