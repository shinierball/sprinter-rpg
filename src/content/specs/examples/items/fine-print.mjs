/**
 * src/content/specs/examples/items/fine-print.mjs
 * Release set "Fine Print": a race and two classes whose `requirements` rows use every kind the registry has: Stat,
 * Skill Rank (by tag query), Popularity, Floor, Race, Class, Achievement, Tags and the GM's note. A crawler who does not
 * meet a row gets the Rule Break prompt, never a block. The rows are authored through the creators' Requirements accordion.
 */
import { exampleId } from '../ids.mjs';

export const SPECS = Object.freeze([
  {
    type: 'race',
    _id: exampleId('fp', 'i', 1),
    name: 'Alternate Contestant',
    img: 'icons/svg/mystery-man.svg',
    description: 'Was told to stay by the phone. The phone rang. Here they are. +1 Constitution and +1 Charisma. To take it you need a Defensive Skill at Rank 3 or higher and to be on Floor 2 or deeper, and the GM decides whether your signed waiver counts.',
    size: 'medium',
    heritage: 'alien',
    stats: { con: 1, cha: 1 },
    requirements: [
      // Any Defensive Skill at Rank 3 or higher: the row names a tag query, not one skill.
      { kind: 'skillRank', value: 3, query: { all: ['kind.skill', 'skillGroup.defensive'] } },
      { kind: 'floor', value: 2 },
      { kind: 'note', text: 'Bring a signed waiver. The GM decides whether a waiver in crayon counts.' }
    ]
  },
  {
    type: 'class',
    _id: exampleId('fp', 'i', 2),
    name: 'Season Regular',
    img: 'icons/svg/book.svg',
    description: 'Has appeared in so many episodes that the audience assumes they were hired. +1 Strength and +1 Constitution; the Fighter archetype. To take it you need Strength 10 and Popularity 3 or more.',
    archetypes: ['archetype.fighter'],
    isEarthClass: false,
    stats: { str: 1, con: 1 },
    requirements: [
      { kind: 'stat', stat: 'str', value: 10 },
      { kind: 'popularity', value: 3 }
    ]
  },
  {
    type: 'class',
    _id: exampleId('fp', 'i', 3),
    name: 'Fan Favorite Finalist',
    img: 'icons/svg/aura.svg',
    description: 'Has a mug, a catchphrase and a clause in their contract about both. +2 Charisma; the Bard archetype. To take it you must be an Alternate Contestant and a Season Regular, hold the Ratings Spike achievement and have alien heritage.',
    archetypes: ['archetype.bard'],
    isEarthClass: false,
    stats: { cha: 2 },
    requirements: [
      { kind: 'race', identifier: 'alternate-contestant' },
      { kind: 'class', identifier: 'season-regular' },
      { kind: 'achievement', identifier: 'ratings-spike' },
      { kind: 'tags', query: { all: ['heritage.alien'] } }
    ]
  }
]);
