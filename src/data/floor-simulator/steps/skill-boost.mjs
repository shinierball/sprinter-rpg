/**
 * Step kind `skillBoost`: add Ranks to owned skills (and, for `chosen`, spells).
 *  - `primary`: the primary attack skill (D8), formula from the step.
 *  - `others`: the remaining skills (skills only, Question G (a)), `count` of them, formula from the step.
 *  - `chosen`: `count` skills or spells the player picks; the formula comes from `formulaByRank` on the working Rank.
 * Spec: `{ itemId, value?, keepOverflow? }` for primary; `{ picks: [{ itemId, value?, keepOverflow? }] }` otherwise.
 */
import { addRank, cleanInt, cleanText, rollOrTyped } from '../state.mjs';

const candidate = (i) => ({ id: i.id, identifier: i.identifier, name: i.name, kind: i.kind, rank: i.rank, rankCeiling: i.rankCeiling });

/** Formula for a Rank from a `formulaByRank` list (`{ min?, max?, formula }`), or null. */
export function formulaForRank(formulaByRank, rank) {
  for (const row of Array.isArray(formulaByRank) ? formulaByRank : []) {
    const min = cleanInt(row?.min);
    const max = cleanInt(row?.max);
    if ((min === null || rank >= min) && (max === null || rank <= max)) return row.formula ?? null;
  }
  return null;
}

/** The primary attack skill: the one the spec's primary-boost step names when it names an owned item, else the starter's. */
function primaryFor(state) {
  const primaryStep = (Array.isArray(state.arrival?.steps) ? state.arrival.steps : []).find(s => s.kind === 'skillBoost' && s.target === 'primary');
  const named = primaryStep ? cleanText(state.spec?.steps?.[primaryStep.id]?.itemId) : '';
  return (named && state.items.get(named)) || state.primaryItem();
}

function candidatesFor(step, state) {
  const all = [...state.items.values()];
  if (step.target === 'others') {
    const primary = primaryFor(state);
    return all.filter(i => i.kind === 'skill' && i.id !== primary?.id);
  }
  if (step.target === 'chosen') return step.candidates === 'skills' ? all.filter(i => i.kind === 'skill') : all;
  return all;
}

/** Picks from the spec (strings or objects), or the first `count` of the preselection. */
function picksFor(step, stepSpec, state) {
  const raw = stepSpec?.picks;
  if (!Array.isArray(raw)) {
    if (step.target !== 'others') return [];
    return candidatesFor(step, state).slice(0, cleanInt(step.count) ?? 0).map(i => ({ itemId: i.id }));
  }
  const seen = new Set();
  const out = [];
  for (const entry of raw) {
    const pick = typeof entry === 'string' ? { itemId: entry } : (entry && typeof entry === 'object' ? entry : null);
    const itemId = cleanText(pick?.itemId);
    if (!itemId) continue;
    if (seen.has(itemId)) {
      state.warn(step.id, `${itemId} was picked twice; the second pick was ignored.`);
      continue;
    }
    seen.add(itemId);
    out.push({ itemId, value: pick.value, keepOverflow: Boolean(pick.keepOverflow) });
  }
  return out;
}

function boost(step, state, item, formula, pick, rng) {
  const roll = rollOrTyped(state, step.id, formula, pick.value, rng);
  if (!roll) return;
  const rank = addRank(state, item, roll.total, { stepId: step.id, keepOverflow: pick.keepOverflow });
  const ceilingBound = rank.capped && item.rankCeiling !== null && rank.after === item.rankCeiling;
  state.log({
    step: step.id, kind: 'skillBoost', itemId: item.id, label: item.name, formula, dice: roll.dice ?? undefined, total: roll.total,
    rolled: roll.rolled, manual: roll.manual || undefined,
    before: rank.before, after: rank.after, capped: rank.capped || undefined, overflow: rank.overflow || undefined,
    breakKey: rank.breakKey ?? roll.breakKey ?? undefined,
    note: ceilingBound ? `Rank ${item.rankCeiling} maximum` : undefined
  });
}

export const skillBoostStep = {
  kind: 'skillBoost',
  plan(step, state) {
    const candidates = candidatesFor(step, state).map(candidate);
    const primary = primaryFor(state);
    const base = { target: step.target, formula: step.formula ?? null, count: step.count ?? 1, candidates };
    if (step.target === 'primary') return { ...base, preselected: primary ? [primary.id] : [] };
    if (step.target === 'others') return { ...base, preselected: candidates.slice(0, step.count ?? candidates.length).map(c => c.id) };
    return { ...base, formulaByRank: step.formulaByRank ?? [], candidatesMode: step.candidates ?? 'skillsAndSpells', preselected: [] };
  },
  resolve(step, stepSpec, state, ctx, rng) {
    if (step.target === 'primary') {
      const itemId = cleanText(stepSpec?.itemId) || primaryFor(state)?.id || '';
      const item = state.items.get(itemId);
      if (!item) {
        state.warn(step.id, 'No primary attack skill to boost; pick one.');
        return;
      }
      boost(step, state, item, step.formula, { value: stepSpec?.value, keepOverflow: Boolean(stepSpec?.keepOverflow) }, rng);
      return;
    }
    const allowed = new Set(candidatesFor(step, state).map(i => i.id));
    const picks = picksFor(step, stepSpec, state);
    const count = cleanInt(step.count) ?? picks.length;
    if (picks.length > count) {
      state.breakKey(`boost:overCount:${step.id}`, step.id, `${picks.length} picked but only ${count} allowed`);
    }
    for (const pick of picks) {
      const item = state.items.get(pick.itemId);
      if (!item || !allowed.has(item.id)) {
        state.warn(step.id, `${pick.itemId} is not a candidate for this step and was skipped.`);
        continue;
      }
      const formula = step.target === 'chosen' ? formulaForRank(step.formulaByRank, item.rank) : step.formula;
      if (!formula) {
        state.warn(step.id, `No formula for ${item.name} at Rank ${item.rank}.`);
        continue;
      }
      boost(step, state, item, formula, pick, rng);
    }
  }
};
