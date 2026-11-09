/**
 * Sprinter RPG - Sample Crawler Creation Content
 * Original sample backgrounds and story tables for the crawler creator, so a world with no content theme (the default
 * `shiny`) can still build a crawler: four life stages of backgrounds that each offer three skills, and three story
 * tables (Past Traumas, Loose Ends, Regrets). Each background row names a sample skill by catalog `ref`; the 44 skills
 * (`creation-sample-skills.mjs`) are registered as the `shiny` skill catalog. Written for this system; nothing here comes
 * from a rulebook. A content theme or a Sourcery import registers its own species and tables instead
 * (`shiny-content-provider.mjs`).
 */
import { SAMPLE_SKILLS } from './creation-sample-skills.mjs';

/** A skill a sample background offers, by identifier: its name, stat and catalog `ref` come from the one sample skill (`creation-sample-skills.mjs`). */
const s = (identifier) => {
  const skill = SAMPLE_SKILLS[identifier];
  if (!skill) throw new Error(`No sample skill with identifier "${identifier}"`);
  return { name: skill.name, stat: skill.stat, ref: identifier };
};

export const SAMPLE_BACKGROUND_MATRICES = {
  tier1: [
    { name: 'Mall Rat', skills: [s('haggling'), s('perception'), s('sprinting')] },
    { name: 'Waiting-Room Regular', skills: [s('small-talk'), s('eavesdropping'), s('endurance')] },
    { name: 'Basement Inventor', skills: [s('repair'), s('electronics'), s('scavenging')] },
    { name: 'Hallway Monitor', skills: [s('intimidate'), s('perception'), s('bookkeeping')] },
    { name: 'Backyard Daredevil', skills: [s('climbing'), s('jumping'), s('endurance')] },
    { name: 'Studio Audience Kid', skills: [s('crowd-work'), s('stage-presence'), s('sprinting')] }
  ],
  tier2: [
    { name: 'Night-School Paralegal', skills: [s('investigation'), s('persuasion'), s('bookkeeping')] },
    { name: 'Lifeguard Certificate', skills: [s('swimming'), s('first-aid'), s('perception')] },
    { name: 'Community Theatre', skills: [s('stage-presence'), s('deception'), s('juggling')] },
    { name: 'Junior Varsity Bench', skills: [s('throwing'), s('endurance'), s('wrestling')] },
    { name: 'Scout Troop Dropout', skills: [s('knot-tying'), s('map-reading'), s('survival')] },
    { name: 'Online Tutorial Graduate', skills: [s('electronics'), s('lockpicking'), s('research')] }
  ],
  tier3: [
    { name: 'Contestant Coordinator', skills: [s('crowd-work'), s('negotiation'), s('camera-awareness')] },
    { name: 'Night-Shift Security', skills: [s('perception'), s('intimidate'), s('baton')] },
    { name: 'Line Cook', skills: [s('cooking'), s('knife-work'), s('endurance')] },
    { name: 'Delivery Courier', skills: [s('driving'), s('map-reading'), s('sprinting')] },
    { name: 'Insurance Adjuster', skills: [s('read-people'), s('bookkeeping'), s('persuasion')] },
    { name: 'Moving-Company Lifter', skills: [s('lifting'), s('endurance'), s('rope-work')] }
  ],
  tier4: [
    { name: 'Escape Room Enthusiast', skills: [s('lockpicking'), s('research'), s('puzzle-solving')] },
    { name: 'Competitive Karaoke', skills: [s('stage-presence'), s('endurance'), s('heckler-management')] },
    { name: 'Weekend Birdwatcher', skills: [s('perception'), s('stealth'), s('tracking')] },
    { name: 'Extreme Couponing', skills: [s('haggling'), s('bookkeeping'), s('scavenging')] },
    { name: 'Amateur Parkour', skills: [s('parkour'), s('climbing'), s('jumping')] },
    { name: 'Home Brewing', skills: [s('chemistry'), s('cooking'), s('hold-your-liquor')] }
  ]
};

/** The sample crawler species: no inherent skill, the generic life stages, the sample backgrounds. */
export const SAMPLE_CRAWLER_SPECIES = {
  id: 'crawler',
  label: 'Crawler',
  aiFavor: 0,
  inherentSkill: null,
  tierLabels: { tier1: 'Origin', tier2: 'Training', tier3: 'Profession', tier4: 'Specialty' },
  tierRanks: { tier1: 1, tier2: 1, tier3: 3, tier4: 2 },
  matrices: SAMPLE_BACKGROUND_MATRICES,
  tags: ['species.crawler']
};

const rows = (texts) => texts.map((text, i) => ({ roll: i + 1, text }));

export const SAMPLE_BACKGROUND_TABLES = {
  pastTrauma: {
    key: 'pastTrauma',
    name: 'Sample Past Traumas',
    description: 'Sample story table: something the crawler has not gotten over (1d6).',
    formula: '1d6',
    results: rows([
      'I was eliminated in the first round of a televised spelling bee. The word was "cat."',
      'A sports mascot fell on me from the upper deck. The mascot was fine.',
      'My family moved eleven times before I turned twelve. I never fully unpacked.',
      'I spent nine hours stuck in an elevator with a man selling timeshares.',
      'I watched my best friend win the grand prize with the ticket I gave them.',
      'I was picked last for every team, including the one I organized.'
    ])
  },
  looseEnds: {
    key: 'looseEnds',
    name: 'Sample Loose Ends',
    description: 'Sample story table: something the crawler left unfinished up top (1d6).',
    formula: '1d6',
    results: rows([
      'I left the oven on. I am almost certain I left the oven on.',
      'I was finally going to return a library book that is eleven years overdue.',
      'I was one stamp away from a free sandwich.',
      'I promised my sister I would be at her wedding. It was this Saturday.',
      'I had just paid in full for a twelve-week pottery class.',
      'My houseplants depend on me, and nobody else has a key.'
    ])
  },
  regrets: {
    key: 'regrets',
    name: 'Sample Regrets',
    description: 'Sample story table: something the crawler would take back (1d6).',
    formula: '1d6',
    results: rows([
      'I laughed at the wrong moment during a eulogy and never apologized.',
      'I sold my car to a stranger without mentioning the brakes.',
      'I told everyone I hated reality television. I watched all of it.',
      'I let a friend take the blame for a prank that was entirely my idea.',
      'I never called back the one person who actually listened to me.',
      'The waiter said "enjoy your meal" and I said "you too."'
    ])
  }
};
