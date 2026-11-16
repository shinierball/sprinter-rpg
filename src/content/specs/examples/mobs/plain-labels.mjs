/**
 * src/content/specs/examples/mobs/plain-labels.mjs
 * Release set "Plain Labels": one original mob whose spell carries a structured base damage (dice, stat, damage type) and
 * a check type. It is a Mob Creator state: the replay test (`tests/integration/mob-creator-replay.test.mjs`) enters it
 * through the rendered creator and expects the same payload. The spell is a copy of a Creature Feature item, as a pick is.
 */
import '../../../../data/builders/mob-payload.mjs'; // registers the `mob` payload delegate (pure)
import { exampleId } from '../ids.mjs';
import { copyOf } from '../items/creature-feature.mjs';

export const SPECS = Object.freeze([
  {
    type: 'mob',
    _id: exampleId('pl', 'a', 1),
    name: 'Pyrotechnics Intern',
    img: 'icons/svg/skull.svg',
    level: 2,
    designFloor: 2,
    size: 'small',
    creatureType: 'Humanoid',
    abilities: { str: 3, dex: 6, con: 4, int: 6, cha: 3 },
    description: 'Was told to light the fuse on the count of three. Has been counting since lunch.',
    aiDescription: 'Please welcome our newest intern, who has read the manual twice and understood it once.',
    // The embedded `_id` is the one the pack has given the spell since release 8.0.0 (a world that imported the mob holds it).
    items: [copyOf('sparkler-salute', {}, 'dccexpla01i00001')],
    loot: [
      { _id: 'dccexpla01i00002', name: 'Singed Lanyard', quantity: 1, lootType: 'consumable', description: 'Says "Safety Officer". Was not.' }
    ]
  }
]);
