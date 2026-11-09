/**
 * Step kind `aiFavor`: a base roll plus a bonus roll by the primary attack's AI Favor rating (0, 1 or 2), written
 * by `mode` (`max` keeps a higher current value, Question E (a)). The rating pre-fills from the snapshot's `aiFavor`
 * numbers: a skill or weapon's number is `prefillAiFavorRating` over its `aiFavorRatings` rows (conditions ignored,
 * Question L (a)), and a spell's plain number counts as one unconditional rating (Q115 (a)). Only the primary item and
 * equipped weapons are read; the highest wins. The spec may override the rating. The log note names the source item.
 * Spec: `{ rating?, value?, ratingValue? }`.
 */
import { cleanInt, rollOrTyped } from '../state.mjs';

const clampRating = (n) => Math.min(2, Math.max(0, n));

/** The rating the step pre-fills for this crawler and the item it comes from: `{ rating, source }`. */
function defaultAiFavorSource(state) {
  const primary = state.primaryItem();
  let rating = cleanInt(primary?.aiFavor) ?? 0;
  let source = rating > 0 ? primary?.name ?? null : null;
  for (const w of state.weapons) {
    if (!w?.equipped) continue;
    const n = cleanInt(w.aiFavor) ?? 0;
    if (n > rating) { rating = n; source = w.name ?? null; }
  }
  return { rating: clampRating(rating), source: rating > 0 ? source : null };
}

/** The rating the step pre-fills for this crawler. */
function defaultAiFavorRating(state) {
  return defaultAiFavorSource(state).rating;
}

/** Combine a rolled amount with the current value by mode: `max`, `add` or `set`. */
function combine(mode, current, value) {
  if (mode === 'add') return current + value;
  if (mode === 'set') return value;
  return Math.max(current, value);
}

export const aiFavorStep = {
  kind: 'aiFavor',
  plan(step, state) {
    return { current: state.aiFavor, mode: step.mode ?? 'max', formula: step.formula, byRating: step.byRating ?? {}, defaultRating: defaultAiFavorRating(state) };
  },
  resolve(step, stepSpec, state, ctx, rng) {
    const typed = cleanInt(stepSpec?.rating);
    const fallback = defaultAiFavorSource(state);
    const rating = clampRating(typed ?? fallback.rating);
    const from = typed === undefined || typed === null ? (fallback.source ? ` from ${fallback.source}: AI Favor rating ${fallback.rating}` : '') : ' (typed)';
    const base = rollOrTyped(state, step.id, step.formula, stepSpec?.value, rng);
    if (!base) return;
    const bonusFormula = rating > 0 ? step.byRating?.[rating] : null;
    const bonus = bonusFormula ? rollOrTyped(state, step.id, bonusFormula, stepSpec?.ratingValue, rng) : null;
    const total = base.total + (bonus?.total ?? 0);
    const before = state.aiFavor;
    const mode = step.mode ?? 'max';
    state.aiFavor = combine(mode, before, total);
    state.aiFavorChanged = true;
    const dice = [...(base.dice ?? []), ...(bonus?.dice ?? [])];
    state.log({
      step: step.id, kind: 'aiFavor', label: 'AI Favor', formula: bonusFormula ? `${step.formula} + ${bonusFormula}` : step.formula,
      dice: dice.length ? dice : undefined, total, rolled: base.rolled && (!bonus || bonus.rolled),
      manual: (base.manual || bonus?.manual) || undefined,
      before, after: state.aiFavor, breakKey: base.breakKey ?? bonus?.breakKey ?? undefined,
      note: `rating ${rating}${from}${mode === 'max' ? ', keeps the higher value' : ''}`
    });
  }
};
