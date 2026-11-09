/**
 * One-line summary of a typed modifier row (`damageModifiers`, `defenseModifiers`, `attackModifiers`,
 * `checkModifiers`, `craftModifiers`, `vehicleModifiers`), shared by the item describer and the row editor's "Reads as" line. Built from the row's
 * `label`, mode/kind and values, never from an item name.
 */

import { getRowKind, kindOf } from '../row-kinds.mjs';

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

/** A craft row's summary: its kind's `summarize` ("Crafts up to bonus 5", "Crafting time x0.5"), else its label. */
function craftSummary(row) {
  return getRowKind('craftModifiers', kindOf('craftModifiers', row))?.summarize?.(row) || row.label || 'Crafting';
}

/** A vehicle row's summary: its kind's `summarize` ("Move +5 ft", "Move x1.5"), else its label. */
function vehicleSummary(row) {
  return getRowKind('vehicleModifiers', kindOf('vehicleModifiers', row))?.summarize?.(row) || row.label || 'Vehicle';
}

/** True for the roll kinds that are not an amount: the after-roll offers and the waive row read as their kind's sentence. */
export function isSentenceRollKind(arrayKey, row) {
  const def = getRowKind(arrayKey, kindOf(arrayKey, row));
  return Boolean(def?.summarize && (def.apply?.afterRoll || def.apply?.waive));
}

/** A roll array's summary: the kind's sentence for a reroll, degree shift or waive row, else the bare amount. */
function rollSummaryOf(arrayKey) {
  return (row) => (isSentenceRollKind(arrayKey, row) ? getRowKind(arrayKey, kindOf(arrayKey, row)).summarize(row) : rollSummary(row));
}

const SUMMARIES = Object.freeze({ damageModifiers: damageSummary, defenseModifiers: defenseSummary, attackModifiers: rollSummaryOf('attackModifiers'), checkModifiers: rollSummaryOf('checkModifiers'), craftModifiers: craftSummary, vehicleModifiers: vehicleSummary });

/**
 * One row's summary whether or not it is disabled (the row editor's "Reads as" line explains a disabled row too).
 * @param {'damageModifiers'|'defenseModifiers'|'attackModifiers'|'checkModifiers'|'craftModifiers'|'vehicleModifiers'} arrayKey
 * @param {object} row
 * @returns {string}
 */
export function summarizeRow(arrayKey, row) {
  return SUMMARIES[arrayKey](row ?? {});
}
