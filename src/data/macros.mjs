import { readFlag, withFlags } from '../utils/flags.mjs';

/**
 * System Macros
 * Available to all players and administrators.
 */

/** The flags that mark a world macro as one the system ships, by key (never by name). */
const macroFlags = (macroKey) => withFlags({}, { macroKey }).flags;

/** The key a shipped macro is found by, as stored on a world macro or on this module's data (undefined for a GM's own). */
export const macroKeyOf = (macro) => readFlag(macro, 'macroKey');

export const COG_MACROS = [
  {
    _id: "dccmacro00000001",
    name: "Character Creator",
    type: "script",
    img: "icons/svg/skull.svg",
    scope: "global",
    command: `// Open the Crawler Induction Terminal (Character Creator)
if (typeof window.cog?.openCrawlerCreator === 'function') window.cog.openCrawlerCreator();
else ui.notifications?.warn('Crawler Creator application is not available.');`,
    ownership: {
      default: 2 // Observer: available to all users to view and execute
    },
    flags: macroFlags("crawler-creator")
  },
  {
    _id: "dccmacro00000002",
    name: "Open Combat Metrics",
    type: "script",
    img: "icons/svg/combat.svg",
    scope: "global",
    command: `// Open Combat Metrics & AI Awards
if (typeof window.cog?.openCombatMetrics === 'function') window.cog.openCombatMetrics();
else ui.notifications?.warn('Combat Metrics application is not available.');`,
    ownership: {
      default: 2 // Observer: available to all users to view and execute
    },
    flags: macroFlags("combat-metrics")
  },
  {
    _id: "dccmacro00000003",
    name: "Party Progression and Session Hub",
    type: "script",
    img: "icons/svg/village.svg",
    scope: "global",
    command: `// Open Party Progression & Session Hub
if (typeof window.cog?.openSessionManager === 'function') window.cog.openSessionManager();
else ui.notifications?.warn('Session Manager application is not available.');`,
    ownership: {
      default: 2 // Observer: available to all users to view and execute
    },
    flags: macroFlags("session-manager")
  },
  {
    _id: "dccmacro00000004",
    name: "Start Party Grinding & Downtime",
    type: "script",
    img: "icons/svg/combat.svg",
    scope: "global",
    command: `// Open Party Grinding & Downtime Hub
if (typeof window.cog?.openGrindApp === 'function') window.cog.openGrindApp();
else ui.notifications?.warn('Grinding Hub is not available.');`,
    ownership: {
      default: 2
    },
    flags: macroFlags("grind-hub")
  },
  {
    _id: "dccmacro00000005",
    name: "Class Creator Studio",
    type: "script",
    img: "icons/svg/book.svg",
    scope: "global",
    command: `// Open Custom Class Creator Studio (Class Builder)
if (typeof window.cog?.openClassCreator === 'function') window.cog.openClassCreator();
else ui.notifications?.warn('Class Creator Studio is not available.');`,
    ownership: {
      default: 2 // Observer: available to all users to view and execute
    },
    flags: macroFlags("class-creator")
  },
  {
    _id: "dccmacro00000006",
    name: "Race Creator Studio",
    type: "script",
    img: "icons/svg/pawprint.svg",
    scope: "global",
    command: `// Open Custom Race Creator Studio (Race Builder)
if (typeof window.cog?.openRaceCreator === 'function') window.cog.openRaceCreator();
else ui.notifications?.warn('Race Creator Studio is not available.');`,
    ownership: {
      default: 2 // Observer: available to all users to view and execute
    },
    flags: macroFlags("race-creator")
  }
];
