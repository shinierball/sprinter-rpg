/**
 * Mercenary Catalog Dataset
 * Pre-configured mercenary hirelings ready for hire through the Mercenary Guild.
 * Each mercenary features a crawler race, class, role, daily hire rate, weapons,
 * skills, spells, and equipment.
 */

export const COG_MERCENARIES = [
  {
    _id: "dccmerc000000001",
    name: 'Goran "Ironjaw" Flint',
    type: "mercenary",
    img: "icons/svg/shield.svg",
    system: {
      abilities: {
        str: { value: 16, unenhanced: 16, mod: 4 },
        int: { value: 8, unenhanced: 8, mod: 3 },
        con: { value: 18, unenhanced: 18, mod: 4 },
        dex: { value: 10, unenhanced: 10, mod: 4 },
        cha: { value: 12, unenhanced: 12, mod: 4 }
      },
      attributes: {
        hp: { value: 40, max: 40 },
        mana: { value: 8, max: 8 },
        evade: { total: 4 },
        dr: { total: 3 },
        speed: { move: 20, step: 10 }
      },
      details: {
        level: 3,
        race: "Meadow Lark",
        class: "Vanguard Bruiser",
        role: "Tank",
        dailyRate: 35,
        contractDays: 0,
        hired: false,
        employerIds: [],
        ownerId: "",
        housedSpaceId: "",
        housingStatus: "available",
        special: "<p>Unshakable Bulwark: Taunts enemies and interposes shield to absorb incoming attacks meant for squishy crawlers.</p>",
        notes: "<p>A hardened Meadow Lark veteran who survived the early floor collapse. Goran charges directly into monster ambushes with a heavy iron pick and fortified tower shield.</p>",
        floor: "1st Floor"
      },
      gearSlots: {
        head: "Iron Kettle Helm",
        torso: "Reinforced Iron Breastplate",
        arms: "Steel Bracers",
        hands: "Dwarven War Pick",
        legs: "Heavy Greaves",
        feet: "Steel-Toed Boots",
        accessories: "Tower Pavise Shield"
      }
    },
    items: [
      {
        name: "Dwarven War Pick",
        type: "gear",
        system: {
          slot: "hands",
          equipped: true,
          isWeapon: true,
          weaponCategory: "Edge",
          weaponType: "axe_pick",
          damage: "1d8",
          damageType: "Piercing",
          tags: ["kind.gear", "element.piercing", "role.tank"]
        }
      },
      {
        name: "Taunt",
        type: "skill",
        system: {
          rank: 3,
          stat: "cha",
          isAttack: false,
          notes: "Draws hostile attention from nearby monsters toward the mercenary.",
          tags: ["action.interrupt", "kind.skill", "interrupt.redirect_attack", "role.tank", "rule.taunt", "trigger.on_ally_attack", "skillGroup.combat"],
          interrupt: { range: 30, rangeFrom: "attacker" }
        }
      },
      {
        name: "Shield Bash",
        type: "skill",
        system: {
          rank: 2,
          stat: "str",
          checkType: "attack",
          checkNote: "Melee Attack, Str",
          isAttack: true,
          hasDamage: true,
          baseDamage: { dice: '1d6', stat: 'str', damageType: 'Bludgeoning' },
          tags: ["kind.skill", "action.attack", "element.bludgeoning", "skillGroup.strike", "skillGroup.combat"]
        }
      }
    ]
  },
  {
    _id: "dccmerc000000002",
    name: "Zephyr Whisperwind",
    type: "mercenary",
    img: "icons/svg/aura.svg",
    system: {
      abilities: {
        str: { value: 8, unenhanced: 8, mod: 3 },
        int: { value: 18, unenhanced: 18, mod: 4 },
        con: { value: 10, unenhanced: 10, mod: 4 },
        dex: { value: 14, unenhanced: 14, mod: 4 },
        cha: { value: 12, unenhanced: 12, mod: 4 }
      },
      attributes: {
        hp: { value: 40, max: 40 },
        mana: { value: 18, max: 18 },
        evade: { total: 4 },
        dr: { total: 1 },
        speed: { move: 25, step: 10 }
      },
      details: {
        level: 3,
        race: "Elf",
        class: "Arcane Warmage",
        role: "DPS",
        dailyRate: 45,
        contractDays: 0,
        hired: false,
        employerIds: [],
        ownerId: "",
        housedSpaceId: "",
        housingStatus: "available",
        special: "<p>Arcane Bombardment: Unloads devastating explosive magic upon clustered monster hordes.</p>",
        notes: "<p>An eccentric Elven spellcaster who delights in burning dungeon mobs to ashes. Keeps his distance while slinging fire and lightning.</p>",
        floor: "1st Floor"
      },
      gearSlots: {
        head: "Pointed Spellweaver Hood",
        torso: "Silk Magus Robes",
        hands: "Focusing Arcane Staff",
        feet: "Soft Leather Shoes",
        accessories: "Opal Spell Ring"
      }
    },
    items: [
      {
        name: "Arcane Fire Staff",
        type: "gear",
        system: {
          slot: "hands",
          equipped: true,
          isWeapon: true,
          wieldMode: "two_handed",
          weaponCategory: "Bashing",
          damage: "1d6",
          damageType: "Bludgeoning",
          tags: ["kind.gear", "archetype.mage"]
        }
      },
      {
        name: "Fireball",
        type: "spell",
        system: {
          rank: 2,
          manaCost: 4,
          baseDamage: { dice: "3d6", stat: "", damageType: "Fire" },
          delivery: "target",
          area: { hasArea: true, radius: 10, shape: "burst" },
          description: "<p>Launches a roaring projectile of liquid flame that detonates on impact.</p>",
          tags: ["kind.spell", "element.fire", "archetype.mage"]
        }
      },
      {
        name: "Lightning Spark",
        type: "spell",
        system: {
          rank: 1,
          manaCost: 2,
          baseDamage: { dice: "2d4", stat: "", damageType: "Electricity" },
          delivery: "target",
          description: "<p>Fires a jolt of static lightning that jolts and shocks the target.</p>",
          tags: ["kind.spell", "element.electric", "archetype.mage"]
        }
      }
    ]
  },
  {
    _id: "dccmerc000000003",
    name: "Sister Beatrice of the Cleansing Light",
    type: "mercenary",
    img: "icons/magic/light/hand-sparks-glow-yellow.webp",
    system: {
      abilities: {
        str: { value: 12, unenhanced: 12, mod: 4 },
        int: { value: 14, unenhanced: 14, mod: 4 },
        con: { value: 14, unenhanced: 14, mod: 4 },
        dex: { value: 10, unenhanced: 10, mod: 4 },
        cha: { value: 16, unenhanced: 16, mod: 4 }
      },
      attributes: {
        hp: { value: 40, max: 40 },
        mana: { value: 14, max: 14 },
        evade: { total: 4 },
        dr: { total: 2 },
        speed: { move: 20, step: 10 }
      },
      details: {
        level: 3,
        race: "human",
        class: "Battle Medic",
        role: "Healer",
        dailyRate: 40,
        contractDays: 0,
        hired: false,
        employerIds: [],
        ownerId: "",
        housedSpaceId: "",
        housingStatus: "available",
        special: "<p>Radiant Mending: Rapidly restores health bars and purges acid, bleed, and poison debuffs.</p>",
        notes: "<p>A devoted field medic dedicated to keeping crawler parties alive through grueling dungeon descents.</p>",
        floor: "1st Floor"
      },
      gearSlots: {
        head: "Blessed Coif",
        torso: "Chainmail Tunic",
        hands: "Flanged Mace",
        feet: "Sturdy Marching Boots",
        accessories: "Holy Ankh Pendant"
      }
    },
    items: [
      {
        name: "Flanged Steel Mace",
        type: "gear",
        system: {
          slot: "hands",
          equipped: true,
          isWeapon: true,
          weaponCategory: "Bashing",
          damage: "1d8",
          damageType: "Bludgeoning",
          tags: ["kind.gear", "element.bludgeoning"]
        }
      },
      {
        name: "Mend Health Bars",
        type: "spell",
        system: {
          rank: 2,
          manaCost: 3,
          checkType: "none", healing: { hasHealing: true, barsFormula: "2" },
          description: "<p>Channels restorative golden energy to repair damaged HP bars.</p>",
          tags: ["kind.spell", "role.healer"]
        }
      },
      {
        name: "Purify Toxin",
        type: "skill",
        system: {
          rank: 2,
          stat: "cha",
          notes: "Cleanses poison, rot, and bleed debuffs from an ally.",
          tags: ["kind.skill", "role.healer", "skillGroup.utility"]
        }
      }
    ]
  },
  {
    _id: "dccmerc000000004",
    name: "Bonesmith Vane",
    type: "mercenary",
    img: "icons/svg/sword.svg",
    system: {
      abilities: {
        str: { value: 8, unenhanced: 8, mod: 3 },
        int: { value: 14, unenhanced: 14, mod: 4 },
        con: { value: 12, unenhanced: 12, mod: 4 },
        dex: { value: 18, unenhanced: 18, mod: 4 },
        cha: { value: 8, unenhanced: 8, mod: 3 }
      },
      attributes: {
        hp: { value: 40, max: 40 },
        mana: { value: 14, max: 14 },
        evade: { total: 5 },
        dr: { total: 1 },
        speed: { move: 30, step: 10 }
      },
      details: {
        level: 2,
        race: "Goblin",
        size: "small",
        class: "Infiltrator & Trapper",
        role: "Scout",
        dailyRate: 25,
        contractDays: 0,
        hired: false,
        employerIds: [],
        ownerId: "",
        housedSpaceId: "",
        housingStatus: "available",
        special: "<p>Trap Sense & Ambush: Spots hidden floor traps, bypasses locks, and backstabs unsuspecting foes.</p>",
        notes: "<p>A cunning goblin scout who knows dungeon architecture like the back of his clawed hand.</p>",
        floor: "1st Floor"
      },
      gearSlots: {
        head: "Shadow Leather Cowl",
        torso: "Studded Leather Jerkin",
        hands: "Serrated Bone Daggers",
        feet: "Muffled Stalker Boots",
        accessories: "Thieves' Wire Kit"
      }
    },
    items: [
      {
        name: "Serrated Bone Daggers",
        type: "gear",
        system: {
          slot: "hands",
          equipped: true,
          isWeapon: true,
          weaponCategory: "Edge",
          damage: "1d6",
          damageType: "Piercing",
          tags: ["kind.gear", "element.piercing", "role.scout"]
        }
      },
      {
        name: "Disarm Traps",
        type: "skill",
        system: {
          rank: 2,
          stat: "dex",
          notes: "Safely disables pressure plates, tripwires, and arcane runes.",
          tags: ["kind.skill", "role.scout", "skillGroup.utility"]
        }
      },
      {
        name: "Look for Clues",
        type: "skill",
        system: {
          rank: 3,
          stat: "int",
          notes: "Spots hidden dungeon passageways, concealed chests, and lurking ambushes.",
          tags: ["kind.skill", "role.scout", "skillGroup.utility"]
        }
      }
    ]
  },
  {
    _id: "dccmerc000000005",
    name: 'Krag "Skullsplitter"',
    type: "mercenary",
    img: "icons/svg/sword.svg",
    system: {
      abilities: {
        str: { value: 22, unenhanced: 22, mod: 5 },
        int: { value: 6, unenhanced: 6, mod: 3 },
        con: { value: 20, unenhanced: 20, mod: 5 },
        dex: { value: 12, unenhanced: 12, mod: 4 },
        cha: { value: 8, unenhanced: 8, mod: 3 }
      },
      attributes: {
        hp: { value: 50, max: 50 },
        mana: { value: 6, max: 6 },
        evade: { total: 4 },
        dr: { total: 2 },
        speed: { move: 25, step: 10 }
      },
      details: {
        level: 4,
        race: "Orc",
        class: "Berserker",
        role: "DPS",
        dailyRate: 50,
        contractDays: 0,
        hired: false,
        employerIds: [],
        ownerId: "",
        housedSpaceId: "",
        housingStatus: "available",
        special: "<p>Blood Frenzy: Gains bonus damage dice when wounded, swinging greataxes with terrifying ferocity.</p>",
        notes: "<p>A colossal Orc warrior who revels in the chaos of dungeon combat. Does not negotiate; only smashes.</p>",
        floor: "1st Floor"
      },
      gearSlots: {
        head: "Horned War Skull",
        torso: "Hardened Hide Harness",
        hands: "Colossal Greataxe",
        legs: "Fur-Lined Chaps",
        feet: "Spiked Stomping Boots"
      }
    },
    items: [
      {
        name: "Colossal Greataxe",
        type: "gear",
        system: {
          slot: "hands",
          equipped: true,
          isWeapon: true,
          wieldMode: "two_handed",
          weaponCategory: "Edge",
          damage: "2d8",
          damageType: "Slashing",
          tags: ["kind.gear", "element.slashing", "role.dps"]
        }
      },
      {
        name: "Pugilism",
        type: "skill",
        system: {
          rank: 3,
          stat: "str",
          isAttack: true,
          hasDamage: true,
          baseDamage: { dice: '1d6', stat: 'str', damageType: 'Bludgeoning' },
          tags: ["kind.skill", "action.attack", "skillGroup.strike", "skillGroup.combat"]
        }
      }
    ]
  },
  {
    _id: "dccmerc000000006",
    name: "Seraphina Silverthorn",
    type: "mercenary",
    img: "icons/svg/target.svg",
    system: {
      abilities: {
        str: { value: 12, unenhanced: 12, mod: 4 },
        int: { value: 10, unenhanced: 10, mod: 4 },
        con: { value: 12, unenhanced: 12, mod: 4 },
        dex: { value: 18, unenhanced: 18, mod: 4 },
        cha: { value: 10, unenhanced: 10, mod: 4 }
      },
      attributes: {
        hp: { value: 40, max: 40 },
        mana: { value: 10, max: 10 },
        evade: { total: 5 },
        dr: { total: 1 },
        speed: { move: 25, step: 10 }
      },
      details: {
        level: 2,
        race: "human",
        class: "Deadeye Sniper",
        role: "DPS",
        dailyRate: 30,
        contractDays: 0,
        hired: false,
        employerIds: [],
        ownerId: "",
        housedSpaceId: "",
        housingStatus: "available",
        special: "<p>Pinpoint Accuracy: Can shoot weak spots on heavily armored dungeon monsters from extreme range.</p>",
        notes: "<p>A quiet marksman who never wastes an arrow. Seraphina can pick off ranged mob leaders before they sound alarms.</p>",
        floor: "1st Floor"
      },
      gearSlots: {
        head: "Sniper's Archer Cap",
        torso: "Padded Hunter's Jerkin",
        hands: "Recurve Composite Longbow",
        feet: "Light Stalking Boots",
        accessories: "Quiver of Broadheads"
      }
    },
    items: [
      {
        name: "Recurve Composite Longbow",
        type: "gear",
        system: {
          slot: "hands",
          equipped: true,
          isWeapon: true,
          wieldMode: "two_handed",
          weaponCategory: "Ranged",
          damage: "1d10",
          damageType: "Piercing",
          tags: ["kind.gear", "element.piercing", "role.dps"]
        }
      },
      {
        name: "Called Shot",
        type: "skill",
        system: {
          rank: 2,
          stat: "dex",
          notes: "Targets eyes, limbs, or joints to inflict debuffs on ranged hits.",
          tags: ["kind.skill", "role.dps", "skillGroup.combat"]
        }
      }
    ]
  }
];
