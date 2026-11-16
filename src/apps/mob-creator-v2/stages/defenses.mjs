/** The Defenses stage: health bars, Evade and Surprise bases, DR, Move and Step as numbers, with the formula's answer beside each override. */
import { tr } from '../words.mjs';

const WORDS = 'COG.MobCreator.Defenses';
const orBlank = (n) => (n === null || n === undefined ? '' : n);

export const DEFENSES_STAGE = Object.freeze({
  id: 'defenses',
  /** @param {import('../../../data/mob-creator/draft.mjs').MobDraft} draft */
  context(draft, { rootId }) {
    const { spec } = draft;
    const r = draft.readouts();
    return {
      rootId,
      bars: { value: orBlank(spec.bars), derived: r.bars.derived, custom: r.bars.custom },
      barsHelp: tr(`${WORDS}.BarsHelp`, { bars: r.bars.derived }),
      hpPerBar: r.hpPerBar,
      maxHp: r.maxHp,
      slotPercentages: r.slotPercentages.join(', '),
      evade: { value: orBlank(spec.evadeBase), derived: r.evade.derived, custom: r.evade.custom, dc: r.evade.dc },
      surprise: { value: orBlank(spec.surpriseBase), derived: r.surprise.derived, custom: r.surprise.custom, dc: r.surprise.dc },
      floor: r.floor,
      dr: spec.dr,
      move: spec.move,
      step: spec.step
    };
  }
});
