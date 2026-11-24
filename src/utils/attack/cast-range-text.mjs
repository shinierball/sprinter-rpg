/**
 * The Range line of a spell card: the aura's Self, else the range (feet or text) with the reached rank breaks' bonus.
 * @param {object} sys the spell's system data
 * @param {{ rangeBonus: number }} breaks from `resolveReachedRankBreaks`
 * @param {boolean} [isAura]
 * A spell with no range written has no Range line: the result is '' and the printers omit the line (no stand-in range).
 * @returns {string} '' when there is no range to show
 */
export function castRangeText(sys, breaks, isAura = false) {
  if (isAura) return 'Self';
  const bonus = breaks.rangeBonus > 0 ? breaks.rangeBonus : 0;
  if (sys.rangeFeet) return `${sys.rangeFeet + bonus} feet`;
  const written = String(sys.range ?? '').trim();
  if (!written) return '';
  return bonus ? `${written} (+${bonus}ft)` : written;
}
