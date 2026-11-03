/**
 * src/content/specs/creation-loadouts.mjs
 * The book's Level 1 starter spells, unarmed packages and mana potion.
 * Entries reference bundled catalog documents by identifier or `_id` (looked up once in specs/skills.mjs, spells.mjs and
 * items.mjs); the provider registers them under the `cog` theme as the `creationLoadouts` catalog. The 18 starter
 * weapons are system data (src/data/creation-loadouts.mjs).
 */

// A spell entry carries no name: `loadoutLabel` shows the name of the catalog spell it references.
const spell = (id) => ({ id, slot: 'spell', spellIdentifier: id });

export const COG_CREATION_LOADOUTS = Object.freeze([
  spell('dccspl0000000007'),
  spell('dccspl0000000011'),
  spell('dccspl0000000013'),
  spell('dccspl0000000027'),
  spell('dccspl0000000040'),
  spell('dccspl0000000042'),
  spell('dccspl0000000049'),
  {
    id: 'pugilism', slot: 'unarmed', name: 'Pugilism', skillIdentifier: 'pugilism', effectIdentifier: 'dccskl0000000018',
    label: ''
  },
  {
    id: 'foot_soldier', slot: 'unarmed', name: 'Foot Soldier', skillIdentifier: 'foot-soldier', effectIdentifier: 'dccskl0000000021',
    label: ''
  },
  {
    id: 'dccskl0000000012', slot: 'unarmed', name: '', skillIdentifier: 'dccskl0000000012', effectIdentifier: 'dccskl0000000020',
    label: ''
  },
  {
    id: 'dccskl0000000015', slot: 'unarmed', name: '', skillIdentifier: 'dccskl0000000015', effectIdentifier: 'toss',
    label: ''
  },
  { id: 'normal-mana-potion', slot: 'potion', name: 'Normal Mana Potion', itemRef: 'dccitm0000000001' }
]);
