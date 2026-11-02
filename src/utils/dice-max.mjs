/**
 * Maximum possible total of a plain dice formula: sums and differences of `NdM` terms and whole numbers
 * (for example "2d6 + 3"). This is a formal grammar, so a pattern is appropriate here. Anything outside
 * the grammar (modifiers, functions, variables) returns null rather than guessing.
 * Leaf module with no imports.
 */
const TERM = /^(\d*)d(\d+)$|^(\d+)$/i;

/**
 * @param {string} formula
 * @returns {number|null} the highest total the formula can roll, or null if it is not a plain dice sum
 */
export function maxOfDiceFormula(formula) {
  const text = String(formula ?? '').replace(/\s+/g, '');
  if (!text) return null;
  const pieces = text.match(/[+-]?[^+-]+/g);
  if (!pieces || pieces.join('') !== text) return null;
  let total = 0;
  for (const piece of pieces) {
    const sign = piece.startsWith('-') ? -1 : 1;
    const body = piece.replace(/^[+-]/, '');
    const m = TERM.exec(body);
    if (!m) return null;
    if (m[3] !== undefined) {
      total += sign * Number(m[3]);
    } else {
      const count = m[1] === '' ? 1 : Number(m[1]);
      const sides = Number(m[2]);
      total += sign === 1 ? count * sides : -count; // a subtracted die is lowest at 1
    }
  }
  return total;
}
