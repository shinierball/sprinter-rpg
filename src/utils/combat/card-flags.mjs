/**
 * Flags the attack and call chat cards carry that the combat engine reads: the rows of targets an attack card was
 * rolled against, who attacked, which combat the card belongs to and the Mob Advantage the card rolled. Readers only;
 * the roll code stamps them when it builds the message data.
 */
import { readFlag, readFlags } from '../flags.mjs';

const TARGET_RESULTS_FLAG = 'targetResults';
const ATTACKER_UUID_FLAG = 'attackerUuid';
const ATTACKER_ID_FLAG = 'attackerId';
const COMBAT_ID_FLAG = 'combatId';
const MOB_ADVANTAGE_FLAG = 'mobAdvantage';
const CURRENT_FLOOR_FLAG = 'currentFloor';
const SOURCE_MESSAGE_FLAG = 'sourceMessageId';

/**
 * What an attack card (a hit roll or a mob's declared auto-hit) says about the attack, its item and the target number it
 * set (a key the card does not carry reads `undefined`); null for no message.
 */
export const attackCardOf = (message) => (message ? readFlags(message, [
  'isAutoHit', 'isAttackRoll', 'isArea', 'isSpellAttack', 'targetDC', 'effectiveEvadeDC', 'attackerName',
  'attackItemId', 'attackItemUuid', 'attackItemName', 'aiFavorBonus'
]) : null);

/** The floor an attack card was rolled on (as stored: a number, a numeric string, or unset). */
export const cardFloorOf = (message) => readFlag(message, CURRENT_FLOOR_FLAG);

/** The id of the card a damage card or Evade answers (the attack or check card it was rolled from). */
export const sourceMessageIdOf = (message) => readFlag(message, SOURCE_MESSAGE_FLAG);

/** The per-target result rows an attack card was rolled against (may be anything but an array on bad data). */
export const targetResultsOf = (message) => readFlag(message, TARGET_RESULTS_FLAG);

/** The uuid of the actor that made the attack the card describes. */
export const attackerUuidOf = (message) => readFlag(message, ATTACKER_UUID_FLAG);

/** The id of the actor that made the attack the card describes. */
export const attackerIdOf = (message) => readFlag(message, ATTACKER_ID_FLAG);

/** The id of the combat the card was posted in. */
export const cardCombatIdOf = (message) => readFlag(message, COMBAT_ID_FLAG);

/** The Mob Advantage state the attack card rolled. */
export const mobAdvantageOf = (message) => readFlag(message, MOB_ADVANTAGE_FLAG);
