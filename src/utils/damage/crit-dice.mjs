/**
 * Critical Hit dice (p. 79): a Critical Hit rolls twice as many BASE damage dice, then the Stat Mod and other bonuses
 * are added once. The builders mark the base dice parts (`baseDice: true`); a damage roll rolls the extra copies this
 * file makes as parts of their own (`crit: true`), and only a Critical Hit apply counts them. A pure leaf module.
 */

/**
 * The extra Critical Hit parts of a damage roll: for each `baseDice` part with dice, `sets - 1` copies that carry the
 * dice only (no Stat Mod, no flat value, so those stay added once). A copy keeps the part's type, `resultMultiplier`
 * (Powerful Strike multiplies the doubled dice too), `standby` and `rowKey`.
 * @param {Array<object>} parts the roll's damage parts
 * @param {number} sets how many times the base dice are rolled in all (the crit multiplier, 2 by default)
 * @returns {Array<object>} the extra parts, [] when `sets` is below 2 or not finite or no part is base dice
 */
export function critDiceParts(parts, sets) {
  const n = Math.floor(Number(sets));
  if (!Number.isFinite(n) || n < 2) return [];
  const out = [];
  for (const part of Array.isArray(parts) ? parts : []) {
    if (part?.baseDice !== true || !String(part.dice ?? '').trim()) continue;
    for (let k = 1; k < n; k++) {
      out.push({
        ...part,
        id: `${part.id}-crit${k}`,
        stat: '',
        statMod: 0,
        value: 0,
        baseDice: false,
        crit: true,
        source: `${part.source ?? ''} (Critical Hit)`.trim()
      });
    }
  }
  return out;
}

/**
 * What a damage card shows and totals: the parts without the Critical Hit dice, unless the roll is a Critical Hit.
 * @param {Array<object>} parts
 * @param {boolean} isCrit
 * @returns {Array<object>}
 */
export function cardShownParts(parts, isCrit) {
  return (Array.isArray(parts) ? parts : []).filter(p => isCrit || !p?.crit);
}

/** The roll subject's total of the Critical Hit parts (the sub-button's and the note's amount). */
export function critDiceTotal(parts) {
  return (Array.isArray(parts) ? parts : []).filter(p => p?.crit).reduce((sum, p) => sum + (Number(p.finalDamage) || 0), 0);
}

/**
 * The muted "Critical Hit dice" line under a normal card's breakdown, '' when the roll has none or is itself a crit.
 * @param {Array<object>} parts the evaluated parts, crit ones included
 * @param {boolean} isCrit
 * @returns {string} HTML
 */
export function critDiceNoteHtml(parts, isCrit) {
  const crit = (Array.isArray(parts) ? parts : []).filter(p => p?.crit);
  if (isCrit || crit.length === 0) return '';
  const formulas = crit.map(p => p.formula).join(' + ');
  return `<div class="cog-crit-dice-note cog-text-muted" style="font-size: 10px; margin-bottom: 6px;">Critical Hit dice: +${critDiceTotal(crit)} (${formulas})</div>`;
}

/**
 * The Critical Hit sub-button of a damage card (a crit card offers "Apply as normal hit" instead). Both carry
 * `data-multiplier="1"`: the extra dice are parts of the card, not a multiplier.
 * @param {boolean} isCrit
 * @param {number} extra the crit dice total
 * @returns {string} HTML
 */
export function critSubButtonHtml(isCrit, extra) {
  return isCrit
    ? '<button type="button" class="cog-apply-damage-btn" data-action="crawlerApplyDamage" data-multiplier="1" data-crit="false" title="Apply as a normal hit (no extra Critical Hit dice or critical debuffs)">Apply as normal hit</button>'
    : `<button type="button" class="cog-apply-damage-btn" data-action="crawlerApplyDamage" data-multiplier="1" data-crit="true" title="Apply as a Critical Hit (the extra base dice and critical debuffs)">Critical Hit (+${extra})</button>`;
}
