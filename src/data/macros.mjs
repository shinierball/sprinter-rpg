/**
 * System Macros
 * Available to all players and administrators.
 */

export const COG_MACROS = [
  {
    _id: "dccmacro00000001",
    name: "Character Creator",
    type: "script",
    img: "icons/svg/skull.svg",
    scope: "global",
    command: `// Open the Crawler Induction Terminal (Character Creator)
if (typeof window.cog?.openCrawlerCreator === 'function') {
  window.cog.openCrawlerCreator();
} else if (typeof game.cog?.COGCrawlerCreatorApp !== 'undefined') {
  game.cog.COGCrawlerCreatorApp.open();
} else {
  ui.notifications?.warn('Crawler Creator application is not available.');
}`,
    ownership: {
      default: 2 // Observer: available to all users to view and execute
    },
    flags: {
      "sprinter-rpg": {
        macroKey: "crawler-creator"
      }
    }
  },
  {
    _id: "dccmacro00000002",
    name: "Open Combat Metrics",
    type: "script",
    img: "icons/svg/combat.svg",
    scope: "global",
    command: `// Open Combat Metrics & AI Awards
if (typeof window.cog?.openCombatMetrics === 'function') {
  window.cog.openCombatMetrics();
} else if (typeof game.cog?.COGCombatMetricsApp !== 'undefined') {
  game.cog.COGCombatMetricsApp.open();
} else {
  ui.notifications?.warn('Combat Metrics application is not available.');
}`,
    ownership: {
      default: 2 // Observer: available to all users to view and execute
    },
    flags: {
      "sprinter-rpg": {
        macroKey: "combat-metrics"
      }
    }
  },
  {
    _id: "dccmacro00000003",
    name: "Party Progression and Session Hub",
    type: "script",
    img: "icons/svg/village.svg",
    scope: "global",
    command: `// Open Party Progression & Session Hub
if (typeof window.cog?.openSessionManager === 'function') {
  window.cog.openSessionManager();
} else if (typeof game.cog?.COGSessionManagerApp !== 'undefined') {
  game.cog.COGSessionManagerApp.open();
} else {
  ui.notifications?.warn('Session Manager application is not available.');
}`,
    ownership: {
      default: 2 // Observer: available to all users to view and execute
    },
    flags: {
      "sprinter-rpg": {
        macroKey: "session-manager"
      }
    }
  },
  {
    _id: "dccmacro00000004",
    name: "Start Party Grinding & Downtime",
    type: "script",
    img: "icons/svg/combat.svg",
    scope: "global",
    command: `// Open Party Grinding & Downtime Hub
if (typeof window.cog?.openGrindApp === 'function') {
  window.cog.openGrindApp();
} else if (typeof game.cog?.COGGrindApp !== 'undefined') {
  game.cog.COGGrindApp.open();
} else {
  ui.notifications?.warn('Grinding Hub is not available.');
}`,
    ownership: {
      default: 2
    },
    flags: {
      "sprinter-rpg": {
        macroKey: "grind-hub"
      }
    }
  },
  {
    _id: "dccmacro00000005",
    name: "Class Creator Studio",
    type: "script",
    img: "icons/svg/book.svg",
    scope: "global",
    command: `// Open Custom Class Creator Studio (Class Builder)
if (typeof window.cog?.openClassCreator === 'function') {
  window.cog.openClassCreator();
} else if (typeof game.cog?.COGClassCreatorApp !== 'undefined') {
  new game.cog.COGClassCreatorApp().render({ force: true });
} else if (typeof CONFIG.COG?.COGClassCreatorApp !== 'undefined') {
  new CONFIG.COG.COGClassCreatorApp().render({ force: true });
} else {
  ui.notifications?.warn('Class Creator Studio is not available.');
}`,
    ownership: {
      default: 2 // Observer: available to all users to view and execute
    },
    flags: {
      "sprinter-rpg": {
        macroKey: "class-creator"
      }
    }
  },
  {
    _id: "dccmacro00000006",
    name: "Race Creator Studio",
    type: "script",
    img: "icons/svg/pawprint.svg",
    scope: "global",
    command: `// Open Custom Race Creator Studio (Race Builder)
if (typeof window.cog?.openRaceCreator === 'function') {
  window.cog.openRaceCreator();
} else if (typeof game.cog?.COGRaceCreatorApp !== 'undefined') {
  new game.cog.COGRaceCreatorApp().render({ force: true });
} else if (typeof CONFIG.COG?.COGRaceCreatorApp !== 'undefined') {
  new CONFIG.COG.COGRaceCreatorApp().render({ force: true });
} else {
  ui.notifications?.warn('Race Creator Studio is not available.');
}`,
    ownership: {
      default: 2 // Observer: available to all users to view and execute
    },
    flags: {
      "sprinter-rpg": {
        macroKey: "race-creator"
      }
    }
  }
];
