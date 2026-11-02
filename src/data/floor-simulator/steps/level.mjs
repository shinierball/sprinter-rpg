/** Step kind `level`: raise the Level through `gainLevels` at apply time; banks 3 pending Stat points per Level (D2a). */
import { STAT_POINTS_PER_LEVEL } from '../../../documents/actor/actor-constants.mjs';

export const levelStep = {
  kind: 'level',
  plan(step, state) {
    const levelsGained = Math.max(0, (state.arrival.level ?? state.level) - state.level);
    return { from: state.level, to: state.level + levelsGained, levelsGained, pointsGained: levelsGained * STAT_POINTS_PER_LEVEL };
  },
  resolve(step, stepSpec, state) {
    const target = Number.isFinite(Number(state.arrival.level)) ? Math.trunc(Number(state.arrival.level)) : state.level;
    const levelsGained = Math.max(0, target - state.level);
    const before = state.level;
    state.levelsGained += levelsGained;
    state.level += levelsGained;
    state.pendingStatPoints += levelsGained * STAT_POINTS_PER_LEVEL;
    state.log({
      step: step.id, kind: 'level', label: 'Level', rolled: false, computed: true,
      before, after: state.level, total: levelsGained,
      note: `${levelsGained * STAT_POINTS_PER_LEVEL} Stat points banked`
    });
  }
};
