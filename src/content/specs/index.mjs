/**
 * src/content/specs/index.mjs
 * `PACK_SPECS`: the single list `build:packs` walks and the runtime content provider compiles. Each entry is `{ pack,
 * documentName, specs, delegate?, normalize? }`.
 *
 * Every bundled dataset is a spec file in this folder (3.32) and compiles through `buildPayload` with normalisation
 * on. Races and classes compile through the point-buy builder with the entry's `system` as an overlay
 * (point-buy-payload.mjs); the others (skills, spells, buffs, items, mobs, pets, mercenaries) are complete payload
 * specs with no budget builder, so `delegate: false`. src/data/<pack>.mjs re-exports each list for the 5.2 clean-up.
 */
import { COG_SKILLS } from './skills.mjs';
import { COG_SPELLS } from './spells.mjs';
import { COG_BUFFS, COG_DEBUFFS } from './buffs.mjs';
import { COG_ITEMS } from './items.mjs';
import { COG_RACES } from './races.mjs';
import { COG_CLASSES } from './classes.mjs';
import { COG_MOBS } from './mobs.mjs';
import { COG_PETS } from './pets.mjs';
import { COG_MERCENARIES } from './mercenaries.mjs';
import { COG_ACHIEVEMENTS } from './achievements.mjs';
// Registers the race and class delegates (the point-buy compiler is pure, no Foundry globals).
import '../../data/builders/point-buy-payload.mjs';
import { FLOOR_TABLE_SPECS } from './floor-tables/index.mjs';
import { EXAMPLE_ITEM_SPECS, EXAMPLE_ACTOR_SPECS, EXAMPLE_TABLE_SPECS, examplePackSets } from './examples/index.mjs';

/** Datasets whose entries carry no `type` of their own. */
const typed = (type, list) => list.map(entry => ({ type, ...entry }));

export const PACK_SPECS = Object.freeze([
  { pack: 'skills', documentName: 'Item', delegate: false, specs: typed('skill', COG_SKILLS) },
  { pack: 'spells', documentName: 'Item', delegate: false, specs: typed('spell', COG_SPELLS) },
  { pack: 'buffs', documentName: 'Item', delegate: false, specs: [...typed('buff', COG_BUFFS), ...typed('debuff', COG_DEBUFFS)] },
  { pack: 'items', documentName: 'Item', delegate: false, specs: COG_ITEMS },
  { pack: 'races', documentName: 'Item', specs: typed('race', COG_RACES) },
  { pack: 'classes', documentName: 'Item', specs: typed('class', COG_CLASSES) },
  { pack: 'mobs', documentName: 'Actor', delegate: false, specs: typed('mob', COG_MOBS) },
  { pack: 'pets', documentName: 'Actor', delegate: false, specs: typed('pet', COG_PETS) },
  { pack: 'mercenaries', documentName: 'Actor', delegate: false, specs: typed('mercenary', COG_MERCENARIES) },
  // Built by build:packs but not declared in system.json: the manager reads the registry catalog.
  { pack: 'achievements', documentName: 'Item', delegate: false, specs: COG_ACHIEVEMENTS },
  { pack: 'floor-tables', documentName: 'RollTable', specs: FLOOR_TABLE_SPECS },
  // The example sets (declared in system.json in the "Example Content" pack folder).
  // `sets`: build:packs writes one compendium folder per set and files the set's documents in it.
  { pack: 'examples-items', documentName: 'Item', specs: EXAMPLE_ITEM_SPECS, sets: examplePackSets('examples-items') },
  { pack: 'examples-actors', documentName: 'Actor', specs: EXAMPLE_ACTOR_SPECS, sets: examplePackSets('examples-actors') },
  { pack: 'examples-tables', documentName: 'RollTable', specs: EXAMPLE_TABLE_SPECS, sets: examplePackSets('examples-tables') }
]);

/** @returns {object|undefined} the entry for a pack name */
export function getPackSpecs(pack) {
  return PACK_SPECS.find(entry => entry.pack === pack);
}
