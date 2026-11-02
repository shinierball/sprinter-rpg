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
    id: 'pugilism', slot: 'unarmed', name: 'Pugilism', skillIdentifier: 'pugilism', effectIdentifier: 'iron-punch',
    label: 'Pugilism with Iron Punch Damage Effect (+1d2 base dmg)'
  },
  {
    id: 'foot_soldier', slot: 'unarmed', name: 'Foot Soldier', skillIdentifier: 'foot-soldier', effectIdentifier: 'smush',
    label: 'Foot Soldier with Smush Damage Effect (×2 dmg on ≤20% HP)'
  },
  {
    id: 'noggin_nocker', slot: 'unarmed', name: '', skillIdentifier: 'noggin-nocker', effectIdentifier: 'dccskl0000000020',
    label: ''
  },
  {
    id: 'dccskl0000000015', slot: 'unarmed', name: '', skillIdentifier: 'dccskl0000000015', effectIdentifier: 'toss',
    label: ''
  },
  { id: 'normal-mana-potion', slot: 'potion', name: 'Normal Mana Potion', itemRef: 'dccitm0000000001' }
]);
