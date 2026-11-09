/**
 * Floor arrival document layer: which tables an arrival's steps name. (`snapshotForFloorSim` and `buildFloorSimContext`
 * live in `data/floor-simulator/snapshot.mjs`.) Nothing here writes a document: a Floor 3 to 5 crawler is compiled
 * whole by the Crawler Creator and created once.
 */
import { TUTORIAL_EXPERIENCE_TABLES } from '../../data/floor-arrivals.mjs';
import { LOOT_BRACELET_RACE_TABLE, LOOT_SPELL_TABLE, LOOT_UPGRADE_TABLE } from '../../data/floor-simulator/tables.mjs';

/** Every table key an arrival's steps name (index, tables, suggestedTables, table), once each. */
export function floorTableKeys(arrival) {
  const keys = new Set();
  for (const step of Array.isArray(arrival?.steps) ? arrival.steps : []) {
    for (const k of [step.table, step.spellTable, step.index, ...(Array.isArray(step.tables) ? step.tables : []), ...(Array.isArray(step.suggestedTables) ? step.suggestedTables : [])]) {
      if (typeof k === 'string' && k.trim()) keys.add(k.trim());
    }
    // The Experiences step falls back to the six Tutorial Floor tables when it names none (steps/experiences.mjs).
    if (step.kind === 'experiences' && !(Array.isArray(step.tables) && step.tables.length)) for (const k of TUTORIAL_EXPERIENCE_TABLES) keys.add(k);
    // The loot step rolls its Spell picks on this table unless the step names another (steps/loot.mjs).
    if (step.kind === 'startingLoot' && !(typeof step.spellTable === 'string' && step.spellTable.trim())) keys.add(LOOT_SPELL_TABLE);
    // A Gold or Platinum weapon pick resolves its Scroll of Upgrade on this table (S7b).
    // A Friendship Bracelet's race is rolled on this table when the player does not choose one.
    if (step.kind === 'startingLoot') keys.add(LOOT_BRACELET_RACE_TABLE);
    if (step.kind === 'startingLoot') keys.add(typeof step.upgradeTable === 'string' && step.upgradeTable.trim() ? step.upgradeTable.trim() : LOOT_UPGRADE_TABLE);
  }
  return [...keys];
}
