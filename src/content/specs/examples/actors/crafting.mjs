/**
 * src/content/specs/examples/actors/crafting.mjs
 * Release set "Crafting": the personal space the crafting upgrades go in. `exampleId('cf', 'a', 1)`.
 * It embeds its workbench, its holster and a stash (Suspicious Glitter and some Misc. Junk). Each is a copy of an
 * example in the same release set (`../items/crafting.mjs`, `../items/used-up.mjs`) made without its `_id`, so the pack
 * gives the embedded copy its own and the data is written once.
 * Original text, written for this system.
 */
import { exampleId } from '../ids.mjs';
import { exampleActorUuid } from '../refs.mjs';
import { SPECS as CRAFTING_ITEMS } from '../items/crafting.mjs';
import { SPECS as USED_UP_ITEMS } from '../items/used-up.mjs';

/** An embedded copy of an example item: the same spec, no `_id`. */
function embedded(specs, id) {
  const spec = specs.find((s) => s._id === id);
  if (!spec) throw new Error(`crafting example: no item ${id}`);
  const { _id, ...rest } = structuredClone(spec);
  return rest;
}

export const SPECS = Object.freeze([
  {
    type: 'personal_space',
    _id: exampleId('cf', 'a', 1),
    name: 'The Prop Shop',
    img: 'icons/svg/house.svg',
    owner: { crawlerUuid: exampleActorUuid('contestant-zero'), crawlerName: 'Contestant Zero' },
    rank: 1,
    quests: [],
    outsideFeed: [],
    amenities: 'A folding table, a glue gun, and a smell.',
    notes: 'A room where props are made and nothing is returned. The Prop Shop Workbench and the Hot Glue Holster are installed, and the stash holds Suspicious Glitter and some Misc. Junk. Open the Crafting app from a blueprint.',
    items: [
      embedded(CRAFTING_ITEMS, exampleId('cf', 'i', 1)),
      embedded(CRAFTING_ITEMS, exampleId('cf', 'i', 2)),
      embedded(CRAFTING_ITEMS, exampleId('cf', 'i', 3)),
      embedded(USED_UP_ITEMS, exampleId('us', 'i', 6))
    ]
  }
]);
