/**
 * src/content/grind-complications.mjs
 * Reader for the grinding complications table. Content comes only from the registry (`grindComplications` kind);
 * when no module registers a table, the original example table is the baseline. Mechanics read structured fields
 * (`effects`), never titles or descriptions.
 */
import { catalogEntries } from './catalog-lookup.mjs';
import { EXAMPLE_GRIND_COMPLICATION_TABLE } from './specs/examples/grind-complications.mjs';

/** Display defaults for rows without an icon or colour. */
export const DEFAULT_COMPLICATION_ICON = 'fa-solid fa-dice-d20';
export const DEFAULT_COMPLICATION_COLOR = '#7f8c8d';

/** The registered tables, else the example table alone. */
export function complicationTables() {
  const registered = catalogEntries('grindComplications').filter(t => Array.isArray(t?.results));
  return registered.length ? registered : [EXAMPLE_GRIND_COMPLICATION_TABLE];
}

/**
 * The result whose range contains `roll`, or null. Never clamps to a default row.
 * @param {object|null} table
 * @param {number} roll
 * @returns {object|null}
 */
export function complicationForRoll(table, roll) {
  const r = Number(roll);
  if (!table || !Array.isArray(table.results) || !Number.isFinite(r)) return null;
  return table.results.find(row => {
    const lo = Number(row?.range?.[0]);
    const hi = Number(row?.range?.[1] ?? row?.range?.[0]);
    return r >= lo && r <= hi;
  }) ?? null;
}

/** `table.formula`, else `1d<highest range end>`. */
export function complicationFormula(table) {
  const formula = typeof table?.formula === 'string' ? table.formula.trim() : '';
  if (formula) return formula;
  const highest = Math.max(1, ...(table?.results ?? []).map(row => Number(row?.range?.[1] ?? row?.range?.[0]) || 0));
  return `1d${highest}`;
}
