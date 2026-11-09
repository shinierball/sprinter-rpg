/**
 * Example Pets & Companions Dataset
 * Pre-configured companions ready for adventuring, mounting, and combat.
 */

// The one pet armor two companions wear: its name is written once, here (the items and the equipment slots read it).
const TITANIUM_CHOMP_CAPS = "Titanium Chomp Caps";

export const COG_PETS = [
  {
    _id: "dccpet0000000001",
    name: "Gary the Velociraptor",
    type: "pet",
    img: "icons/svg/pawprint.svg",
    system: {
      abilities: {
        str: { value: 22, unenhanced: 20, mod: 5 },
        dex: { value: 16, unenhanced: 16, mod: 4 },
        con: { value: 20, unenhanced: 18, mod: 5 },
        int: { value: 12, unenhanced: 12, mod: 4 },
        cha: { value: 14, unenhanced: 14, mod: 4 }
      },
      attributes: {
        hp: { value: 50, max: 50 },
        mana: { value: 12, max: 12 },
        evade: { total: 4 },
        dr: { total: 4 },
        speed: { move: 35, step: 10 },
        size: "large"
      },
      details: {
        level: 15,
        race: "dccrce0000000037",
        creatureType: "Beast",
        isMount: true,
        special: "Earthquake Tremor Stomp: 25% chance on melee hit to cast Earthquake spell",
        notes: "",
        floor: "3rd Floor"
      },
      gearSlots: {
        saddle: "Adamantine War Saddle",
        head: TITANIUM_CHOMP_CAPS
      }
    },
    items: [
      {
        name: "Tremor Stomp",
        type: "skill",
        system: {
          rank: 15,
          stat: "str",
          checkType: "attack",
          checkNote: "Melee Attack, Str",
          isAttack: true,
          hasDamage: true,
          baseDamage: { dice: '2d6', stat: 'str', damageType: 'Bludgeoning' },
          tags: ["kind.skill", "companion.pet", "action.attack", "element.bludgeoning", "skillGroup.strike", "skillGroup.combat"]
        }
      },
      {
        name: "Primal Roar",
        type: "skill",
        system: {
          rank: 10,
          stat: "cha",
          tags: ["kind.skill", "companion.pet", "action.passive", "skillGroup.utility"]
        }
      },
      {
        name: "Raptor Sprint Mount",
        type: "skill",
        system: {
          rank: 15,
          stat: "str",
          tags: ["kind.skill", "companion.pet", "companion.mount", "rule.mount", "role.rider", "skillGroup.movement"]
        }
      },
      {
        name: "Adamantine War Saddle",
        type: "gear",
        system: {
          slot: "saddle",
          equipped: true,
          drBonus: 2,
          grants: [
            { kind: "stat", stat: "str", value: 2 },
            { kind: "stat", stat: "con", value: 2 }
          ],
          tags: ["kind.gear", "companion.mount", "companion.pet", "rule.mount", "role.rider"]
        }
      },
      {
        name: TITANIUM_CHOMP_CAPS,
        type: "gear",
        system: {
          slot: "head",
          equipped: true,
          damageParts: [{ dice: "1d4", type: "Bludgeoning" }],
          grants: [
            { kind: "stat", stat: "con", value: 2 },
            { kind: "stat", stat: "str", value: 1 }
          ],
          tags: ["kind.gear", "companion.pet"]
        }
      }
    ]
  },
  {
    _id: "dccpet0000000002",
    name: "Brenda the Gut Lizard",
    type: "pet",
    img: "icons/svg/pawprint.svg",
    system: {
      abilities: {
        str: { value: 18, unenhanced: 18, mod: 4 },
        dex: { value: 12, unenhanced: 12, mod: 4 },
        con: { value: 24, unenhanced: 20, mod: 5 },
        int: { value: 10, unenhanced: 10, mod: 4 },
        cha: { value: 10, unenhanced: 10, mod: 4 }
      },
      attributes: {
        hp: { value: 50, max: 50 },
        mana: { value: 10, max: 10 },
        evade: { total: 4 },
        dr: { total: 4 },
        speed: { move: 25, step: 10 },
        size: "large"
      },
      details: {
        level: 15,
        race: "gut-lizard",
        creatureType: "Beast",
        isMount: true,
        special: "Caustic Regurgitation & Scavenger Digestion",
        notes: "",
        floor: "3rd Floor"
      },
      gearSlots: {
        saddle: "Reinforced Hauler Pack Saddle"
      }
    },
    items: [
      {
        name: "Caustic Vomit Cannon",
        type: "skill",
        system: {
          rank: 15,
          stat: "con",
          isAttack: true,
          hasDamage: true,
          baseDamage: { dice: '2d8', stat: 'con', damageType: 'Acid' },
          tags: ["kind.skill", "companion.pet", "action.attack", "element.acid", "skillGroup.strike", "skillGroup.combat"]
        }
      },
      {
        name: "Iron Stomach Scavenge",
        type: "skill",
        system: {
          rank: 15,
          stat: "con",
          tags: ["kind.skill", "companion.pet", "action.heal", "skillGroup.utility"]
        }
      },
      {
        name: "Bulldozer Gallop",
        type: "skill",
        system: {
          rank: 15,
          stat: "str",
          tags: ["kind.skill", "companion.pet", "companion.mount", "rule.mount", "role.rider", "skillGroup.movement"]
        }
      },
      {
        name: "Reinforced Hauler Pack Saddle",
        type: "gear",
        system: {
          slot: "saddle",
          equipped: true,
          drBonus: 1,
          grants: [{ kind: "stat", stat: "con", value: 4 }],
          tags: ["kind.gear", "companion.mount", "companion.pet", "rule.mount"]
        }
      }
    ]
  },
  {
    _id: "dccpet0000000003",
    name: "Cleopatra the Royal Cat",
    type: "pet",
    img: "icons/svg/pawprint.svg",
    system: {
      abilities: {
        str: { value: 12, unenhanced: 10, mod: 4 },
        dex: { value: 22, unenhanced: 22, mod: 5 },
        con: { value: 14, unenhanced: 14, mod: 4 },
        int: { value: 14, unenhanced: 14, mod: 4 },
        cha: { value: 20, unenhanced: 20, mod: 5 }
      },
      attributes: {
        hp: { value: 40, max: 40 },
        mana: { value: 14, max: 14 },
        evade: { total: 7 },
        dr: { total: 0 },
        speed: { move: 25, step: 10 },
        size: "small"
      },
      details: {
        level: 4,
        race: "cat",
        creatureType: "Beast",
        isMount: false,
        special: "Nine Lives Instinct & Pounce Shred",
        notes: "<p>A pampered, pristine feline with gleaming yellow eyes and an aura of supreme contempt for dungeon monsters. Equipped with diamond tooth caps that pierce goblin hides like tin foil.</p>",
        floor: "1st Floor"
      },
      gearSlots: {
        head: "Diamond-Tipped Tooth Caps"
      }
    },
    items: [
      {
        name: "Pounce & Shred",
        type: "skill",
        system: {
          rank: 4,
          stat: "dex",
          isAttack: true,
          hasDamage: true,
          baseDamage: { dice: '1d8', stat: 'dex', damageType: 'Slashing' },
          tags: ["kind.skill", "companion.pet", "action.attack", "element.slashing", "skillGroup.strike", "skillGroup.combat"]
        }
      },
      {
        name: "Nine Lives Instinct",
        type: "skill",
        system: {
          rank: 4,
          stat: "cha",
          tags: ["kind.skill", "companion.pet", "action.passive", "skillGroup.utility"]
        }
      },
      {
        name: "Feline Agility",
        type: "skill",
        system: {
          rank: 4,
          stat: "dex",
          tags: ["kind.skill", "companion.pet", "rule.pet-skill", "skillGroup.movement"]
        }
      },
      {
        name: "Diamond-Tipped Tooth Caps",
        type: "gear",
        system: {
          slot: "head",
          equipped: true,
          grants: [{ kind: "stat", stat: "str", value: 2 }],
          damageParts: [{ dice: "1d6", type: "Piercing" }],
          ignoreDR: true,
          tags: ["kind.gear", "companion.pet", "action.armor_piercing"]
        }
      }
    ]
  },
  {
    _id: "dccpet0000000004",
    name: "Barnaby the Alert Dog",
    type: "pet",
    img: "icons/svg/pawprint.svg",
    system: {
      abilities: {
        str: { value: 17, unenhanced: 16, mod: 4 },
        dex: { value: 14, unenhanced: 14, mod: 4 },
        con: { value: 20, unenhanced: 18, mod: 5 },
        int: { value: 12, unenhanced: 12, mod: 4 },
        cha: { value: 16, unenhanced: 16, mod: 4 }
      },
      attributes: {
        hp: { value: 50, max: 50 },
        mana: { value: 12, max: 12 },
        evade: { total: 4 },
        dr: { total: 1 },
        speed: { move: 30, step: 10 },
        size: "small"
      },
      details: {
        level: 5,
        race: "dog",
        creatureType: "Beast",
        isMount: false,
        special: "Pack Alert: Party cannot be ambushed or surprised",
        notes: "<p>Barnaby is the best boy in the dungeon. He never sleeps when danger is near and clamps onto enemies with bone-breaking tenacity.</p>",
        floor: "2nd Floor"
      },
      gearSlots: {
        head: TITANIUM_CHOMP_CAPS
      }
    },
    items: [
      {
        name: "Lockjaw Clamp",
        type: "skill",
        system: {
          rank: 5,
          stat: "str",
          isAttack: true,
          hasDamage: true,
          baseDamage: { dice: '1d8', stat: 'str', damageType: 'Piercing' },
          tags: ["kind.skill", "companion.pet", "action.attack", "element.piercing", "rule.latch", "skillGroup.strike", "skillGroup.combat"]
        }
      },
      {
        name: "Pack Alert",
        type: "skill",
        system: {
          rank: 5,
          stat: "int",
          tags: ["kind.skill", "companion.pet", "action.passive", "skillGroup.utility"]
        }
      },
      {
        name: "Fetch & Bound",
        type: "skill",
        system: {
          rank: 5,
          stat: "dex",
          tags: ["kind.skill", "companion.pet", "skillGroup.movement"]
        }
      },
      {
        name: TITANIUM_CHOMP_CAPS,
        type: "gear",
        system: {
          slot: "head",
          equipped: true,
          damageParts: [{ dice: "1d4", type: "Bludgeoning" }],
          grants: [
            { kind: "stat", stat: "con", value: 2 },
            { kind: "stat", stat: "str", value: 1 }
          ],
          tags: ["kind.gear", "companion.pet"]
        }
      }
    ]
  },
  {
    _id: "dccpet0000000005",
    name: "Zephyr the War Eagle",
    type: "pet",
    img: "icons/svg/wing.svg",
    system: {
      abilities: {
        str: { value: 16, unenhanced: 16, mod: 4 },
        dex: { value: 24, unenhanced: 21, mod: 5 },
        con: { value: 16, unenhanced: 16, mod: 4 },
        int: { value: 18, unenhanced: 18, mod: 4 },
        cha: { value: 12, unenhanced: 12, mod: 4 }
      },
      attributes: {
        hp: { value: 40, max: 40 },
        mana: { value: 18, max: 18 },
        evade: { total: 7 },
        dr: { total: 0 },
        speed: { move: 20, fly: 40, step: 10 },
        size: "large"
      },
      details: {
        level: 15,
        race: "eagle",
        creatureType: "Beast",
        isMount: true,
        special: "Talon Dive-Bomb & Apex Keen Eye",
        notes: "<p>A colossal golden war eagle trained to carry riders aloft through cavernous dungeon ceilings, diving upon mobs at blinding speeds.</p>",
        floor: "3rd Floor"
      },
      gearSlots: {
        saddle: "Silk-Woven Featherweight Saddle"
      }
    },
    items: [
      {
        name: "Talon Dive-Bomb",
        type: "skill",
        system: {
          rank: 15,
          stat: "dex",
          isAttack: true,
          hasDamage: true,
          baseDamage: { dice: '1d10', stat: 'dex', damageType: 'Slashing' },
          tags: ["kind.skill", "companion.pet", "action.attack", "element.slashing", "skillGroup.strike", "skillGroup.combat"]
        }
      },
      {
        name: "Apex Keen Eye",
        type: "skill",
        system: {
          rank: 15,
          stat: "int",
          tags: ["kind.skill", "companion.pet", "action.passive", "skillGroup.utility"]
        }
      },
      {
        name: "Soaring Flight",
        type: "skill",
        system: {
          rank: 15,
          stat: "dex",
          tags: ["kind.skill", "companion.pet", "rule.flight", "rule.mount", "role.rider", "skillGroup.movement"]
        }
      },
      {
        name: "Silk-Woven Featherweight Saddle",
        type: "gear",
        system: {
          slot: "saddle",
          equipped: true,
          defenseModifiers: [{ kind: "evade", value: 2 }],
          grants: [{ kind: "stat", stat: "dex", value: 3 }],
          tags: ["kind.gear", "companion.mount", "companion.pet", "rule.mount"]
        }
      }
    ]
  },
  {
    _id: "dccpet0000000006",
    name: "Ignis the Drake Wyrmling",
    type: "pet",
    img: "icons/svg/wing.svg",
    system: {
      abilities: {
        str: { value: 24, unenhanced: 24, mod: 5 },
        dex: { value: 18, unenhanced: 16, mod: 4 },
        con: { value: 22, unenhanced: 22, mod: 5 },
        int: { value: 20, unenhanced: 18, mod: 5 },
        cha: { value: 18, unenhanced: 18, mod: 4 }
      },
      attributes: {
        hp: { value: 50, max: 50 },
        mana: { value: 20, max: 20 },
        evade: { total: 5 },
        dr: { total: 4 },
        speed: { move: 30, fly: 50, step: 10 },
        size: "large"
      },
      details: {
        level: 15,
        race: "dragon",
        creatureType: "Beast",
        isMount: true,
        special: "Incinerating Breath (2d10 Fire)",
        notes: "<p>A crimson-scaled drake mount who hatched in an incendiary floor trap. Ignis flies into combat with scorching dragon breath and an eye for shiny loot.</p>",
        floor: "4th Floor"
      },
      gearSlots: {
        saddle: "Enchanted Drake Saddle"
      }
    },
    items: [
      {
        name: "Incinerating Breath",
        type: "skill",
        system: {
          rank: 15,
          stat: "con",
          isAttack: true,
          hasDamage: true,
          baseDamage: { dice: '2d10', stat: 'con', damageType: 'Fire' },
          tags: ["kind.skill", "companion.pet", "action.attack", "element.fire", "skillGroup.strike", "skillGroup.combat"]
        }
      },
      {
        name: "Hoarding Greed",
        type: "skill",
        system: {
          identifier: 'dccpet0000000006-dccpet0000i00002',
          rank: 15,
          stat: "int",
          tags: ["kind.skill", "companion.pet", "action.passive", "skillGroup.utility"]
        }
      },
      {
        name: "Draconic Wing Flight",
        type: "skill",
        system: {
          rank: 15,
          stat: "dex",
          tags: ["kind.skill", "companion.pet", "companion.mount", "rule.flight", "rule.mount", "role.rider", "skillGroup.movement"]
        }
      },
      {
        name: "Enchanted Drake Saddle",
        type: "gear",
        system: {
          identifier: 'dccsad0000000005',
          slot: "saddle",
          equipped: true,
          drBonus: 2,
          defenseModifiers: [{ kind: "evade", value: 1 }],
          grants: [
            { kind: "stat", stat: "int", value: 2 },
            { kind: "stat", stat: "dex", value: 2 }
          ],
          tags: ["kind.gear", "companion.mount", "companion.pet", "rule.mount", "role.rider"]
        }
      }
    ]
  },
  {
    "_id": "dccpet0000000007",
    "name": "Bonded Mount",
    "type": "pet",
    "img": "icons/svg/mystery-man.svg",
    "system": {
      "tags": [
        "kind.pet",
        "kind.mount",
        "companion.pet",
        "companion.mount",
        "rule.mount",
        "id.pet.bonded-mount"
      ],
      "attributes": {
        "size": "large",
        "speed": {
          "move": 40,
          "step": 10
        }
      },
      "details": {
        "level": 1,
        "creatureType": "Beast",
        "isMount": true,
        "notes": ""
      }
    }
  },
  {
    "_id": "dccpet0000000008",
    "name": "Friendly Pet",
    "type": "pet",
    "img": "icons/svg/mystery-man.svg",
    "system": {
      "tags": [
        "kind.pet",
        "companion.pet",
        "id.pet.friendly-pet"
      ],
      "details": {
        "level": 1,
        "creatureType": "Beast",
        "isMount": false,
        "notes": "<p>A friendly Pet that joins the Shepherd's Herd.</p>"
      }
    }
  }
];
