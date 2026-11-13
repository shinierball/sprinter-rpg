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
const OTHER = ['Force', 'Holy', 'Necrotic', 'Psychic', 'Sonic', 'Brimstone'];

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
  defenseDoc('buff', 'dccex00000000001', 'Bubble Wrap Onesie', 'icons/svg/shield.svg',
    'Oh the Onesie, the king of fashion. This limited edition, limited use fashion statement is both a collectible and a collectable. Resistance to Bludgeoning, Piercing and Slashing for one hour or until all the bubbles pop. ',
    'resistance', PHYSICAL),
  defenseDoc('buff', 'dccex00000000002', 'Weatherproof Shellacking', 'icons/svg/fire-shield.svg',
    'Sometimes the only way to really feel that weather is to get beaten by it. Resistance to Fire, Ice and Electric for one hour ... but you\'ll feel all of it!',
    'resistance', ['Fire', 'Ice', 'Electric']),
  defenseDoc('buff', 'dccex00000000003', 'Craft Services Hazmat Apron', 'icons/svg/biohazard.svg',
    'Protects you from the catering. Mostly from the catering. Unliess it hits you in the face.  Who wears an apron on their face anyways? Resistance to Acid and Poison for one hour.',
    'resistance', ['Acid', 'Poison']),
  defenseDoc('buff', 'dccex00000000004', 'Isolation Booth Headphones', 'icons/svg/sound-off.svg',
    'You cannot hear the audience, the host, or the shockwave. (AI pauses) BOOOOM! Resistance to Sonic and Force for one hour.',
    'resistance', ['Sonic', 'Force']),
  defenseDoc('buff', 'dccex00000000005', 'Ironclad Talent Contract', 'icons/svg/holy-shield.svg',
    'Your soul, your mind and your profits are already licensed to the network. No double dipping. Resistance to Holy, Necrotic, Psychic and Brimstone for one hour.',
    'resistance', ['Holy', 'Necrotic', 'Psychic', 'Brimstone']),
  defenseDoc('buff', 'dccex00000000006', 'Stunt Double', 'icons/svg/mage-shield.svg',
    'For one round, someone in your wig takes the hit: Immunity to Bludgeoning, Piercing and Slashing for 1 round.',
    'immunity', PHYSICAL, 1),
  defenseDoc('buff', 'dccex00000000007', 'Countersigned Safety Waiver', 'icons/svg/hazard.svg',
    'The safety officer signed it. For one round the hazards are legally their problem: Immunity to Acid, Electric, Fire, Ice and Poison for 1 round.',
    'immunity', ELEMENTAL, 1),
  defenseDoc('buff', 'dccex00000000008', 'The 700 Club', 'icons/svg/video.svg',
    'Recorded with enthusiasm, fueled by your donations. Immunity to Force, Holy, Necrotic, Psychic, Sonic and Brimstone for 1 round.',
    'immunity', OTHER, 1),
  defenseDoc('debuff', 'dccex00000000009', 'Rock Crystal Snack', 'icons/svg/skull.svg',
    'Nom nom ouch! Bludgeoning, piercing and slashing damage is doubled for 3 rounds.',
    'vulnerability', PHYSICAL, 3),
  defenseDoc('debuff', 'dccex00000000010', 'Soaked in Sponsor Cola', 'icons/svg/acid.svg',
    'Sticky, conductive, flammable and somehow toxic. The sponsor is reviewing the formula. Acid, Electric, Fire, Ice and Poison damage is doubled for 3 rounds.',
    'vulnerability', ELEMENTAL, 3),
  defenseDoc('debuff', 'dccex00000000011', 'Bad Press', 'icons/svg/downgrade.svg',
    'Everyone has an opinion about you, and the universe is inclined to agree. Force, Holy, Necrotic, Psychic, Sonic and Brimstone damage is doubled for 3 rounds.',
    'vulnerability', OTHER, 3),
  statBuff('dccex00000000012', 'Shaken Weigh', 'icons/svg/pill.svg',
    'Chalky, beige, and legally a food. Shaken not stirred. +2 Strength for one hour.', 'str'),
  statBuff('dccex00000000013', 'Pre-Show Stretch', 'icons/svg/wingfoot.svg',
    'The choreographer insists. Your hamstrings concur. +2 Dexterity for one hour.', 'dex'),
  statBuff('dccex00000000014', 'Fully Hydrated', 'icons/svg/tankard.svg',
    'WARNING! You are now measurably more durable but may experience unsolicited leakage. +2 Constitution for one hour.', 'con'),
  statBuff('dccex00000000015', 'Teleprompter Feed', 'icons/svg/eye.svg',
    'A classic gameshow exploit! Smile and read. +2 Intelligence for one hour.', 'int'),
  statBuff('dccex00000000016', 'My Makeup! My Makeup!', 'icons/svg/light.svg',
    'Powdered, lit, and briefly irresistible. Only the zoo animals know your secrets. +2 Charisma for one hour.', 'cha'),
  {
    type: 'buff',
    _id: 'dccex00000000017',
    name: 'Padded Ego',
    img: 'icons/svg/regen.svg',
    system: {
      description: 'A producer told you that you were doing great. It absorbs the next few hits. +10 temporary Health for one hour.',
      defenseModifiers: [{ kind: 'tempHp', value: 10, label: 'Padded Ego' }]
    }
  }
]);
