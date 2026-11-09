/**
 * src/content/specs/examples/crawler-build.mjs
 * What an example crawler with a `floorStart` needs that a pack build does not have: the floor tables its answers read
 * and the Race and Class it takes. `build:packs` registers no content, so both come from the example specs themselves,
 * compiled the way their own packs compile them. `exampleCrawlerBuildOptions(spec)` is the `buildOptions` hook of the
 * `examples-actors` pack entry (and of any test that builds an example crawler).
 */
import '../../../data/builders/point-buy-payload.mjs'; // registers the race and class delegates (pure)
import { buildPayload } from '../../../data/builders/item-payload.mjs';
import { tableSnapshotFromRollTable } from '../../../data/floor-simulator/tables.mjs';
import { FLOOR_TABLE_SPECS } from '../floor-tables/index.mjs';
import { EXAMPLE_SETS } from './index.mjs';

/** The Base Set's item specs as the set collector stamps them, so a Race or Class copy carries the stamp. */
const baseSetSpecs = () => EXAMPLE_SETS.find((set) => set.id === 'base-set')?.kinds.items ?? [];

let tables = null;
let definitions = null;

/** The shipped floor tables as snapshots by key, built once. */
export function exampleFloorTables() {
  if (!tables) {
    tables = Object.fromEntries(FLOOR_TABLE_SPECS.map((spec) => {
      const snapshot = tableSnapshotFromRollTable(buildPayload('rolltable', structuredClone(spec), { warnings: [] }));
      return [snapshot.key, snapshot];
    }));
  }
  return tables;
}

/** The example Race and Class definitions, found by `_id` or `system.identifier`. */
export function exampleRaceClassDefinitions() {
  if (!definitions) {
    const compile = (type) => baseSetSpecs().filter((spec) => spec.type === type)
      .map((spec) => buildPayload(type, structuredClone(spec), { warnings: [] }));
    const finder = (docs) => (ref) => docs.find((doc) => doc._id === ref || (doc.system?.identifier && doc.system.identifier === ref)) ?? null;
    definitions = { race: finder(compile('race')), class: finder(compile('class')) };
  }
  return definitions;
}

/** The extra `buildPayload` options for one example spec: floor tables and definitions for a crawler, nothing else. */
export function exampleCrawlerBuildOptions(spec) {
  if (spec?.type !== 'crawler' || !spec.floorStart) return {};
  return { tables: exampleFloorTables(), definitions: exampleRaceClassDefinitions() };
}
