/**
 * The read-only definition a sheet row opens (the sheet tables' definition row): what `describeItem` said about an item,
 * sorted into the groups the row prints. Pure: it reads line paths and block ids, never a name, description or note to
 * decide anything (it copies `quote` and `notes` for display only).
 */
import { str } from './shared.mjs';

/** The row paths of the key facts, in the order the strip shows them (not describer order). */
const FACT_PATHS = Object.freeze([
  'system.range', 'system.rangeFeet', 'system.area', 'system.contest', 'system.durationConfig', 'system.cooldown', 'system.charges', 'system.slot'
]);

const LIMITATIONS_PATH = 'system.limitations';
const RANK_BREAKS_BLOCK = 'spell-skill-rank-breaks';

/**
 * @param {object} item the row's document or stand-in (reads `system.quote`, `system.notes` and whether `system.description` has text)
 * @param {import('./shared.mjs').FeatureLine[]} lines what `describeItem` returned for it
 * @returns {{ quote: string, facts: object[], limitations: object[], effects: object[], rankBreaks: object[],
 *             notes: string, hasDescription: boolean, isEmpty: boolean }}
 */
export function definitionView(item, lines) {
  const sys = item?.system ?? {};
  const all = Array.isArray(lines) ? lines.filter(Boolean) : [];
  const facts = [];
  const limitations = [];
  const rankBreaks = [];
  const effects = [];
  for (const line of all) {
    if (line.block === RANK_BREAKS_BLOCK) rankBreaks.push(line);
    else if (line.rowPath === LIMITATIONS_PATH) limitations.push({ ...line, text: line.bareText ?? line.text });
    else if (FACT_PATHS.includes(line.rowPath)) facts.push(line);
    else effects.push(line);
  }
  facts.sort((a, b) => FACT_PATHS.indexOf(a.rowPath) - FACT_PATHS.indexOf(b.rowPath));
  const hasDescription = typeof sys.description === 'string' && sys.description.trim() !== '';
  return {
    quote: str(sys.quote),
    facts,
    limitations,
    effects,
    rankBreaks,
    notes: str(sys.notes),
    hasDescription,
    isEmpty: !all.length && !hasDescription
  };
}
