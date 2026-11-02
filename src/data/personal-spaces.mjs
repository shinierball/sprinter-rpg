/**
 * Personal Spaces Data Catalog for Sprinter RPG
 *
 * Defines space types (Single Room, Apartment, Bunker, Suite, Guild Hall),
 * default amenities, and upgrade catalog modules (Rest, Training,
 * Quest Board, Outside Comms, Security, Stash Expansion, Crafting Tables).
 */

export const COG_SPACE_TYPES = {
  'space.single_room': {
    id: 'space.single_room',
    label: 'Single-Room Safe Room',
    size: 'Single Room',
    tier: 1,
    baseDefense: 10,
    baseCapacity: 100,
    amenities: 'Basic Foam Mattress, Shower Locker, Chemical Toilet',
    security: 'Standard Steel Vault Hatch',
    description: 'Compact personal sanctuary provided to crawlers entering the safe zones.'
  },
  'space.apartment': {
    id: 'space.apartment',
    label: '1-Bedroom Safe Room Apartment',
    size: '1-Bedroom',
    tier: 2,
    baseDefense: 12,
    baseCapacity: 200,
    amenities: 'Memory Foam Bed, Full Bathroom, Kitchenette, Mini-Fridge',
    security: 'Reinforced Electronic Keycard Deadbolt',
    description: 'Comfortable living quarters suited for solo crawlers or a crawler and pet.'
  },
  'space.bunker': {
    id: 'space.bunker',
    label: 'Reinforced Crawler Bunker',
    size: 'Bunker Suite',
    tier: 3,
    baseDefense: 16,
    baseCapacity: 350,
    amenities: 'Hydro-Therapy Bunk, Medical Decon Station, Storage Lockers',
    security: 'Heavy Titanium Blast Door with Arcane Pressure Sensors',
    description: 'Fortified redoubt built to withstand explosive dungeon sieges.'
  },
  'space.suite': {
    id: 'space.suite',
    label: 'Penthouse Sponsor Suite',
    size: 'Penthouse',
    tier: 4,
    baseDefense: 18,
    baseCapacity: 500,
    amenities: 'Velvet King Bed, Luxury Whirlpool Jacuzzi, Gourmet Dispenser, Wet Bar',
    security: 'Biometric Security Grid with Alarm Wards',
    description: 'Lavish high-roller suite reserved for top-ranking broadcast favorites.'
  },
  'space.guild_hall': {
    id: 'space.guild_hall',
    label: 'Guild Safe House',
    size: 'Guild Compound',
    tier: 5,
    baseDefense: 20,
    baseCapacity: 1000,
    mercenaryCapacity: 4,
    amenities: 'Multi-Bunk Barracks, War Room Table, Mess Hall, Decon Pods',
    security: 'Heavy Citadel Gates with Ward Matrix and Turret Sockets',
    description: 'Expansive compound capable of housing an entire crawler guild or party.'
  }
};

export const COG_SPACE_UPGRADES = [
  // --- Rest & Recovery Upgrades ---
  {
    id: 'upgrade.rest.bedding',
    name: 'Luxury Memory Foam Bedding',
    typeTag: 'upgrade.rest',
    tier: 1,
    cost: 250,
    hoursReduction: 1,
    wellRestedBonus: 1,
    description: 'Ergonomic pressure-relief mattress. Cuts Long Rest duration by 1 hour (7-hour rest) and grants +1 on checks after rest.'
  },
  {
    id: 'upgrade.rest.shower',
    name: 'Hydro-Therapy Decontamination Shower',
    typeTag: 'upgrade.rest',
    tier: 2,
    cost: 500,
    hoursReduction: 2,
    wellRestedBonus: 1,
    removesInjuriesOnRest: true,
    description: 'Pulsing hot therapeutic jets that cleanse acid and toxins. Cuts Long Rest by 2 hours (6-hour rest) and purges Minor Injuries.'
  },
  {
    id: 'upgrade.rest.medpod',
    name: 'Medical Regeneration Pod',
    typeTag: 'upgrade.rest',
    tier: 3,
    cost: 1200,
    hoursReduction: 4,
    wellRestedBonus: 2,
    bonusTempBars: 2,
    tempBarsHpPerSlot: 10,
    description: 'Cryo-regenerative suspension tube. Cuts Long Rest by 4 hours (4-hour rest) and grants 2 Temporary Health Bars (10 HP each) upon waking.'
  },

  // --- Skill & Spell Training Upgrades ---
  {
    id: 'upgrade.training.dummies',
    name: 'Articulated Practice Dummies',
    typeTag: 'upgrade.training',
    tier: 1,
    cost: 300,
    bonusGrindHours: 2,
    advancementBonus: 0,
    training: { enabled: true, sessionsPerWindow: 1, windowHours: 30, hourCost: 1, rollBonus: 0, advantage: false, dcModifier: 0 },
    description: 'Spring-loaded mechanized targets for weapon practice. Accrues +2 bonus banked grind hours during every long rest.'
  },
  {
    id: 'upgrade.training.sparring',
    name: 'Reinforced Sparring Ring',
    typeTag: 'upgrade.training',
    tier: 2,
    cost: 600,
    bonusGrindHours: 3,
    advancementBonus: 1,
    training: { enabled: true, sessionsPerWindow: 2, windowHours: 30, hourCost: 1, rollBonus: 2, advantage: false, dcModifier: 0 },
    description: 'Padded combat arena with impact sensors. Grants +3 bonus banked grind hours and a +1 bonus to all training advancement checks.'
  },
  {
    id: 'upgrade.training.library',
    name: 'Grand Arcane Spell Library',
    typeTag: 'upgrade.training',
    tier: 3,
    cost: 1500,
    bonusGrindHours: 5,
    advancementBonus: 2,
    training: { enabled: true, sessionsPerWindow: 2, windowHours: 30, hourCost: 1, rollBonus: 2, advantage: true, dcModifier: -2 },
    description: 'Encyclopedic arcane texts and meditating focus orb. Grants +5 bonus banked grind hours, +2 advancement checks, and -2 to training complication DCs.'
  },

  // --- Job & Quest Terminal Upgrades ---
  {
    id: 'upgrade.quest.terminal',
    name: 'Floor Job Terminal',
    typeTag: 'upgrade.quest_board',
    tier: 1,
    cost: 200,
    unlockedJobTiers: 1,
    description: 'Encrypted network display connecting to the floor job board. Unlocks standard floor bounties and sponsor jobs.'
  },
  {
    id: 'upgrade.quest.vip_console',
    name: 'High-Priority VIP Contract Console',
    typeTag: 'upgrade.quest_board',
    tier: 2,
    cost: 800,
    unlockedJobTiers: 2,
    jobRewardMultiplier: 1.5,
    description: 'Gold-tier contract interface offering high-stakes bounties with 50% bonus Gold and exclusive equipment rewards.'
  },

  // --- Outside World Comms & Broadcast Upgrades ---
  {
    id: 'upgrade.comms.tv',
    name: 'Sponsor Broadcast TV',
    typeTag: 'upgrade.comms',
    tier: 1,
    cost: 150,
    description: 'Flat holographic monitor broadcasting live crawler popularity rankings, fan sentiment, and show recap highlights.'
  },
  {
    id: 'upgrade.comms.mailbox',
    name: 'Fan Mailbox & Sponsor Delivery Chute',
    typeTag: 'upgrade.comms',
    tier: 2,
    cost: 500,
    description: 'Direct chute connected to surface mail logistics. Receive fan letters, sponsor gift packages, and brand endorsements.'
  },

  // --- Security & Defense Upgrades ---
  {
    id: 'upgrade.defense.ward',
    name: 'Arcane Alarm Ward',
    typeTag: 'upgrade.defense',
    tier: 1,
    cost: 200,
    defenseBonus: 4,
    description: 'Intrusion detection runes painted across doorframes. Adds +4 to Space Defense Rating.'
  },
  {
    id: 'upgrade.defense.blastdoor',
    name: 'Titanium Blast-Resistant Vault Door',
    typeTag: 'upgrade.defense',
    tier: 2,
    cost: 750,
    defenseBonus: 8,
    description: 'Eight-inch reinforced titanium alloy hatch with pneumatic deadbolts. Adds +8 to Space Defense Rating.'
  },

  // --- Stash & Storage Expansion Upgrades ---
  {
    id: 'upgrade.stash.chest',
    name: 'Dimensional Stash Chest',
    typeTag: 'upgrade.stash_expansion',
    tier: 1,
    cost: 250,
    stashBonus: 100,
    description: 'Pocket dimension container. Increases personal space stash capacity by +100 items.'
  },
  {
    id: 'upgrade.stash.locker',
    name: 'Quantum Storage Vault',
    typeTag: 'upgrade.stash_expansion',
    tier: 2,
    cost: 650,
    stashBonus: 250,
    description: 'Subspace compression storage locker. Increases personal space stash capacity by +250 items.'
  },

  // --- Crafting Station Hardpoint Upgrades ---
  {
    id: 'upgrade.crafting.alchemy',
    name: 'Alchemy & Brewing Station Hardpoint',
    typeTag: 'upgrade.crafting_table',
    tier: 1,
    cost: 400,
    craftingStationType: 'alchemy',
    description: 'Reinforced ventilation hood and burner station ready to mount an Alchemy Crafting Table.'
  },
  {
    id: 'upgrade.crafting.forge',
    name: 'Blacksmithing Forge & Anvil Hardpoint',
    typeTag: 'upgrade.crafting_table',
    tier: 1,
    cost: 500,
    craftingStationType: 'forge',
    description: 'Heat-resistant stone hearth and hardened steel anvil ready to mount a Forge Crafting Table.'
  },
  {
    id: 'upgrade.crafting.workbench',
    name: 'Tinkerer & Engineering Workbench Hardpoint',
    typeTag: 'upgrade.crafting_table',
    tier: 1,
    cost: 400,
    craftingStationType: 'workbench',
    description: 'Precision tool rack and vice grips ready to mount a Mechanical & Gadget Crafting Table.'
  },

  // --- Barracks & Retainer Housing Upgrades ---
  {
    id: 'upgrade.barracks.bunkhouse',
    name: 'Retainer & Mercenary Bunkhouse',
    typeTag: 'upgrade.barracks',
    tier: 1,
    cost: 350,
    mercenaryCapacity: 2,
    mercenaryDiscountPct: 10,
    description: 'Sturdy bunk beds, gear footlockers, and mess rations. Houses up to 2 mercenaries or NPCs between floors and provides a 10% discount on daily upkeep.'
  },
  {
    id: 'upgrade.barracks.quarters',
    name: 'Mercenary Living Quarters & Armory',
    typeTag: 'upgrade.barracks',
    tier: 2,
    cost: 750,
    mercenaryCapacity: 5,
    mercenaryDiscountPct: 20,
    description: 'Private curtained bunks, weapon maintenance racks, and card tables. Houses up to 5 mercenaries or NPCs between floors with a 20% discount on daily upkeep.'
  },
  {
    id: 'upgrade.barracks.grand_barracks',
    name: 'Grand Barracks & Mess Hall',
    typeTag: 'upgrade.barracks',
    tier: 3,
    cost: 1600,
    mercenaryCapacity: 10,
    mercenaryDiscountPct: 30,
    description: 'Expansive military-grade garrison complete with mess cookstation, armory lockers, and training arena. Houses up to 10 mercenaries or NPCs between floors with a 30% discount on daily upkeep and +1 to morale rolls.'
  }
];
