/**
 * src/content/specs/grind-complications.mjs
 * Bundled grinding complications: one 1d20 table. Registered by the cog provider under the
 * `grindComplications` catalog kind; the engine reads `bonusHours` only, never the title or description.
 */
export const COG_GRIND_COMPLICATION_TABLES = [
  {
    id: 'grind.complications',
    name: 'Grinding Complications',
    formula: '1d20',
    results: [
    {
      range: [1, 1],
      title: 'Boss Scout Ambush',
      icon: 'fa-solid fa-skull-crossbones',
      severity: 'danger',
      color: '#c0392b',
      description: 'A patrol of hostile trackers ambushes the party mid-grind. Immediate combat encounter with Surprise Difficulty check.'
    },
    {
      range: [2, 3],
      title: 'Janitor Mob Infestation',
      icon: 'fa-solid fa-bug',
      severity: 'warning',
      color: '#e67e22',
      description: 'Slaying mobs without incinerating or disposing of the bodies attracts hordes of Janitor Mobs. If left unchecked, they begin a 10-hour cocoon pupation into winged adults.'
    },
    {
      range: [4, 5],
      title: 'Labyrinthine Dead End / Trap',
      icon: 'fa-solid fa-triangle-exclamation',
      severity: 'warning',
      color: '#d35400',
      description: 'The party gets turned around in twisting alleys or steps on a booby-trapped tile. Requires an Unopposed Tracking or Evade check; failure inflicts 1d6 physical damage or adds +1 wasted hour to the floor clock.'
    },
    {
      range: [6, 7],
      title: 'Equipment Wear & Gear Snag',
      icon: 'fa-solid fa-wrench',
      severity: 'warning',
      color: '#7f8c8d',
      description: 'A weapon dulls, armor straps snap, or ammunition is depleted. 1 equipped gear item loses 1 DR or requires 15 minutes of repairs before next combat.'
    },
    {
      range: [8, 10],
      title: 'Rival Crawler Sighting',
      icon: 'fa-solid fa-users-viewfinder',
      severity: 'info',
      color: '#2980b9',
      description: 'The party spots or crosses paths with another crawler squad. The GM can initiate a social confrontation, mutual trade agreement, or tense standoff.'
    },
    {
      range: [11, 14],
      title: 'Clean, Routine Grind',
      icon: 'fa-solid fa-shield-halved',
      severity: 'success',
      color: '#27ae60',
      description: 'Standard, smooth grinding. All allocated hours apply without incident.'
    },
    {
      range: [15, 17],
      title: 'Valuable Scavenged Junk',
      icon: 'fa-solid fa-coins',
      severity: 'success',
      color: '#f39c12',
      description: 'In addition to training hours, the crawlers recover 1d4 units of Misc Junk suitable for Engineering/Crafting or 10–50 copper/silver dungeon coin.'
    },
    {
      range: [18, 19],
      title: 'Wandering Merchant / Helpful Guide',
      icon: 'fa-solid fa-person-walking-luggage',
      severity: 'success',
      color: '#16a085',
      bonusHours: 1,
      description: 'The party encounters a helpful friendly entity, such as a guide. Grants advice allowing +1 bonus grinding hour to allocate to skills or a chance to purchase consumables.'
    },
    {
      range: [20, 20],
      title: 'AI-Approved Carnage (Loot Box Award)',
      icon: 'fa-solid fa-box-open',
      severity: 'celestial',
      color: '#8e44ad',
      description: 'The crawlers dispatch a pack of mobs with such flair, brutality, or comedic timing that the Dungeon AI takes notice. The AI broadcasts an announcement and awards the crawler a Bronze or Silver Loot Box!'
    }
    ]
  }
];
