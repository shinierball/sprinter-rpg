/**
 * src/content/specs/examples/mobs/technical-difficulties.mjs
 * Release set "Technical Difficulties": the mob that hands the debuffs out, so the set can be played. Each attack names
 * debuffs by identifier in `onHit.evadeFail`; the debuffs are in `../items/technical-difficulties.mjs`. A Mob Creator state,
 * replayed by `tests/integration/examples-authorable-3-49.test.mjs`. `exampleId('td', 'a', 1)`. Original text.
 */
import '../../../../data/builders/mob-payload.mjs'; // registers the `mob` payload delegate (pure)
import { exampleId } from '../ids.mjs';

export const SPECS = Object.freeze([
  {
    type: 'mob',
    _id: exampleId('td', 'a', 1),
    name: 'Continuity Supervisor',
    img: 'icons/svg/skull.svg',
    level: 3,
    designFloor: 3,
    size: 'medium',
    creatureType: 'Humanoid',
    abilities: { str: 3, dex: 5, con: 5, int: 6, cha: 4 },
    description: 'Holds a clipboard like a weapon and a pencil like a grudge. Notices everything that does not match the last take.',
    aiDescription: 'Our continuity supervisor has noted that your sleeve was rolled up in the previous shot. She has noted it twice. Be careful about a third.',
    attacks: [
      {
        name: 'Note to Self',
        toHitStat: 'int',
        damageStat: 'int',
        damageDice: '1d6',
        damageType: 'Psychic',
        onHit: { evadeFail: { degree: 'fail', debuffs: ['first-warning'] } },
        effects: 'A first note is a First Warning. A second is a Final Warning.'
      },
      {
        name: 'Overbooked Schedule',
        toHitStat: 'int',
        damageStat: 'int',
        damageDice: '1d6',
        damageType: 'Psychic',
        onHit: { evadeFail: { degree: 'fail', debuffs: ['double-booked'] } },
        effects: 'You are needed in two places. One of them is a blooper.'
      },
      {
        name: 'Cue the Follow-Spot',
        toHitStat: 'int',
        damageStat: 'int',
        damageDice: '1d6',
        damageType: 'Psychic',
        onHit: { evadeFail: { degree: 'fail', debuffs: ['spotlit', 'blooper-reel'] } },
        effects: 'The light finds you. Everyone can see exactly what you do next, and the reel keeps it.'
      },
      {
        name: 'Pyrotechnics Cue',
        toHitStat: 'int',
        damageStat: 'int',
        damageDice: '1d6',
        damageType: 'Fire',
        onHit: { evadeFail: { degree: 'fail', debuffs: ['squib-malfunction'] } },
        effects: 'The cue was for someone else. The blood pack did not check.'
      }
    ],
    loot: [
      { name: 'Annotated Script', quantity: 1, notes: '', description: 'Every page is marked up. Your name is in the margins, with a question mark.' }
    ]
  }
]);
