/**
 * src/content/specs/floor-tables/index.mjs
 * The original example Floor Simulator tables,
 * as `buildPayload('rolltable', spec)` specs for the `floor-tables` pack. Every table key the arrival definitions name
 * has a table here:
 *   floor.index.tutorial (d6) → the six Tutorial Floor tables (d4 each, TUTORIAL_EXPERIENCE_TABLES order);
 *   floor.experience.floor3 and floor.experience.floor4 (d4, the arrival[4]/[5] experience slots);
 *   floor.loot.starting, floor.loot.upgrade and floor.loot.spells (d4 each).
 * The book's tables (names, narratives, Skills per row, upgrade names) ship in the content module, which registers a
 * higher-priority `floorTables` pack with the same keys.
 */
import { EXPERIENCE_TABLE_SPECS } from './experience.mjs';
import { LOOT_TABLE_SPECS } from './loot.mjs';

export { TUTORIAL_TABLE_KEYS } from './experience.mjs';
export { FLOOR_TABLE_IDS } from './refs.mjs';

export const FLOOR_TABLE_SPECS = Object.freeze([...EXPERIENCE_TABLE_SPECS, ...LOOT_TABLE_SPECS]);
