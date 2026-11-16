/**
 * src/content/specs/examples/items/prop-department.mjs
 * Release set "Prop Department": content for tags the engine reads and no document carried. `exampleId('pd', 'i', 1..8)`.
 *   1 Neighborhood Map (Laminated)   `rule.grind-map-neighborhood`: +1 hour to the safe grinding threshold
 *   2 Borough Map (Spiral-Bound)     `rule.grind-map-borough`: +2 hours
 *   3 Set-Strike Sledge + 4 Set Demolition        `weaponGroup.power`
 *   5 Trick Throwing Star + 6 Novelty Throwing    `weaponGroup.exotic`
 *   7 Gaffer's Pocket Knife + 8 Gaffer Work       `weaponGroup.utility`
 * A weapon and a Skill that share a `weaponGroup.<id>` tag match each other; each carries a weapon type tag beside it.
 */
import { exampleId } from '../ids.mjs';

const MAP_IMG = 'icons/svg/book.svg';

/** A grinding map: treasure carrying one rule tag. */
const map = (n, name, identifier, description, tag) => ({
  type: 'loot',
  _id: exampleId('pd', 'i', n),
  name,
  img: MAP_IMG,
  system: { identifier, description: `<p>${description}</p>`, lootType: 'treasure', quantity: 1, tags: [tag] }
});

/** A melee weapon of one group. */
const weapon = (n, name, identifier, skillId, group, type, description) => ({
  type: 'gear',
  _id: exampleId('pd', 'i', n),
  name,
  img: 'icons/svg/combat.svg',
  system: { identifier, slot: 'hands', isWeapon: true, description: `<p>${description}</p>`, tags: [type, group, 'weaponClass.melee'], associatedSkills: [skillId] }
});

/** The Skill of that group: a weapon Skill with its own Base Damage. */
const skill = (n, name, identifier, stat, group, type, dice, damageType, description) => ({
  type: 'skill',
  _id: exampleId('pd', 'i', n),
  name,
  img: 'icons/svg/sword.svg',
  system: {
    identifier, stat, rank: 0, description: `<p>${description}</p>`,
    tags: ['skillGroup.weapon', 'skillGroup.combat', 'action.attack', type, group, 'weaponClass.melee'],
    isAttack: true, hasDamage: true, baseDamage: { dice, stat, damageType }
  }
});

export const SPECS = Object.freeze([
  map(1, 'Neighborhood Map (Laminated)', 'neighborhood-map-laminated',
    'Every street within a short walk of the entrance, drawn by someone who has clearly been lost on all of them. A crawler who holds it can grind one hour longer before the grind turns dangerous: the safe limit goes up by 1.',
    'rule.grind-map-neighborhood'),
  map(2, 'Borough Map (Spiral-Bound)', 'borough-map-spiral-bound',
    'The whole borough, one page per block, with the good parts marked in a pen that has since dried out. A crawler who holds it can grind two hours longer before the grind turns dangerous: the safe limit goes up by 2. If a crawler holds both maps, only the better one counts.',
    'rule.grind-map-borough'),
  weapon(3, 'Set-Strike Sledge', 'set-strike-sledge', 'set-demolition', 'weaponGroup.power', 'weapon.warhammer',
    'The tool that ends every production: it takes the set down in four swings and the crew down in one. It lists Set Demolition and shares its Power Weapons group.'),
  skill(4, 'Set Demolition', 'set-demolition', 'str', 'weaponGroup.power', 'weapon.warhammer', '1d10', 'Bludgeoning',
    'Wrecking things on purpose, on a schedule. Power Weapons group. Base Damage: 1d10 + Str Bludgeoning.'),
  weapon(5, 'Trick Throwing Star', 'trick-throwing-star', 'novelty-throwing', 'weaponGroup.exotic', 'weapon.shuriken',
    'Rubber on the label and steel in the middle, a mistake nobody has corrected. It lists Novelty Throwing and shares its Exotic group.'),
  skill(6, 'Novelty Throwing', 'novelty-throwing', 'dex', 'weaponGroup.exotic', 'weapon.shuriken', '1d6', 'Piercing',
    'Weapons nobody ordered and everybody got. Exotic group. Base Damage: 1d6 + Dex Piercing.'),
  weapon(7, 'Gaffer\'s Pocket Knife', 'gaffers-pocket-knife', 'gaffer-work', 'weaponGroup.utility', 'weapon.dagger',
    'Forty-one tools, one of which is a blade. It lists Gaffer Work and shares its Utility group.'),
  skill(8, 'Gaffer Work', 'gaffer-work', 'dex', 'weaponGroup.utility', 'weapon.dagger', '1d4', 'Slashing',
    'Cutting tape, cable and, if pressed, other things. Utility group. Base Damage: 1d4 + Dex Slashing.')
]);
