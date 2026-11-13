/**
 * src/content/specs/examples/actors/green-room.mjs
 * Release set "Green Room": the NPC behind the understudy patron (`exampleId('gr', 'a', 1)`). It owns the patron's performance
 * Skill at Rank 10 and a Combat Skill, as copies of the set's two skills made without their `_id` (the pack gives each its
 * own), so a new Bard meets the criteria rows `performance` and `combat` (core rulebook p. 315). The patron links to it by
 * `Actor.<_id>`, which resolves once the examples-actors pack is imported with its ids. Original text, written for this system.
 */
import { exampleId } from '../ids.mjs';
import { SPECS as GREEN_ROOM_ITEMS, COLD_OPEN_IDENTIFIER, MIC_STAND_SWING_IDENTIFIER } from '../items/green-room.mjs';

/** The Rank the understudy holds in the performance Skill (a patron's must be 10 or more, p. 315). */
const PERFORMANCE_RANK = 10;
const COMBAT_RANK = 2;

/** An embedded copy of a set skill: the same spec, no `_id`, at `rank`. */
function embedded(identifier, rank) {
  const spec = GREEN_ROOM_ITEMS.find((s) => s.type === 'skill' && s.system?.identifier === identifier);
  if (!spec) throw new Error(`green room example: no skill ${identifier}`);
  const { _id, ...rest } = structuredClone(spec);
  rest.system.rank = rank;
  return rest;
}

const stat = (value) => ({ value, mod: Math.floor(value / 3) + 1 });

export const SPECS = Object.freeze([
  {
    type: 'npc',
    _id: exampleId('gr', 'a', 1),
    name: 'Wendell Oake',
    img: 'icons/svg/mystery-man.svg',
    system: {
      abilities: { str: stat(6), dex: stat(7), con: stat(5), int: stat(6), cha: stat(12) },
      details: { level: 6, notes: 'Has learned every part in the building. Is in the wings, mouthing the lines.' }
    },
    items: [embedded(COLD_OPEN_IDENTIFIER, PERFORMANCE_RANK), embedded(MIC_STAND_SWING_IDENTIFIER, COMBAT_RANK)]
  }
]);
