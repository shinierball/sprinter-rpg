/**
 * src/content/specs/examples/items/second-takes.mjs
 * Unreleased set "Second Takes": two accessories whose `checkModifiers` rows offer a second chance after a check has
 * rolled, on any card (not only a vehicle's). `exampleId('st', 'i', 1..2)`: 1 a reroll row conditioned on `check.skill`,
 * once per floor; 2 a degree shift row conditioned on `check.stat`, once per scene. All text is original.
 */
import { exampleId } from '../ids.mjs';

const q = (all = [], any = [], none = []) => ({ all, any, none });

export const SPECS = Object.freeze([
  {
    type: 'gear',
    _id: exampleId('st', 'i', 1),
    name: 'Continuity Clapperboard',
    img: 'icons/svg/clockwork.svg',
    system: {
      identifier: 'continuity-clapperboard',
      slot: 'accessory',
      description: '<p>Snap it shut and the last few seconds are declared a rehearsal. Once per floor, after a Skill check has rolled, it lets you roll the d20 again. The second roll counts. Nobody will say which take was the good one.</p>',
      cooldown: { value: 1, unit: 'floor' },
      checkModifiers: [{ kind: 'reroll', label: 'Take two', condition: q(['check.skill']) }]
    }
  },
  {
    type: 'gear',
    _id: exampleId('st', 'i', 2),
    name: 'Redemption Arc Cue Card',
    img: 'icons/svg/book.svg',
    system: {
      identifier: 'redemption-arc-cue-card',
      slot: 'accessory',
      description: '<p>A card held up just off camera. Once per scene, after a Stat check has rolled, it moves a failed result one degree toward Success. A degree that is already a Success is left to the audience.</p>',
      cooldown: { value: 1, unit: 'scene' },
      checkModifiers: [{ kind: 'degreeShift', label: 'Last-minute growth', value: 1, option: 'failOnly', condition: q(['check.stat']) }]
    }
  }
]);
