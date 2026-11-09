/**
 * The dice an assist skill rolls.
 *
 * An assist skill (Intervene, Call a Play, a homebrew Rally) carries its dice in `system.assist.formula`. The rolling
 * actor's `assist` rows (`checkModifiers`, kind `assist`) change them: the first matching `replace` row swaps the
 * formula, then every matching `add` row appends its dice. Only this module applies `assist` rows, so a "+1 to all
 * checks" row never lands on an assist die. Names no tag literal.
 */
import { buildRollContext, resolveSituations } from './roll-context.mjs';
import { evaluateRows } from './damage-modifiers.mjs';
import { applyRowKind, getRowKind, kindOf } from '../row-kinds.mjs';
import { getItemRank } from '../skill/rank-breaks.mjs';

const ARRAY_KEY = 'checkModifiers';

function assistContext(actor, skill, situations) {
  // `other: null`: an assist is not aimed at a target, so no targeted token joins the context.
  return buildRollContext({ actor, phase: 'check', item: skill, check: 'assist', situations, other: null });
}

function assistRollData(actor, skill) {
  const base = typeof actor?.getRollData === 'function' ? actor.getRollData() : {};
  return { ...(base && typeof base === 'object' ? base : {}), rank: getItemRank(skill) };
}

/**
 * The formula after `assist` rows. `literal` has the roll data substituted (no `@` references), which is what a Called
 * Play stores and what is rolled.
 * @param {object} actor the assisting actor (owner of the rows)
 * @param {object} skill the assist skill
 * @param {{ situations?: string[] }} [opts] ticked `situation.*` toggles
 * @returns {{ formula: string, literal: string, lines: string[] }}
 */
export function resolveAssistFormula(actor, skill, { situations = [] } = {}) {
  const base = typeof skill?.system?.assist?.formula === 'string' ? skill.system.assist.formula.trim() : '';
  const acc = { replaces: [], adds: [] };
  const context = assistContext(actor, skill, situations);
  for (const { source, row, scale } of evaluateRows(actor, ARRAY_KEY, context)) {
    const def = getRowKind(ARRAY_KEY, kindOf(ARRAY_KEY, row));
    if (!def?.apply?.assist) continue;
    applyRowKind(ARRAY_KEY, def, 'assist', acc, row, { actor, source, scale, context, label: row.label || source.name || 'Assist modifier' });
  }
  const lines = [];
  let formula = base;
  // Only one replace can win; two matching rows are a content conflict and the first (evaluation order) keeps the result stable.
  if (acc.replaces.length) {
    formula = acc.replaces[0].dice;
    lines.push(`${acc.replaces[0].label}: ${formula}`);
  }
  for (const add of acc.adds) {
    formula = formula ? `${formula} + ${add.dice}` : add.dice;
    lines.push(`${add.label}: +${add.dice}`);
  }
  const data = assistRollData(actor, skill);
  const RollClass = globalThis.Roll;
  const literal = formula && typeof RollClass?.replaceFormulaData === 'function'
    ? RollClass.replaceFormulaData(formula, data, { missing: '0' })
    : formula;
  return { formula, literal, lines };
}

/**
 * Offer the situation toggles the assist rows reference (the roll dialog), resolve the formula and roll it.
 * @param {object} actor
 * @param {object} skill
 * @param {object} [options] roll options (`situations`, `interactive`), as `resolveSituations` reads them
 * @returns {Promise<{ roll: object, formula: string, lines: string[] }>} `formula` is the literal that was rolled
 */
export async function rollAssistDice(actor, skill, options = {}) {
  const situations = await resolveSituations(actor, assistContext(actor, skill, []), options);
  const { literal, lines } = resolveAssistFormula(actor, skill, { situations });
  const roll = await new globalThis.Roll(literal).evaluate();
  return { roll, formula: literal, lines };
}
