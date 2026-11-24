/**
 * src/content/specs/examples/items/scenic-route.mjs
 * Unreleased set "Scenic Route": one accessory whose `checkModifiers` rows read the travel pace's offered line
 * (`situation.travel_watch`). `exampleId('sr', 'i', 1)`: a +1 on a Perception or Survival check with the line ticked, a row for
 * each pace that offers it. Each row also names the pace's engine tag and the two Skills, so the line is offered on those
 * rolls only, while the party travels Fast or Slow. All text is original.
 */
import { exampleId } from '../ids.mjs';

const q = (all = [], any = [], none = []) => ({ all, any, none });

export const SPECS = Object.freeze([
  {
    type: 'gear',
    _id: exampleId('sr', 'i', 1),
    name: 'Rear-View Mirror (Novelty)',
    img: 'icons/svg/eye.svg',
    system: {
      identifier: 'rear-view-mirror-novelty',
      slot: 'accessory',
      description: '<p>Clipped to a helmet, it shows you what you are leaving behind, which the production insists is scenery. While the party travels at a Fast or a Slow pace, a Perception or Survival check to notice danger or find the way gets +1 when you tick that it is one. At a Normal pace, or when nobody is travelling, it is a mirror.</p>',
      checkModifiers: [
        { kind: 'bonus', value: 1, label: 'Eyes on the road behind', condition: q(['situation.travel_watch', 'situation.travel_fast'], ['id.skill.perception', 'id.skill.survival']) },
        { kind: 'bonus', value: 1, label: 'Eyes on the road behind', condition: q(['situation.travel_watch', 'situation.travel_slow'], ['id.skill.perception', 'id.skill.survival']) }
      ]
    }
  }
]);
