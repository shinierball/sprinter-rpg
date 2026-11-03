/**
 * src/content/specs/floor-tables/experience.mjs
 * The example experience tables: the d6 index
 * over the six Tutorial Floor tables, the six tables themselves (d4 each), and the Third and Fourth Floor tables that
 * arrival[4] and arrival[5] offer. All names, narratives and Skill combinations are original example content in the
 * 3.4 tone; the book's tables ship in the content module.
 *
 * Each row: a narrative, three Skill or Spell options (named or a choice query) and one `*` custom entry.
 */
import {
  FLOOR_TABLE_IDS, floorTableUuid, skill, namedSpell, choice, custom, QUERIES
} from './refs.mjs';

/** The six Tutorial Floor table keys in index order (the same order as TUTORIAL_EXPERIENCE_TABLES, section 4.2). */
export const TUTORIAL_TABLE_KEYS = Object.freeze([
  'floor.experience.crawlers', 'floor.experience.fate', 'floor.experience.mobs',
  'floor.experience.places', 'floor.experience.traps', 'floor.experience.interview'
]);

const TUTORIAL_TABLE_NAMES = Object.freeze({
  'floor.experience.crawlers': 'Fellow Contestants',
  'floor.experience.fate': 'Plot Twists',
  'floor.experience.mobs': 'Monster of the Week',
  'floor.experience.places': 'Off the Studio Map',
  'floor.experience.traps': 'Safety Violations',
  'floor.experience.interview': 'The Couch Segment'
});

const experienceTable = (key, name, description, rows) => ({
  type: 'rolltable',
  _id: FLOOR_TABLE_IDS[key],
  key,
  name,
  formula: '1d4',
  description,
  rows: rows.map((row, i) => ({ roll: i + 1, ...row }))
});

const INDEX = {
  type: 'rolltable',
  _id: FLOOR_TABLE_IDS['floor.index.tutorial'],
  key: 'floor.index.tutorial',
  name: 'Previously, On The Tutorial Floors',
  formula: '1d6',
  description: 'Example index: roll or choose which segment of the Tutorial Floors your crawler remembers.',
  rows: TUTORIAL_TABLE_KEYS.map((key, i) => ({ roll: i + 1, tableRef: floorTableUuid(key), tableName: TUTORIAL_TABLE_NAMES[key] }))
};

const CRAWLERS = experienceTable('floor.experience.crawlers', TUTORIAL_TABLE_NAMES['floor.experience.crawlers'],
  'Example table: people you met on the way down, briefly.', [
    {
      narrative: 'A contestant who used to be a stunt coordinator showed you the safe way to fall down a staircase, then showed you the unsafe way by accident.',
      options: [skill('dccskl0000000047', 'balance', 'Balance'), skill('dccskl0000000052', 'cat-like-reflexes', 'Cat-Like Reflexes'), skill('dccskl0000000065', 'dodge', 'Dodge'), custom('Stunt Double')]
    },
    {
      narrative: 'You split a vending-machine dinner with a retired auctioneer who could price anything by the sound it made when dropped, including you.',
      options: [skill('dccskl0000000063', 'determine-value', 'Determine Value'), skill('dccskl0000000093', 'negotiation', 'Negotiation'), skill('dccskl0000000039', 'acute-ears', 'Acute Ears'), custom('Going Once')]
    },
    {
      narrative: 'A group of contestants needed someone to hold the door, then someone to hold the line. You kept being the someone.',
      options: [skill('dccskl0000000106', 'shield-block', 'Shield Block'), skill('dccskl0000000089', 'leadership', 'Leadership'), choice('skill', QUERIES.weaponSkill, 'Any Weapon Skill'), custom('Door Duty')]
    },
    {
      narrative: 'Another contestant spent a whole night in the break room teaching you to fake a limp, a smile and a sponsor\'s accent. You never learned their real name.',
      options: [skill('dccskl0000000060', 'deception', 'Deception'), skill('dccskl0000000055', 'character-actor', 'Character Actor'), skill('dccskl0000000110', 'streetwise', 'Streetwise'), custom('Understudy')]
    }
  ]);

const FATE = experienceTable('floor.experience.fate', TUTORIAL_TABLE_NAMES['floor.experience.fate'],
  'Example table: things the writers did to you.', [
    {
      narrative: 'A falling stage light pinned your leg for a whole commercial break. Nobody came. You learned to patch yourself up and to keep an eye on the rigging.',
      options: [namedSpell('dccspl0000000015', 'heal', 'Heal'), skill('dccskl0000000095', 'perception', 'Perception'), skill('dccskl0000000077', 'first-aid', 'First Aid'), custom('Rigging Paranoia')]
    },
    {
      narrative: 'The floor plan changed while you were standing on it. You learned to read the new layout from the scorch marks.',
      options: [skill('dccskl0000000051', 'cartography', 'Cartography'), skill('dccskl0000000094', 'pathfinder', 'Pathfinder'), skill('dccskl0000000111', 'survival', 'Survival'), custom('Set Change')]
    },
    {
      narrative: 'A prize wheel landed on a wedge that took your shoes. You walked the rest of the floor barefoot, and very quietly.',
      options: [skill('dccskl0000000109', 'stealth', 'Stealth'), skill('dccskl0000000090', 'light-on-your-feet', 'Light on Your Feet'), skill('dccskl0000000069', 'endurance', 'Endurance'), custom('Hot Floor Hopper')]
    },
    {
      narrative: 'You were handed the wrong envelope and read a stranger\'s spell aloud on live television. It worked. Nobody was more surprised than the stranger.',
      options: [skill('dccskl0000000044', 'arcane', 'Arcane'), choice('spell', QUERIES.attackSpell, 'Any Attack Spell'), skill('dccskl0000000096', 'performance', 'Performance'), custom('Wrong Envelope')]
    }
  ]);

const MOBS = experienceTable('floor.experience.mobs', TUTORIAL_TABLE_NAMES['floor.experience.mobs'],
  'Example table: fights you survived, on camera.', [
    {
      narrative: 'A mob in a mascot costume chased you through three sets. When you finally stopped running, you found out what was inside it.',
      options: [skill('dccskl0000000103', 'running', 'Running'), choice('skill', QUERIES.unarmedSkill, 'Any Unarmed Combat Skill'), skill('dccskl0000000085', 'intimidate', 'Intimidate'), custom('Unmasker')]
    },
    {
      narrative: 'The floor\'s boss had a catchphrase and a health bar the size of a billboard. You learned its rhythm by losing to it twice.',
      options: [skill('dccskl0000000113', 'tactics', 'Tactics'), skill('dccskl0000000045', 'attack-of-opportunity', 'Attack of Opportunity'), choice('skill', QUERIES.weaponSkill, 'Any Weapon Skill'), custom('Catchphrase Counter')]
    },
    {
      narrative: 'A swarm of small, bitey things had nested in the props cupboard. You cleared it with a mop handle and language the censors had to cover.',
      options: [skill('dccskl0000000005', 'improvised-weapons', 'Improvised Weapons'), skill('dccskl0000000111', 'survival', 'Survival'), skill('dccskl0000000117', 'tracking', 'Tracking'), custom('Pest Control')]
    },
    {
      narrative: 'Something with too many eyes watched you from the lighting rig for a whole episode. You learned to watch back, and then to shoot back.',
      options: [skill('dccskl0000000042', 'ambush', 'Ambush'), skill('dccskl0000000082', 'hide-in-shadows', 'Hide in Shadows'), skill('dccskl0000000024', 'crossbow', 'Crossbow'), custom('Rafter Sense')]
    }
  ]);

const PLACES = experienceTable('floor.experience.places', TUTORIAL_TABLE_NAMES['floor.experience.places'],
  'Example table: parts of the dungeon that were not on the tour.', [
    {
      narrative: 'A door marked "Authorised Personnel Only" opened on an archive of cue cards going back centuries. You read until security found you.',
      options: [skill('dccskl0000000092', 'lore', 'Lore'), skill('dccskl0000000050', 'calligraphy', 'Calligraphy'), choice('spell', QUERIES.utilitySpell, 'Any Utility Spell'), custom('Archive Rat')]
    },
    {
      narrative: 'The water tank from a cancelled stunt show was still full, and still stocked. You swam across it anyway.',
      options: [skill('dccskl0000000112', 'swimming', 'Swimming'), skill('dccskl0000000111', 'survival', 'Survival'), choice('skill', QUERIES.movementSkill, 'Any Movement Skill'), custom('Tank Diver')]
    },
    {
      narrative: 'A props warehouse where nothing was labelled and everything glowed slightly. You sorted it by how warm it felt.',
      options: [skill('dccskl0000000104', 'salvage', 'Salvage'), skill('dccskl0000000086', 'investigation', 'Investigation'), skill('dccskl0000000095', 'perception', 'Perception'), custom('Glow Sorter')]
    },
    {
      narrative: 'A kitchen set with a working oven and no audience. You cooked a real meal, and the studio lights dimmed out of respect.',
      options: [skill('dccskl0000000059', 'cooking', 'Cooking'), skill('dccskl0000000069', 'endurance', 'Endurance'), namedSpell('dccspl0000000044', 'torch', 'Torch'), custom('Craft Services')]
    }
  ]);

const TRAPS = experienceTable('floor.experience.traps', TUTORIAL_TABLE_NAMES['floor.experience.traps'],
  'Example table: incidents the safety officer was not told about.', [
    {
      narrative: 'There was a pressure plate under a sticker that said "Stand Here". You stood there. You will not stand there again.',
      options: [skill('dccskl0000000076', 'find-trap', 'Find Trap'), skill('dccskl0000000052', 'cat-like-reflexes', 'Cat-Like Reflexes'), choice('skill', QUERIES.trapSkill, 'Any Trap Skill'), custom('Sticker Skeptic')]
    },
    {
      narrative: 'The confetti cannon was loaded with something that was not confetti. You spent a commercial break learning what it was and how to unload it.',
      options: [skill('dccskl0000000049', 'dccskl0000000049', ''), skill('dccskl0000000083', 'incendiary-device-handling', 'Incendiary Device Handling'), skill('dccskl0000000077', 'first-aid', 'First Aid'), custom('Confetti Forensics')]
    },
    {
      narrative: 'A trapdoor dropped you into the set below in the middle of someone else\'s recording. You climbed out and stayed in character the whole way.',
      options: [skill('dccskl0000000072', 'escape-artist', 'Escape Artist'), skill('dccskl0000000090', 'light-on-your-feet', 'Light on Your Feet'), skill('dccskl0000000055', 'character-actor', 'Character Actor'), custom('Stayed in Character')]
    },
    {
      narrative: 'You rewired a sparking control panel before it could end the show for everyone. The panel has not forgiven you.',
      options: [skill('dccskl0000000100', 'repair', 'Repair'), skill('dccskl0000000078', 'gear-head', 'Gear Head'), namedSpell('dccspl0000000040', 'dccspl0000000040', ''), custom('Panel Whisperer')]
    }
  ]);

const INTERVIEW = experienceTable('floor.experience.interview', TUTORIAL_TABLE_NAMES['floor.experience.interview'],
  'Example table: what happened when the host called you over to the couch.', [
    {
      narrative: 'The host asked about your worst day. You told a story so good the audience forgot to boo.',
      options: [skill('dccskl0000000097', 'persuasion', 'Persuasion'), skill('dccskl0000000055', 'character-actor', 'Character Actor'), skill('dccskl0000000092', 'lore', 'Lore'), custom('Sob Story')]
    },
    {
      narrative: 'A rival contestant was booked on the same couch. You kept smiling while you traded insults the censors had to bleep.',
      options: [skill('dccskl0000000115', 'taunt', 'Taunt'), skill('dccskl0000000061', 'detect-lies', 'Detect Lies'), skill('dccskl0000000064', 'diplomacy', 'Diplomacy'), custom('Bleep Magnet')]
    },
    {
      narrative: 'The host asked you to demonstrate a spell, live, with no rehearsal. You picked one under pressure and the studio still smells of it.',
      options: [namedSpell('dccspl0000000027', 'dccspl0000000027', ''), skill('dccskl0000000089', 'leadership', 'Leadership'), choice('spell', QUERIES.anySpell, 'Any Spell'), custom('Live Demo')]
    },
    {
      narrative: 'Your segment ran long, so the network cut to an advert for a product that does not exist. You were its spokesperson for a week.',
      options: [skill('dccskl0000000093', 'negotiation', 'Negotiation'), skill('dccskl0000000110', 'streetwise', 'Streetwise'), skill('dccskl0000000080', 'good-first-impression', 'Good First Impression'), custom('Spokesface')]
    }
  ]);

const FLOOR3 = experienceTable('floor.experience.floor3', 'Third Floor Highlights',
  'Example table: events on the Third Floor, for crawlers who start on the Fourth or Fifth.', [
    {
      narrative: 'The Third Floor held a talent night. You entered on a dare and came second to a juggling skeleton.',
      options: [skill('dccskl0000000096', 'performance', 'Performance'), skill('dccskl0000000116', 'throwing', 'Throwing'), choice('skill', QUERIES.weaponSkill, 'Any Weapon Skill'), custom('Runner-Up')]
    },
    {
      narrative: 'You were hired as a temporary guide for a tour group of very lost contestants. You lost only two of them.',
      options: [skill('dccskl0000000094', 'pathfinder', 'Pathfinder'), skill('dccskl0000000089', 'leadership', 'Leadership'), skill('dccskl0000000077', 'first-aid', 'First Aid'), custom('Tour Guide Voice')]
    },
    {
      narrative: 'A mob ambushed you in a lift between levels. The lift music never stopped, so neither did you.',
      options: [skill('dccskl0000000013', 'pugilism', 'Pugilism'), skill('dccskl0000000065', 'dodge', 'Dodge'), skill('dccskl0000000069', 'endurance', 'Endurance'), custom('Lift Fighter')]
    },
    {
      narrative: 'A sponsor sent you a crate of "experimental" supplies with a waiver taped to the lid. The crate asked you to sign in blood. You did.',
      options: [skill('dccskl0000000041', 'alchemy', 'Alchemy'), skill('dccskl0000000063', 'determine-value', 'Determine Value'), choice('spell', QUERIES.attackSpell, 'Any Attack Spell'), custom('Waiver Signer')]
    }
  ]);

const FLOOR4 = experienceTable('floor.experience.floor4', 'Fourth Floor Highlights',
  'Example table: events on the Fourth Floor, for crawlers who start on the Fifth.', [
    {
      narrative: 'A floor-wide scavenger hunt came with a rulebook nobody had read. You read it. That was the whole trick.',
      options: [skill('dccskl0000000086', 'investigation', 'Investigation'), skill('dccskl0000000051', 'cartography', 'Cartography'), skill('dccskl0000000075', 'find-crawler', 'Find Crawler'), custom('Fine Print')]
    },
    {
      narrative: 'You held a bridge against a parade of mobs while the audience voted on whether you would make it. The vote was close.',
      options: [skill('dccskl0000000106', 'shield-block', 'Shield Block'), skill('dccskl0000000119', 'zone-of-control', 'Zone of Control'), choice('skill', QUERIES.weaponSkill, 'Any Weapon Skill'), custom('Audience Favourite')]
    },
    {
      narrative: 'The studio caught fire. You got everyone out and learned which of the exits were only painted on.',
      options: [skill('dccskl0000000103', 'running', 'Running'), skill('dccskl0000000077', 'first-aid', 'First Aid'), namedSpell('dccspl0000000017', 'heal-others', 'Heal Others'), custom('Fire Marshal')]
    },
    {
      narrative: 'You spent a long night fixing the scenery so the show could go on, and found out the scenery was holding up the ceiling.',
      options: [skill('dccskl0000000070', 'engineering', 'Engineering'), skill('dccskl0000000069', 'endurance', 'Endurance'), skill('dccskl0000000074', 'fabricate', 'Fabricate'), custom('Load-Bearing')]
    }
  ]);

export const EXPERIENCE_TABLE_SPECS = Object.freeze([INDEX, CRAWLERS, FATE, MOBS, PLACES, TRAPS, INTERVIEW, FLOOR3, FLOOR4]);
