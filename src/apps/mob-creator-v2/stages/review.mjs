/** The Review stage: every Rule Break, the builder's warnings before Create, and what Create makes. */
import { weaponWarning } from './attacks.mjs';
import { tr } from '../words.mjs';

const WORDS = 'COG.MobCreator.Review';

export const REVIEW_STAGE = Object.freeze({
  id: 'review',
  /** @param {import('../../../data/mob-creator/draft.mjs').MobDraft} draft */
  context(draft) {
    const r = draft.readouts();
    const warnings = [];
    const payload = draft.compile({ warnings });
    const custom = [
      r.bars.custom && tr(`${WORDS}.CustomBars`, { bars: r.bars.value, derived: r.bars.derived }),
      r.evade.custom && tr(`${WORDS}.CustomEvade`, { base: r.evade.base, derived: r.evade.derived }),
      r.surprise.custom && tr(`${WORDS}.CustomSurprise`, { base: r.surprise.base, derived: r.surprise.derived })
    ].filter(Boolean);
    return {
      ruleBreaks: draft.ruleBreaks().map((b) => b.reason),
      warnings: [...draft.weaponIssues().map(weaponWarning), ...warnings.map((w) => `${w.path}: ${w.message}`)],
      custom,
      note: r.remaining > 0 && !r.over ? tr(`${WORDS}.Unspent`, { points: r.remaining }) : '',
      itemCount: payload.items.length,
      summary: tr(`${WORDS}.Summary`, { name: payload.name, items: payload.items.length })
    };
  }
});
