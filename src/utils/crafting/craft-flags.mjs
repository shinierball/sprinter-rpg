/**
 * The two flags crafting leaves: `crafted` (provenance on an item a crafting run made) and `craft` (the grade on a crafting
 * check's chat card: dc, tableTier, outcome, margin). This module owns those words.
 */
import { readFlag, flagPath } from '../flags.mjs';

const CRAFTED = 'crafted';
const CRAFT = 'craft';

/** The update fragment that stamps an item as made by a crafting run: `item.update(craftedUpdate(record))`. */
export const craftedUpdate = (record) => ({ [flagPath(CRAFTED)]: record });

/** `{ dc, tableTier, outcome, margin }` on a crafting check's card (undefined when the card is not one). */
export const craftGradeOf = (message) => readFlag(message, CRAFT);

/** The flag fragment of a crafting check's grade, to merge with `withFlags` beside other flags. */
export const craftGradePatch = (grade) => ({ [CRAFT]: grade });

/** The update fragment that regrades a crafting check's card after a reroll: `message.update(craftRegradeUpdate(...))`. */
export const craftRegradeUpdate = ({ outcome, margin }) => ({ [flagPath(`${CRAFT}.outcome`)]: outcome, [flagPath(`${CRAFT}.margin`)]: margin });
