/** The `rollTotal` flag of a skill or contest roll's chat card: the d20 roll's total. This module owns that word. */
import { readFlag } from '../flags.mjs';

const ROLL_TOTAL = 'rollTotal';

/** The total stored on a roll card (undefined when the card has none). */
export const rollTotalOf = (message) => readFlag(message, ROLL_TOTAL);

/** The flag fragment of a roll total, to merge with `withFlags` or a flags object beside other flags. */
export const rollTotalPatch = (total) => ({ [ROLL_TOTAL]: total });
