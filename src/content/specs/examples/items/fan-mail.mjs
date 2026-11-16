/**
 * src/content/specs/examples/items/fan-mail.mjs
 * Release set "Fan Mail": two achievements whose reward boxes wait for the GM. A reward-box row with `whenEmpty: 'keep'`
 * hands over a box that is not opened to the tier's default contents; the audience is still voting, so the GM fills it.
 * `exampleId('fm', 'i', 1..2)`.
 *   The Viewers Have Spoken (Voting Still Open)      one Silver box that waits
 *   Trending in Three Systems, Possibly by Accident   a Bronze box that waits beside a plain Bronze box
 */
import { exampleId } from '../ids.mjs';

const ACHIEVEMENT_IMG = 'icons/commodities/treasure/cup-trophy-gold.webp';

/** An achievement that pays out `rewardBoxes`. */
const achievement = (n, name, identifier, quote, tier, category, reward, favor, xp, rewardBoxes) => ({
  type: 'achievement',
  _id: exampleId('fm', 'i', n),
  name,
  img: ACHIEVEMENT_IMG,
  system: { identifier, description: `<p>${quote}</p>`, quote, category, tier, reward, favor, xp, rewardBoxes }
});

export const SPECS = Object.freeze([
  achievement(1, 'The Viewers Have Spoken (Voting Still Open)', 'the-viewers-have-spoken',
    'The audience has voted. The vote has not closed. Your prize is being decided by people who are very sure of themselves.',
    'silver', 'Popularity', 'A box, contents pending', 2, 25,
    [{ tier: 'silver', quantity: 1, whenEmpty: 'keep' }]),
  achievement(2, 'Trending in Three Systems, Possibly by Accident', 'trending-in-three-systems',
    'Your name appeared in three feeds at once. Two are still deciding what you earned. The third has already sent a box.',
    'bronze', 'Popularity', 'Two boxes, one of them pending', 1, 10,
    [{ tier: 'bronze', quantity: 1, whenEmpty: 'keep' }, { tier: 'bronze', quantity: 1 }])
]);
