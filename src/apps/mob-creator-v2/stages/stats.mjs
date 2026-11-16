/** The Stats stage: the five stats with steppers, the budget readout and Fill to budget (a focus you pick, the same result every time). */
import { FILL_FOCUSES, MOB_STATS } from '../../../data/mob-creator/draft.mjs';
import { tr } from '../words.mjs';

const WORDS = 'COG.MobCreator.Stats';

/** The Fill focus a new window starts on. */
export const DEFAULT_FILL_FOCUS = 'even';

export const STATS_STAGE = Object.freeze({
  id: 'stats',
  /** @param {import('../../../data/mob-creator/draft.mjs').MobDraft} draft */
  context(draft, { rootId, fillFocus }) {
    const r = draft.readouts();
    return {
      rootId,
      stats: MOB_STATS.map((key) => ({
        key,
        label: tr(`${WORDS}.Stat.${key}`),
        path: `abilities.${key}`,
        value: draft.spec.abilities[key],
        mod: r.modLabels[key]
      })),
      budget: r.budget,
      spent: r.spent,
      remaining: r.remaining,
      over: r.over,
      overBy: r.spent - r.budget.points,
      unspentNote: !r.over && r.remaining > 0 ? tr(`${WORDS}.Unspent`, { points: r.remaining }) : '',
      focusOptions: Object.keys(FILL_FOCUSES).map((value) => ({ value, label: tr(`${WORDS}.Focus.${value}`), selected: value === fillFocus })),
      help: tr(`${WORDS}.Help`)
    };
  },
  actions: {
    /** A stepper button: `data-path` and `data-delta`. */
    async adjustStat(event, target) {
      if (!this.draft.adjust(target.dataset.path, Number(target.dataset.delta))) return;
      await this.render({ parts: this._parts() });
    },
    /** The focus select: remembered by the window, nothing is spent until Fill is pressed. */
    setFillFocus(event, target) {
      this.fillFocus = Object.hasOwn(FILL_FOCUSES, target.value) ? target.value : DEFAULT_FILL_FOCUS;
    },
    /** Fill to budget, from the Stats stage or the footer. */
    async fillBudget() {
      this.draft.fillToBudget(this.fillFocus);
      await this.render({ parts: this._parts() });
    }
  }
});
