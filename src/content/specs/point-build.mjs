/**
 * Point-build entries tied to the setting (3.6a R2): named clubs, the spell library club, two book-race abilities, the
 * manager role, club exclusion, and the Stage Parent preset (an original sample so the preset mechanism has a live example). The bundled provider registers them under the `pointBuild`
 * catalog kind; `src/content/point-build.mjs` merges them with the core entries in `src/data/point-build-catalog.mjs`.
 * `kind` is 'benefit' | 'detriment' | 'preset'.
 */

export const COG_POINT_BUILD_ENTRIES = [
  {
    id: 'minor_club_outlaws',
    kind: 'benefit',
    name: 'Membership in the Outlaws Club',
    tier: 'minor',
    cost: 1,
    category: 'Club & Access',
    description: "Dues paid, handshake learned: you are in the Outlaws' Club and can use its doors.",
    rows: [
      { path: 'system.tags', row: 'access.club.outlaws' }
    ]
  },
  {
    id: 'minor_club_champions',
    kind: 'benefit',
    name: 'Membership in the Champions Club',
    tier: 'minor',
    cost: 1,
    category: 'Club & Access',
    description: "You hold a card for the Champions' Club, and the bouncer knows your face.",
    rows: [
      { path: 'system.tags', row: 'access.club.champions' }
    ]
  },
  {
    id: 'mod_all_clubs',
    kind: 'benefit',
    name: 'All Clubs Access',
    tier: 'moderate',
    cost: 2,
    category: 'Club & Access',
    description: 'One card gets you into every club, trade or social, that the Dungeon runs.',
    rows: [
      { path: 'system.tags', row: 'access.club.all_memberships' }
    ]
  },
  {
    id: 'mod_spell_library_club',
    kind: 'benefit',
    name: 'Access to the Spell Library Club',
    tier: 'moderate',
    cost: 2,
    category: 'Club & Access',
    description: 'You hold a card for the Spell Library Club, which lends out rare tomes and a few class tricks.',
    rows: [
      { path: 'system.tags', row: 'access.club.spell_library' }
    ]
  },
  {
    id: 'extreme_shape_change',
    kind: 'benefit',
    name: 'Malleable Form Morphing',
    tier: 'extreme',
    cost: 4,
    category: 'Utility',
    description: 'Your body goes soft as clay: you can pass for other creatures, copy their clothes, and wriggle out of restraints.'
  },
  {
    id: 'epic_changeling_shapeshifting',
    kind: 'benefit',
    name: 'Changeling Shapeshifting & Race Library',
    tier: 'epic',
    cost: 6,
    category: 'Utility',
    description: 'Touch any species to store in your shapeshifting library; transform as an action and assume their racial stats and skills.'
  },
  {
    id: 'major_manager_assistance',
    kind: 'benefit',
    name: 'Personal Manager Guide Assistance',
    tier: 'major',
    cost: 3,
    category: 'Utility',
    description: 'Access to significant managerial advice, sponsorship navigation, and backstage showrunner intervention.'
  },
  {
    id: 'det_minor_club_exclusion',
    kind: 'detriment',
    name: 'Excluded from a Club',
    tier: 'minor',
    extraPoints: 1,
    description: 'Cannot choose this Class/Race if you possess membership in a specific club (you pick the club).',
    rowParams: ['clubTag'],
    rows: [
      { path: 'system.requires', row: { none: ['$clubTag'] } }
    ]
  },
  {
    id: 'preset_stage_parent',
    kind: 'preset',
    name: 'Stage Parent',
    builderType: 'class',
    archetypes: ['archetype.bard', 'archetype.fighter'],
    isEarth: true,
    prerequisites: 'None (Earth Class, suits anyone who has ever shouted advice from the audience)',
    description: 'You spent a decade in the front row of other people\u2019s auditions, clipboard in hand, and now you have finally been cast. You coach from the sidelines, feed the cast between takes, and take every bad review personally.',
    stats: { str: 0, dex: -2, con: 2, int: 1, cha: 1 },
    skills: [
      { name: 'Repair', rank: 2, cost: 4 },
      { name: 'Tactics', rank: 2, cost: 4 },
      { name: 'Weapon Skill', choice: true, category: 'weapon', rank: 1, cost: 2 }
    ],
    spells: [
      { name: 'Confetti Cannon', rank: 1, cost: 2 }
    ],
    selectedBenefits: [
      { id: 'major_party_buff_daily', name: 'Daily Party-Wide Buff (1/Day)', tier: 'major', cost: 3, category: 'Party' },
      { id: 'mod_dr_buff_1', name: '+1 DR Buff', tier: 'moderate', cost: 2, drBonus: 1, category: 'Defense' },
      { id: 'minor_safe_room', name: 'Complimentary Safe Room Lodging', tier: 'minor', cost: 1, category: 'Utility' }
    ],
    selectedDetriments: [
      { id: 'det_minor_stat_penalties', name: 'Stat Penalties (-2 Stats)', tier: 'minor', extraPoints: 1 }
    ]
  }
];
