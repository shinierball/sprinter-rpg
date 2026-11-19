/**
 * src/content/specs/examples/grind-complications.mjs
 * An original example grinding-complications table. The shiny provider (src/content/shiny-content-provider.mjs) registers it
 * as the `grindComplications` of the `shiny` theme; the grind reader also falls back to it when nothing is registered, so
 * the complication roll works out of the box. A module's registered table replaces it.
 */
export const EXAMPLE_GRIND_COMPLICATION_TABLE = Object.freeze({
  id: 'example.grind-complications',
  name: 'Studio Floor Incidents',
  formula: '1d20',
  grind: Object.freeze({ scope: 'floor', floors: Object.freeze([]) }),
  results: Object.freeze([
    { range: [1, 6], title: 'See the Set You Are On', icon: 'fa-solid fa-clapperboard', severity: 'info', color: '#2980b9', effects: [{ kind: 'seeTable' }], description: 'The roll belongs to the set the party is on. Read the same number on the neighborhood table.' },
    { range: [7, 7], title: 'Wardrobe Malfunction', icon: 'fa-solid fa-wrench', severity: 'warning', color: '#7f8c8d', description: 'A strap snaps or an edge dulls. One equipped item needs 15 minutes of repairs before the next fight.' },
    { range: [8, 10], title: 'Rival Contestants', icon: 'fa-solid fa-users-viewfinder', severity: 'info', color: '#2980b9', description: 'Another party crosses your path. Trade, talk, or stare each other down.' },
    { range: [11, 13], title: 'Quiet Day on Set', icon: 'fa-solid fa-shield-halved', severity: 'success', color: '#27ae60', description: 'The hours pass without incident.' },
    { range: [14, 14], title: 'Lost in the Backlot', icon: 'fa-solid fa-map-location-dot', severity: 'warning', color: '#b9770e', effects: [{ kind: 'floorTime', formula: '1d2*10', per: 'percent' }], description: 'The party wanders into the backlot and cannot find the way back to the set. The GM may take 1d2 times 10 percent of the time left on the floor.' },
    { range: [15, 17], title: 'Props Department Leftovers', icon: 'fa-solid fa-coins', severity: 'success', color: '#f39c12', description: 'The party turns up 1d4 pieces of junk worth keeping.' },
    { range: [18, 19], title: 'Helpful Production Assistant', icon: 'fa-solid fa-person-walking-luggage', severity: 'success', color: '#16a085', effects: [{ kind: 'grindHours', formula: '1' }], description: 'A friendly local shares a shortcut. Gain 1 bonus grinding hour.' },
    { range: [20, 20], title: 'Highlight Reel', icon: 'fa-solid fa-box-open', severity: 'celestial', color: '#8e44ad', description: 'The session is spectacular enough to air. The GM may award a loot box.' }
  ])
});
