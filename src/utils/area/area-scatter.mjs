/**
 * Scatter on a failed Throw or Fireball (core pp. 83, 200-201): an item or skill tagged `rule.scatter` that misses lands
 * off target. The direction is a 1d8 on the figure (1 to 8, clockwise) and the feet the roll missed by is the distance.
 * A reached Rank Upgrade tagged `rule.scatter-aimed` lets the thrower choose the direction instead of rolling.
 * Pure: the card builders roll the die and place the line.
 */
import { COG_ROLL_OUTCOMES as O } from '../../documents/session/roll-outcomes.mjs';
import { langText } from '../lang-text.mjs';
import { hasRuleFlag, RULE_FLAGS } from '../tag/tag-behaviour.mjs';

export const SCATTER_DIE = '1d8';

/** The degrees below the Difficulty (core p. 80): Near Miss, Fail, Major Fail, Critical Fail. */
const FAIL_BANDS = Object.freeze([O.NEAR_MISS, O.FAILURE, O.MAJOR_FAILURE, O.CRITICAL_FAILURE]);

const TEXT = Object.freeze({
  'COG.Scatter.Line': 'Missed by {feet} ft: it lands {feet} ft away, direction {direction} (Figure 3, core p. 200).',
  'COG.Scatter.LineNoDie': 'Missed by {feet} ft: it lands {feet} ft away. Roll the direction (Figure 3, core p. 200).',
  'COG.Scatter.LineAimed': 'Missed by {feet} ft: it lands {feet} ft away, in a direction you choose (Rank 10).',
  'COG.Scatter.NaturalOne': 'Natural 1: the GM picks where it lands.',
  'COG.Scatter.Hidden': 'It lands off target: direction {direction}.',
  'COG.Scatter.HiddenNoDie': 'It lands off target.',
  'COG.Scatter.HiddenAimed': 'It lands off target, in a direction you choose.',
  'COG.Scatter.Roll': 'Roll direction (1d8)',
  'COG.Scatter.RollFlavor': 'Scatter direction (1d8)'
});

/** A scatter string by its `COG.Scatter.<key>` lang key (English fallback without a catalogue). */
export const scatterText = langText(TEXT);

/** Whether the outcome id is a fail band (Near Miss and below). */
const isFailBand = (outcomeId) => FAIL_BANDS.includes(outcomeId);

/**
 * The scatter line of one miss, or null when nothing scatters.
 * @param {object} p
 * @param {Iterable<string>} p.tags the roll's tags (the item's and the hit skill's)
 * @param {Iterable<string>} [p.reachedTierTags] tags of the reached Rank Upgrade tiers
 * @param {string} p.outcomeId the degree against the Difficulty
 * @param {number} p.diff total minus Difficulty (negative on a miss)
 * @param {number|null} [p.d8] the direction die, null when not rolled yet
 * @param {boolean} [p.gm=true] false hides the distance (the GM announces the degree, not the numbers, core p. 60)
 * @returns {{ feet: number, direction: number|null, aimed: boolean, text: string }|null}
 */
export function scatterLine({ tags, reachedTierTags = [], outcomeId, diff, d8 = null, gm = true } = {}) {
  if (!hasRuleFlag([...(tags ?? [])], RULE_FLAGS.scatter) || !isFailBand(outcomeId)) return null;
  const feet = Math.max(0, -(Number(diff) || 0));
  const aimed = hasRuleFlag([...(reachedTierTags ?? [])], RULE_FLAGS.scatterAimed);
  const direction = aimed || d8 === null || d8 === undefined || !Number.isFinite(Number(d8)) ? null : Math.trunc(Number(d8));
  let text;
  if (feet === 0 && outcomeId === O.CRITICAL_FAILURE) text = scatterText('COG.Scatter.NaturalOne');
  else if (!gm) text = aimed ? scatterText('COG.Scatter.HiddenAimed') : direction === null ? scatterText('COG.Scatter.HiddenNoDie') : scatterText('COG.Scatter.Hidden', { direction });
  else text = aimed ? scatterText('COG.Scatter.LineAimed', { feet }) : direction === null ? scatterText('COG.Scatter.LineNoDie', { feet }) : scatterText('COG.Scatter.Line', { feet, direction });
  return { feet, direction, aimed, text };
}
