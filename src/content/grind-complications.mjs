/**
 * src/content/grind-complications.mjs
 * Reader for the grinding complications table. Content comes only from the registry (`grindComplications` kind);
 * when no module registers a table, the original example table is the baseline. Mechanics read structured fields
 * (`bonusHours`), never titles or descriptions.
 */
import { catalogEntries } from './catalog-lookup.mjs';
import { EXAMPLE_GRIND_COMPLICATION_TABLE } from './specs/examples/grind-complications.mjs';

/** Display defaults for rows without an icon or colour. */
const DEFAULT_COMPLICATION_ICON = 'fa-solid fa-dice-d20';
const DEFAULT_COMPLICATION_COLOR = '#7f8c8d';

/** First registered table; the example table when none is registered. */
export function activeComplicationTable() {
  const registered = catalogEntries('grindComplications').find(t => Array.isArray(t?.results));
  return registered ?? EXAMPLE_GRIND_COMPLICATION_TABLE;
}

/** True when the table is the built-in example, not a registered one. */
export function isExampleComplicationTable(table) {
  return table === EXAMPLE_GRIND_COMPLICATION_TABLE;
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

/**
 * Roll the active table once. Returns null when `rollComplication` is false or no table exists.
 * @param {object} [options]
 * @param {boolean} [options.rollComplication]
 * @returns {Promise<object|null>} The matched row plus `roll`, `tableName` and a numeric `bonusHours`
 */
export async function rollGrindComplication(options = {}) {
  if (options.rollComplication === false) return null;
  const table = activeComplicationTable();
  if (!table) return null;
  const compRoll = await new Roll(complicationFormula(table)).evaluate();
  const data = complicationForRoll(table, compRoll.total);
  return {
    roll: compRoll.total,
    tableName: table.name,
    ...(data ?? {}),
    icon: data?.icon ?? DEFAULT_COMPLICATION_ICON,
    color: data?.color ?? DEFAULT_COMPLICATION_COLOR,
    bonusHours: Number(data?.bonusHours) || 0
  };
}
