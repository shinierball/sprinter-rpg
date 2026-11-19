/**
 * src/content/specs/examples/items/group-project.mjs
 * Unreleased set "Group Project": teamwork, as defined by the network. `exampleId('gp', 'i', 1..2)`.
 *   Unsolicited Advice          a Skill that helps before an ally's Skill Check: 1d4 from a helper who has a Rank in a Skill of
 *                               the same group, 1 from one who has not; never on a Stat Check, a party check or in combat
 *   Matching Team Windbreakers  gear that adds 1 to a check rolled for a party check card, and to no other roll
 * A `buildPayload(type, spec)` input. Original text, written for this system.
 */
import { exampleId } from '../ids.mjs';

const id = (n) => exampleId('gp', 'i', n);

export const SPECS = Object.freeze([
  {
    type: 'skill',
    _id: id(1),
    name: 'Unsolicited Advice',
    img: 'icons/svg/aura.svg',
    system: {
      identifier: 'unsolicited-advice',
      stat: 'cha',
      rank: 0,
      checkType: 'none',
      description: '<p>You lean over their shoulder before they start. If you have a Rank in a Skill of the same group, they add 1d4. If you do not, they add 1, out of politeness. One helper per check. Not for Stat Checks, party checks or combat.</p>',
      tags: ['kind.skill', 'skillGroup.utility', 'stat.cha', 'trigger.before_ally_check'],
      assist: {
        formula: '1d4',
        untrainedFormula: '1',
        when: { all: [], any: ['check.skill'], none: ['check.stat', 'check.party', 'situation.in_combat'] }
      }
    }
  },
  {
    type: 'gear',
    _id: id(2),
    name: 'Matching Team Windbreakers',
    img: 'icons/svg/shield.svg',
    system: {
      identifier: 'matching-team-windbreakers',
      slot: 'torso',
      description: '<p>Everyone in the same windbreaker loses together, slightly less often. +1 to a check you roll for a party check, and to nothing else.</p>',
      checkModifiers: [{ kind: 'bonus', label: 'Team spirit', value: 1, condition: { all: ['check.party'], any: [], none: [] } }]
    }
  }
]);
