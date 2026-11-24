/**
 * The engine tag a roll carries while the party travels at a Fast or Slow pace (core p. 71), set by `buildRollContext`.
 * The one offered line (`situation.travel_watch`) reads it.
 */
import { TRAVEL_SITUATIONS } from '../../data/tag-vocabulary.mjs';
import { travelPace } from './exploring-settings.mjs';

/**
 * @returns {string[]} `situation.travel_fast` or `situation.travel_slow`; none at Normal, with no pace, or with the hazards off
 */
export function travelRollTags() {
  const pace = travelPace();
  if (pace === 'fast') return [TRAVEL_SITUATIONS.fast];
  if (pace === 'slow') return [TRAVEL_SITUATIONS.slow];
  return [];
}
