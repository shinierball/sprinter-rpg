/**
 * Floor arrival data. A run is the ordered list of arrivals a start floor needs, and
 * an arrival definition is a list of typed steps the Floor Simulator compiler runs. The numbers are rules (Levels,
 * dice, counts); table keys are structural identifiers, not book text. Floors 4 and 5 each build on the Third
 * Floor crawler, not on each other, so the runs are data: `{ 3: [3], 4: [3, 4], 5: [3, 5] }`.
 */
import { parseFloorNumber } from '../utils/floor/floor-number.mjs';

/** The six tutorial experience tables, in index (Table 28) order. */
export const TUTORIAL_EXPERIENCE_TABLES = Object.freeze([
  'floor.experience.crawlers', 'floor.experience.fate', 'floor.experience.mobs',
  'floor.experience.places', 'floor.experience.traps', 'floor.experience.interview'
]);

/** Start floor to the arrivals its crawler needs, in order. Floors 1 and 2 run no arrival. */
export const FLOOR_START_RUNS = Object.freeze({ 1: [], 2: [], 3: [3], 4: [3, 4], 5: [3, 5] });

const CHOSEN_BY_RANK = Object.freeze([{ max: 4, formula: '2d2' }, { min: 5, formula: '1d2' }]);

/** Arrival definitions by the floor the crawler arrives at. Arrival[3] simulates the Tutorial Floors and ends with Race and Class. */
export const FLOOR_ARRIVALS = Object.freeze({
  3: {
    floor: 3, level: 10, creationRankCap: 10,
    steps: [
      { id: 'level', kind: 'level' },
      { id: 'primaryBoost', kind: 'skillBoost', target: 'primary', formula: '2d4' },
      { id: 'otherBoosts', kind: 'skillBoost', target: 'others', count: 9, formula: '1d4' },
      { id: 'experiences', kind: 'experiences', count: 6, index: 'floor.index.tutorial',
        modes: ['variety', 'random', 'custom'], rankFormulas: ['1d4', '1d2'] },
      { id: 'loot', kind: 'startingLoot', table: 'floor.loot.starting', tiers: null,
        slots: ['weapon', 'armor', 'item', 'consumable'], spellSlots: ['weapon', 'armor', 'item'] },
      { id: 'stats', kind: 'stats' },
      { id: 'aiFavor', kind: 'aiFavor', formula: '1d2', byRating: { 1: '1d2', 2: '2d2' }, mode: 'max' },
      { id: 'popularity', kind: 'popularity', multiplier: 2, mode: 'set' },
      { id: 'raceClass', kind: 'raceClass' }
    ]
  },
  4: {
    floor: 4, level: 20, creationRankCap: 10, spellDuplicateSubstitute: true,
    steps: [
      { id: 'level', kind: 'level' },
      { id: 'stats', kind: 'stats' },
      { id: 'experiences', kind: 'experiences', count: 2, index: null, modes: ['custom'], rankFormulas: ['1d4', '1d2'],
        tables: [...TUTORIAL_EXPERIENCE_TABLES, 'floor.experience.floor3'],
        suggestedTables: ['floor.experience.interview', 'floor.experience.floor3'] },
      { id: 'chosenSkills', kind: 'skillBoost', target: 'chosen', count: 6, candidates: 'skillsAndSpells', formulaByRank: CHOSEN_BY_RANK },
      { id: 'popularity', kind: 'popularity', multiplier: 1, mode: 'add' },
      { id: 'loot', kind: 'startingLoot', table: 'floor.loot.starting', reuseRowFrom: 3, tiers: ['bronze', 'silver'] }
    ]
  },
  5: {
    floor: 5, level: 30, creationRankCap: 10, spellDuplicateSubstitute: true,
    steps: [
      { id: 'level', kind: 'level' },
      { id: 'stats', kind: 'stats' },
      { id: 'experiences', kind: 'experiences', count: 4, index: null, modes: ['custom'], rankFormulas: ['1d4', '1d2'],
        tables: [...TUTORIAL_EXPERIENCE_TABLES, 'floor.experience.floor3', 'floor.experience.floor4'],
        suggestedTables: ['floor.experience.interview', 'floor.experience.floor3', 'floor.experience.floor4', null] },
      { id: 'chosenSkills', kind: 'skillBoost', target: 'chosen', count: 8, candidates: 'skillsAndSpells', formulaByRank: CHOSEN_BY_RANK },
      { id: 'popularity', kind: 'popularity', multiplier: 1, mode: 'add' },
      { id: 'loot', kind: 'startingLoot', table: 'floor.loot.starting', reuseRowFrom: 3, tiers: ['gold', 'platinum'] }
    ]
  }
});

/** Floors the crawler creator offers as a start floor. */
export const CREATOR_START_FLOORS = Object.freeze([1, 2, 3, 4, 5]);

const toFloor = (value) => parseFloorNumber(value) || 0;
const plainObject = (v) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length > 0;

/**
 * The arrival definitions: `CONFIG.COG.floorArrivals` when a module or GM supplied some, else the shipped data.
 * @returns {Record<number, object>}
 */
function getFloorArrivals() {
  const custom = globalThis.CONFIG?.COG?.floorArrivals;
  return plainObject(custom) ? custom : FLOOR_ARRIVALS;
}

/**
 * @param {number|string} floor
 * @returns {object|null} The arrival definition for that floor, or null
 */
export function getFloorArrival(floor) {
  return getFloorArrivals()[toFloor(floor)] ?? null;
}

/**
 * The ordered arrival floors a start floor needs (`[]` for Floors 1 and 2 and anything unknown).
 * @param {number|string} startFloor
 * @returns {number[]}
 */
export function runForStartFloor(startFloor) {
  const custom = globalThis.CONFIG?.COG?.floorStartRuns;
  const runs = plainObject(custom) ? custom : FLOOR_START_RUNS;
  const run = runs[toFloor(startFloor)];
  return Array.isArray(run) ? run.map(Number).filter(n => Number.isInteger(n) && n > 0) : [];
}

/**
 * The arrivals a pending run still has to do, in order: the run's arrivals that are not in `done`. A missing,
 * malformed or `complete` run has none.
 * @param {{startFloor?: number|string, done?: number[], complete?: boolean}|null} floorRun
 * @returns {number[]}
 */
export function remainingArrivals(floorRun) {
  if (!floorRun || typeof floorRun !== 'object' || floorRun.complete) return [];
  const done = new Set((Array.isArray(floorRun.done) ? floorRun.done : []).map(Number));
  return runForStartFloor(floorRun.startFloor).filter(n => !done.has(n));
}

/**
 * Starting Level for a start floor: the Level of the last arrival in its run, or 1 for an empty run. Accepts a
 * number, 'Floor 3', '3rd Floor' or junk; an unknown floor falls back to Level 1.
 * @param {unknown} floor
 * @returns {number}
 */
export function startLevelForFloor(floor) {
  const run = runForStartFloor(floor);
  const last = run.length ? getFloorArrival(run[run.length - 1]) : null;
  const level = Math.trunc(Number(last?.level));
  return Number.isFinite(level) && level >= 1 ? level : 1;
}
