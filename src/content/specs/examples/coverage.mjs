/**
 * src/content/specs/examples/coverage.mjs
 * The 17 full-coverage example buffs and debuffs. Together they fill every cell of the coverage axes in
 * tests/fixtures/examples/coverage.mjs: each core
 * damage type as a Resistance, an Immunity and a Vulnerability, a +2 buff for each stat, and a +10 Temporary Health buff.
 * Every spec is a `buildPayload(type, spec)` input; rows are `defenseModifiers` and `grants[kind: stat]` only, with no tags
 * and no legacy `buffType` fields. Names and premises are original example content in the 3.4 tone. Redundancy with the
 * matrix homes is allowed.
 */

const PHYSICAL = ['Bludgeoning', 'Piercing', 'Slashing'];
const ELEMENTAL = ['Acid', 'Electric', 'Fire', 'Ice', 'Poison'];
const OTHER = ['Force', 'Holy', 'Necrotic', 'Psychic', 'Sonic'];

const rows = (kind, name, types) => types.map(damageType => ({ kind, damageType, label: name }));

const defenseDoc = (type, id, name, img, description, kind, types, rounds) => ({
  type,
  _id: id,
  name,
  img,
  system: {
    description,
    defenseModifiers: rows(kind, name, types),
    ...(rounds ? { durationConfig: { type: 'rounds', value: rounds } } : {})
  }
});

const statBuff = (id, name, img, description, stat) => ({
  type: 'buff',
  _id: id,
  name,
  img,
  system: { description, grants: [{ kind: 'stat', stat, value: 2, label: name }] }
});

export const COVERAGE_SPECS = Object.freeze([
  defenseDoc('buff', 'dccex00000000001', 'Packing Foam Onesie', 'icons/svg/shield.svg',
    'Shipped to the set in one piece. Intends to leave that way. Halves bludgeoning, piercing and slashing damage.',
    'resistance', PHYSICAL),
  defenseDoc('buff', 'dccex00000000002', 'Weatherproof Hosting Jacket', 'icons/svg/fire-shield.svg',
    'Rated for the outdoor segment: heat lamps, the snow machine, and the lightning effect nobody tested.',
    'resistance', ['Fire', 'Ice', 'Electric']),
  defenseDoc('buff', 'dccex00000000003', 'Craft Services Hazmat Apron', 'icons/svg/biohazard.svg',
    'Protects you from the catering. Mostly from the catering.',
    'resistance', ['Acid', 'Poison']),
  defenseDoc('buff', 'dccex00000000004', 'Isolation Booth Headphones', 'icons/svg/sound-off.svg',
    'You cannot hear the audience, the host, or the shockwave.',
    'resistance', ['Sonic', 'Force']),
  defenseDoc('buff', 'dccex00000000005', 'Ironclad Talent Contract', 'icons/svg/holy-shield.svg',
    'Your soul, your mind and your afterlife are already licensed to the network. Nobody else gets to touch them.',
    'resistance', ['Holy', 'Necrotic', 'Psychic']),
  defenseDoc('buff', 'dccex00000000006', 'Stunt Double Clause', 'icons/svg/mage-shield.svg',
    'For one round, someone in your wig takes the hit.',
    'immunity', PHYSICAL, 1),
  defenseDoc('buff', 'dccex00000000007', 'Countersigned Safety Waiver', 'icons/svg/hazard.svg',
    'The safety officer signed it. For one round the hazards are legally their problem.',
    'immunity', ELEMENTAL, 1),
  defenseDoc('buff', 'dccex00000000008', 'Pre-Recorded Segment', 'icons/svg/video.svg',
    'You are not really here. This was taped earlier.',
    'immunity', OTHER, 1),
  defenseDoc('debuff', 'dccex00000000009', 'Sugar-Glass Chin', 'icons/svg/skull.svg',
    'Breakaway, like the props. Bludgeoning, piercing and slashing damage is doubled.',
    'vulnerability', PHYSICAL, 3),
  defenseDoc('debuff', 'dccex00000000010', 'Soaked in Sponsor Cola', 'icons/svg/acid.svg',
    'Sticky, conductive, flammable and somehow toxic. The sponsor is reviewing the formula.',
    'vulnerability', ELEMENTAL, 3),
  defenseDoc('debuff', 'dccex00000000011', 'Bad Press', 'icons/svg/downgrade.svg',
    'Everyone has an opinion about you, and the universe is inclined to agree.',
    'vulnerability', OTHER, 3),
  statBuff('dccex00000000012', 'Sponsor Sample Protein Shake', 'icons/svg/pill.svg',
    'Chalky, beige, and legally a food. +2 Strength.', 'str'),
  statBuff('dccex00000000013', 'Pre-Show Stretch', 'icons/svg/wingfoot.svg',
    'The choreographer insists. Your hamstrings concur. +2 Dexterity.', 'dex'),
  statBuff('dccex00000000014', 'Mandatory Hydration Break', 'icons/svg/tankard.svg',
    'Union rules. You are now measurably more durable. +2 Constitution.', 'con'),
  statBuff('dccex00000000015', 'Teleprompter Feed', 'icons/svg/eye.svg',
    'Someone is feeding you the answers. Smile and read. +2 Intelligence.', 'int'),
  statBuff('dccex00000000016', 'Makeup Chair Touch-Up', 'icons/svg/light.svg',
    'Powdered, lit, and briefly irresistible. +2 Charisma.', 'cha'),
  {
    type: 'buff',
    _id: 'dccex00000000017',
    name: 'Padded Ego',
    img: 'icons/svg/regen.svg',
    system: {
      description: 'A producer told you that you were doing great. It absorbs the next few hits. +10 temporary Health.',
      defenseModifiers: [{ kind: 'tempHp', value: 10, label: 'Padded Ego' }]
    }
  }
]);
