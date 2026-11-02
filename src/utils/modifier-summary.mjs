/**
 * One-line summary of a typed modifier row (`damageModifiers`, `defenseModifiers`, `attackModifiers`,
 * `checkModifiers`), shared by the item describer and the row editor's "Reads as" line. Built from the row's
 * `label`, mode/kind and values, never from an item name.
 */

import { getRowKind, kindOf } from './row-kinds.mjs';

const signed = (n) => (n >= 0 ? `+${n}` : `${n}`);

/** A damage row's summary: its kind's `summarize`; a row of an unregistered mode reads as an `add` row. */
function damageSummary(row) {
  const def = getRowKind('damageModifiers', kindOf('damageModifiers', row));
  return (def?.summarize ?? getRowKind('damageModifiers', 'add').summarize)(row);
}

/** A defense row's summary: its kind's `summarize`, else its label. */
function defenseSummary(row) {
  return getRowKind('defenseModifiers', kindOf('defenseModifiers', row))?.summarize?.(row) || row.label || 'Defense';
}

function rollAmount(row) {
  return [row.dice, row.value ? signed(Number(row.value)) : '', row.stat ? `+${row.stat.toUpperCase()}` : '']
    .filter(Boolean).join(' ');
}

/** The bare amount of a roll row (what `describeRow` wraps); '+0' when the row sets none. */
function rollSummary(row) {
  return rollAmount(row) || '+0';
}

const SUMMARIES = Object.freeze({ damageModifiers: damageSummary, defenseModifiers: defenseSummary, attackModifiers: rollSummary, checkModifiers: rollSummary });

/**
 * One row's summary whether or not it is disabled (the row editor's "Reads as" line explains a disabled row too).
 * @param {'damageModifiers'|'defenseModifiers'|'attackModifiers'|'checkModifiers'} arrayKey
 * @param {object} row
 * @returns {string}
 */
export function summarizeRow(arrayKey, row) {
  return SUMMARIES[arrayKey](row ?? {});
}
