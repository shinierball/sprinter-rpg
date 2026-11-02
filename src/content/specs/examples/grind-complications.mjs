/**
 * src/content/specs/examples/grind-complications.mjs
 * An original example grinding-complications table. The grind reader uses it when no content module registers a table,
 * so the complication roll works out of the box. A module's registered table replaces it.
 */
export const EXAMPLE_GRIND_COMPLICATION_TABLE = Object.freeze({
  id: 'example.grind-complications',
  name: 'Studio Floor Incidents',
  formula: '1d20',
  results: Object.freeze([
    { range: [1, 1], title: 'Unscheduled Guest Star', icon: 'fa-solid fa-skull-crossbones', severity: 'danger', color: '#c0392b', description: 'Something nobody booked walks onto the set mid-session. Start a combat encounter; the GM picks the opposition.' },
    { range: [2, 3], title: 'Cleanup Crew Running Late', icon: 'fa-solid fa-bug', severity: 'warning', color: '#e67e22', description: 'Leftover remains draw scavengers. A small encounter arrives within 1d4 hours unless the party disposes of them.' },
    { range: [4, 5], title: 'Wrong Soundstage', icon: 'fa-solid fa-triangle-exclamation', severity: 'warning', color: '#d35400', description: 'The party takes a wrong turn. The GM calls for a check of their choice; on a failure the floor clock loses 1 extra hour.' },
    { range: [6, 7], title: 'Wardrobe Malfunction', icon: 'fa-solid fa-wrench', severity: 'warning', color: '#7f8c8d', description: 'A strap snaps or an edge dulls. One equipped item needs 15 minutes of repairs before the next fight.' },
    { range: [8, 10], title: 'Rival Contestants', icon: 'fa-solid fa-users-viewfinder', severity: 'info', color: '#2980b9', description: 'Another party crosses your path. Trade, talk, or stare each other down.' },
    { range: [11, 14], title: 'Quiet Day on Set', icon: 'fa-solid fa-shield-halved', severity: 'success', color: '#27ae60', description: 'The hours pass without incident.' },
    { range: [15, 17], title: 'Props Department Leftovers', icon: 'fa-solid fa-coins', severity: 'success', color: '#f39c12', description: 'The party turns up 1d4 pieces of junk worth keeping.' },
    { range: [18, 19], title: 'Helpful Production Assistant', icon: 'fa-solid fa-person-walking-luggage', severity: 'success', color: '#16a085', bonusHours: 1, description: 'A friendly local shares a shortcut. Gain 1 bonus grinding hour.' },
    { range: [20, 20], title: 'Highlight Reel', icon: 'fa-solid fa-box-open', severity: 'celestial', color: '#8e44ad', description: 'The session is spectacular enough to air. The GM may award a loot box.' }
  ])
});
