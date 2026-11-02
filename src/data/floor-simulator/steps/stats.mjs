/** Step kind `stats`: spend the pending Stat points on Unenhanced scores only (Question K (a)); Enhanced follows. */
import { cleanInt } from '../state.mjs';

const KEYS = ['str', 'dex', 'con', 'int', 'cha'];

export const statsStep = {
  kind: 'stats',
  plan(step, state) {
    return {
      pool: state.pendingStatPoints, keys: KEYS, unenhancedOnly: true,
      abilities: Object.fromEntries(KEYS.map(k => [k, { ...state.abilities[k] }]))
    };
  },
  resolve(step, stepSpec, state) {
    const raw = stepSpec?.allocation && typeof stepSpec.allocation === 'object' && !Array.isArray(stepSpec.allocation) ? stepSpec.allocation : {};
    const clean = {};
    for (const key of KEYS) {
      const n = cleanInt(raw[key]);
      if (n !== null && n > 0) clean[key] = n;
    }
    const total = Object.values(clean).reduce((a, b) => a + b, 0);
    if (total === 0) return;
    const pool = state.pendingStatPoints;
    const overBudget = total > pool;
    if (overBudget) state.breakKey('stats:overBudget', step.id, `${total} points allocated but only ${pool} are pending`);
    for (const [key, n] of Object.entries(clean)) {
      const ability = state.abilities[key];
      const cap = ability.cap;
      const overCap = cap !== null && ability.unenhanced + n > cap;
      const capKey = overCap ? `stats:overCap:${key}` : undefined;
      if (overCap) state.breakKey(capKey, step.id, `${key.toUpperCase()} ${ability.unenhanced + n} is above the cap of ${cap}`);
      state.log({
        step: step.id, kind: 'stats', label: key.toUpperCase(), rolled: false, total: n,
        before: ability.unenhanced, after: ability.unenhanced + n, breakKey: capKey ?? (overBudget ? 'stats:overBudget' : undefined)
      });
      ability.unenhanced += n;
      ability.value += n;
      state.statAllocation[key] = n;
    }
    state.pendingStatPoints = Math.max(0, pool - total);
  }
};
