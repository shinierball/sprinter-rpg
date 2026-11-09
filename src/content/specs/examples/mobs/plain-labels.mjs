/**
 * src/content/specs/examples/mobs/plain-labels.mjs
 * Release set "Plain Labels": one original mob whose spell row carries a structured base damage
 * (dice, stat, damage type) and a check type. It is a Mob Creator state: the replay test
 * (`tests/integration/examples-authorable-3-49.test.mjs`) enters it through the rendered creator and expects the same
 * payload. The row carries no `tags`: the creator has no tag control for spells.
 */
import '../../../../data/builders/mob-payload.mjs'; // registers the `mob` payload delegate (pure)
import { exampleId } from '../ids.mjs';

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
    spells: [
      {
        name: 'Sparkler Salute',
        checkType: 'attack',
        stat: 'int',
        manaCost: 3,
        range: '30 feet',
        baseDamage: { dice: '2d6', stat: 'int', damageType: 'Fire' },
        description: 'A handful of sparklers, all at once, mostly in your direction.'
      }
    ],
    loot: [
      { name: 'Singed Lanyard', quantity: 1, notes: '', description: 'Says "Safety Officer". Was not.' }
    ]
  }
]);
