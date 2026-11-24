/**
 * src/utils/grind/grind-effects.mjs
 * The effect vocabulary of a grinding table row (core pp. 170, 259; toolkit p. 13), shared by the catalog tables, the
 * RollTable builder and the grind-table reader. Three kinds: `grindHours` (a signed change to the hours credited this
 * session), `floorTime` (floor time lost, in hours or as a percent of the time left) and `seeTable` (on a floor table's row: this
 * row is the neighborhood table's row for the same roll; one direction). Pure: parses and labels, never rolls.
 *
 * Formula grammar (parsed, never evaluated as code): an optional `-`, then a whole number (`2`) or one dice term (`1d4`),
 * then optionally `*` and a whole number (`1d4*10`). Anything else is dropped with a warning.
 */
import { firstScalar, proseText } from '../first-scalar.mjs';

/** The effect kinds a row may carry. */
export const GRIND_EFFECT_KINDS = Object.freeze(['grindHours', 'floorTime', 'seeTable']);

/** Bounds of the formula grammar. */
const FORMULA_DICE_COUNT = Object.freeze({ min: 1, max: 9 });
const FORMULA_DICE_FACES = Object.freeze({ min: 2, max: 100 });
const FORMULA_MULTIPLIER = Object.freeze({ min: 1, max: 100 });
const FORMULA_CONSTANT = Object.freeze({ min: 0, max: 99 });

/** The most a percentage of the time left can be: all of it. A `percent` result is clamped to 0 through this. */
export const PERCENT_MAX = 100;

const SCOPES = Object.freeze(['floor', 'neighborhood']);
const PER = Object.freeze(['hours', 'percent']);

const FORMULA = /^(-)?(?:(\d{1,3})d(\d{1,3})|(\d{1,3}))(?:\*(\d{1,3}))?$/;

const within = (n, range) => Number.isInteger(n) && n >= range.min && n <= range.max;
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * Read an effect formula.
 * @param {*} raw
 * @returns {{ negative: boolean, count: number, faces: number, constant: number, multiplier: number }|null}
 *   `faces` is 0 for a whole number (then `constant` holds it); null for anything outside the grammar and its bounds
 */
export function parseEffectFormula(raw) {
  const text = String(firstScalar(raw, '') ?? '').trim();
  const m = FORMULA.exec(text);
  if (!m) return null;
  const multiplier = m[5] === undefined ? 1 : Number(m[5]);
  if (!within(multiplier, FORMULA_MULTIPLIER)) return null;
  if (m[4] !== undefined) {
    const constant = Number(m[4]);
    if (!within(constant, FORMULA_CONSTANT)) return null;
    return { negative: Boolean(m[1]), count: 0, faces: 0, constant, multiplier };
  }
  const count = Number(m[2]);
  const faces = Number(m[3]);
  if (!within(count, FORMULA_DICE_COUNT) || !within(faces, FORMULA_DICE_FACES)) return null;
  return { negative: Boolean(m[1]), count, faces, constant: 0, multiplier };
}

/** A formula in its plain written form (`-1d4*10`), or '' when it does not parse. */
function effectFormulaText(raw) {
  const p = parseEffectFormula(raw);
  if (!p) return '';
  const base = p.faces ? `${p.count}d${p.faces}` : String(p.constant);
  return `${p.negative ? '-' : ''}${base}${p.multiplier === 1 ? '' : `*${p.multiplier}`}`;
}

/**
 * One effect, cleaned; null (with a console warning) when it is not a known kind or its fields do not parse.
 * @param {*} raw
 * @returns {{ kind: string, formula?: string, per?: string, label?: string }|null}
 */
export function normalizeEffect(raw) {
  if (!isPlainObject(raw)) return null;
  const kind = String(firstScalar(raw.kind, '') ?? '');
  if (!GRIND_EFFECT_KINDS.includes(kind)) {
    console.warn(`Sprinter RPG | grind effect: unknown kind "${kind}" dropped`);
    return null;
  }
  if (kind === 'seeTable') return { kind };
  const formula = effectFormulaText(raw.formula);
  if (!formula) {
    console.warn(`Sprinter RPG | grind effect: formula "${String(raw.formula)}" is outside the grammar; dropped`);
    return null;
  }
  const label = proseText(raw.label);
  if (kind === 'grindHours') return { kind, formula, ...(label ? { label } : {}) };
  const per = PER.includes(raw.per) ? raw.per : 'hours';
  return { kind, formula, per, ...(label ? { label } : {}) };
}

/** The valid effects of a list (anything that is not an array reads as none). */
export function normalizeEffects(list) {
  return (Array.isArray(list) ? list : []).map(normalizeEffect).filter(Boolean);
}

/**
 * A table's `{ scope, floors }`; null when the scope is not a known one. `floors` keeps the whole numbers of 1 and up;
 * an empty list means any floor.
 * @param {*} raw
 */
export function normalizeGrindScope(raw) {
  if (!isPlainObject(raw)) return null;
  const scope = String(firstScalar(raw.scope, '') ?? '');
  if (!SCOPES.includes(scope)) return null;
  const floors = (Array.isArray(raw.floors) ? raw.floors : []).map(Number).filter((n) => Number.isInteger(n) && n >= 1);
  return { scope, floors };
}

/** The scope of a catalog table that has none: a floor table for any floor. */
export const DEFAULT_GRIND_SCOPE = Object.freeze({ scope: 'floor', floors: Object.freeze([]) });

/** Whether a formula is exactly one hour (a plain 1 or -1), which reads in the singular. */
const isOneHour = (formula) => formula === '1' || formula === '-1';

/** A plain label for an effect (the result's name on a built RollTable, a line on the grind card). */
export function effectLabel(effect) {
  if (effect?.label) return String(effect.label);
  const formula = effectFormulaText(effect?.formula);
  switch (effect?.kind) {
    case 'grindHours': return `${formula.startsWith('-') ? '' : '+'}${formula} grinding ${isOneHour(formula) ? 'hour' : 'hours'}`;
    case 'floorTime': {
      if (effect.per === 'percent') return `Lose ${formula.replace('*', 'x')}% of the floor's time left`;
      return `Lose ${formula} ${isOneHour(formula) ? 'hour' : 'hours'} of floor time`;
    }
    case 'seeTable': return 'See the neighborhood table';
    default: return '';
  }
}
