/**
 * Step kind `aiFavor`: a base roll plus a bonus roll by the AI Favor rating (0, 1 or 2), keeping the higher of the
 * total and the current value. The rating pre-fills from the highest `aiFavor` number on the primary item or an
 * equipped weapon (the snapshot works those numbers out); the spec may override it.
 * Spec: `{ rating?, value?, ratingValue? }`.
 */
import { cleanInt, rollOrTyped } from '../state.mjs';

const clampRating = (n) => Math.min(2, Math.max(0, n));

/** The rating the step pre-fills for this crawler and the item it comes from: `{ rating, source }`. */
function defaultAiFavorSource(state) {
  let best = { rating: 0, source: null };
  const primary = state.primaryItem();
  for (const item of [primary, ...state.weapons.filter(w => w?.equipped)]) {
    const n = cleanInt(item?.aiFavor) ?? 0;
    if (n > best.rating) best = { rating: n, source: item.name ?? null };
  }
  return { ...best, rating: clampRating(best.rating) };
}

export const aiFavorStep = {
  kind: 'aiFavor',
  plan(step, state) {
    return { current: state.aiFavor, formula: step.formula, byRating: step.byRating ?? {}, defaultRating: defaultAiFavorSource(state).rating };
  },
  resolve(step, stepSpec, state, ctx, rng) {
    const typed = cleanInt(stepSpec?.rating);
    const fallback = defaultAiFavorSource(state);
    let rating = fallback.rating;
    let from = fallback.source ? ` from ${fallback.source}: AI Favor rating ${rating}` : '';
    if (typed != null) {
      rating = clampRating(typed);
      from = ' (typed)';
    }
    const base = rollOrTyped(state, step.id, step.formula, stepSpec?.value, rng);
    if (!base) return;
    const bonusFormula = rating > 0 ? step.byRating?.[rating] : null;
    const bonus = bonusFormula ? rollOrTyped(state, step.id, bonusFormula, stepSpec?.ratingValue, rng) : null;
    const total = base.total + (bonus?.total ?? 0);
    const before = state.aiFavor;
    state.aiFavor = Math.max(before, total);
    state.aiFavorChanged = true;
    const dice = [...(base.dice ?? []), ...(bonus?.dice ?? [])];
    state.log({
      step: step.id, kind: 'aiFavor', label: 'AI Favor', formula: bonusFormula ? `${step.formula} + ${bonusFormula}` : step.formula,
      dice: dice.length ? dice : undefined, total, rolled: base.rolled && (!bonus || bonus.rolled),
      manual: (base.manual || bonus?.manual) || undefined,
      before, after: state.aiFavor, breakKey: base.breakKey ?? bonus?.breakKey ?? undefined,
      note: `rating ${rating}${from}, keeps the higher value`
    });
  }
};
