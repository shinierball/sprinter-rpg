/**
 * src/content/specs/examples/index.mjs
 * The example content specs: the 3.4b coverage buffs
 * and debuffs plus the matrix examples, split by type. Three packs: `examples-items`, `examples-actors` and
 * `examples-tables`, built by build:packs and declared in system.json in the "Example Content" pack folder. The crawler
 * example is compiled by the tests only (see actors.mjs).
 *
 * This is the collector. `EXAMPLE_SETS` lists every set (sets.mjs metadata plus specs). The 3.4 files stay
 * where they are and register as sets `coverage` and `matrix`. A release set adds `<kind>/<set>.mjs` files (kind in
 * mobs, items, actors, tables, each exporting a frozen `SPECS`), one import and one `RELEASE_FILES` row here. Explicit
 * imports, no filesystem glob: the runtime examples provider imports this module in the browser.
 */
import { COVERAGE_SPECS } from './coverage.mjs';
import { EXAMPLE_EFFECT_SPECS } from './effects.mjs';
import { EXAMPLE_SKILL_SPECS } from './skills.mjs';
import { EXAMPLE_SPELL_SPECS } from './spells.mjs';
import { EXAMPLE_GEAR_SPECS } from './gear.mjs';
import { EXAMPLE_LOOT_SPECS } from './loot.mjs';
import { EXAMPLE_IDENTITY_SPECS } from './identity.mjs';
import { EXAMPLE_ACTOR_SPECS as MATRIX_ACTOR_SPECS } from './actors.mjs';
import { EXAMPLE_TABLE_SPECS as MATRIX_TABLE_SPECS } from './tables.mjs';
import { EXAMPLE_SET_META } from './sets.mjs';
import { stampSpec } from '../../../utils/content-source.mjs';
import { authorshipFor } from '../authorship.mjs';
import { SPECS as attackProfilesMobs } from './mobs/attack-profiles.mjs';
import { SPECS as racingItems } from './items/racing-and-chasing.mjs';
import { SPECS as creatorRowsItems } from './items/creator-rows.mjs';
import { SPECS as plainLabelsItems } from './items/plain-labels.mjs';
import { SPECS as plainLabelsMobs } from './mobs/plain-labels.mjs';
import { SPECS as usedUpItems } from './items/used-up.mjs';
import { SPECS as baseSkillsItems } from './items/base-skills.mjs';
import { SPECS as baseSetItems } from './items/base-set.mjs';
import { SPECS as craftingItems } from './items/crafting.mjs';
import { SPECS as craftingActors } from './actors/crafting.mjs';
import { SPECS as lootBoxesItems } from './items/loot-boxes.mjs';
import { SPECS as lootBoxesTables } from './tables/loot-boxes.mjs';
import { SPECS as vehiclesItems } from './items/vehicles.mjs';
import { SPECS as vehiclesActors } from './actors/vehicles.mjs';
import { SPECS as offlineModeItems } from './items/offline-mode.mjs';
import { SPECS as finalCreditsItems } from './items/final-credits.mjs';
import { SPECS as floorStartsActors } from './actors/floor-starts.mjs';
import { SPECS as contractClausesItems } from './items/contract-clauses.mjs';
import { SPECS as contractClausesMobs } from './mobs/contract-clauses.mjs';
import { SPECS as greenRoomActors } from './actors/green-room.mjs';
import { SPECS as greenRoomItems } from './items/green-room.mjs';
import { SPECS as weaponWorkshopItems } from './items/weapon-workshop.mjs';
import { SPECS as finePrintItems } from './items/fine-print.mjs';
import { SPECS as networkNotesItems } from './items/network-notes.mjs';
import { SPECS as openPlanItems } from './items/open-plan.mjs';
import { SPECS as openPlanActors } from './actors/open-plan.mjs';
import { SPECS as primeTimePantheonItems } from './items/prime-time-pantheon.mjs';
import { SPECS as primeTimePantheonMobs } from './mobs/prime-time-pantheon.mjs';
import { SPECS as technicalDifficultiesItems } from './items/technical-difficulties.mjs';
import { SPECS as technicalDifficultiesMobs } from './mobs/technical-difficulties.mjs';
import { SPECS as racingMobs } from './mobs/racing-and-chasing.mjs';
import { SPECS as racingTables } from './tables/racing-and-chasing.mjs';

export { COVERAGE_SPECS } from './coverage.mjs';
export { EXAMPLE_EFFECT_SPECS } from './effects.mjs';
export { EXAMPLE_SKILL_SPECS } from './skills.mjs';
export { EXAMPLE_SPELL_SPECS } from './spells.mjs';
export { EXAMPLE_GEAR_SPECS } from './gear.mjs';
export { EXAMPLE_LOOT_SPECS } from './loot.mjs';
export { EXAMPLE_IDENTITY_SPECS } from './identity.mjs';

/** Release-set kind files: `{ set, kind, specs }`, one row per kind file. */
const RELEASE_FILES = Object.freeze([
  { set: 'attack-profiles', kind: 'mobs', specs: attackProfilesMobs },
  { set: 'racing-and-chasing', kind: 'items', specs: racingItems },
  { set: 'racing-and-chasing', kind: 'mobs', specs: racingMobs },
  { set: 'racing-and-chasing', kind: 'tables', specs: racingTables },
  { set: 'creator-rows', kind: 'items', specs: creatorRowsItems },
  { set: 'plain-labels', kind: 'items', specs: plainLabelsItems },
  { set: 'plain-labels', kind: 'mobs', specs: plainLabelsMobs },
  { set: 'used-up', kind: 'items', specs: usedUpItems },
  { set: 'base-skills', kind: 'items', specs: baseSkillsItems },
  { set: 'base-set', kind: 'items', specs: baseSetItems },
  { set: 'crafting', kind: 'items', specs: craftingItems },
  { set: 'crafting', kind: 'actors', specs: craftingActors },
  { set: 'loot-boxes', kind: 'items', specs: lootBoxesItems },
  { set: 'loot-boxes', kind: 'tables', specs: lootBoxesTables },
  { set: 'vehicles', kind: 'items', specs: vehiclesItems },
  { set: 'vehicles', kind: 'actors', specs: vehiclesActors },
  { set: 'offline-mode', kind: 'items', specs: offlineModeItems },
  { set: 'final-credits', kind: 'items', specs: finalCreditsItems },
  { set: 'floor-starts', kind: 'actors', specs: floorStartsActors },
  { set: 'contract-clauses', kind: 'items', specs: contractClausesItems },
  { set: 'contract-clauses', kind: 'mobs', specs: contractClausesMobs },
  { set: 'fine-print', kind: 'items', specs: finePrintItems },
  { set: 'network-notes', kind: 'items', specs: networkNotesItems },
  { set: 'open-plan', kind: 'items', specs: openPlanItems },
  { set: 'open-plan', kind: 'actors', specs: openPlanActors },
  { set: 'prime-time-pantheon', kind: 'items', specs: primeTimePantheonItems },
  { set: 'prime-time-pantheon', kind: 'mobs', specs: primeTimePantheonMobs },
  { set: 'green-room', kind: 'items', specs: greenRoomItems },
  { set: 'green-room', kind: 'actors', specs: greenRoomActors },
  { set: 'weapon-workshop', kind: 'items', specs: weaponWorkshopItems },
  { set: 'technical-difficulties', kind: 'items', specs: technicalDifficultiesItems },
  { set: 'technical-difficulties', kind: 'mobs', specs: technicalDifficultiesMobs }
]);

/** Kind order inside a set's `specs`: referenced documents come first. `mobs` are Actors (the examples-actors pack). */
const KIND_ORDER = Object.freeze(['items', 'actors', 'mobs', 'tables']);

/** The 3.4 documents of the two legacy sets, by kind. */
const LEGACY_KINDS = Object.freeze({
  coverage: { items: COVERAGE_SPECS },
  matrix: {
    items: [...EXAMPLE_EFFECT_SPECS, ...EXAMPLE_SKILL_SPECS, ...EXAMPLE_SPELL_SPECS, ...EXAMPLE_GEAR_SPECS, ...EXAMPLE_LOOT_SPECS, ...EXAMPLE_IDENTITY_SPECS],
    actors: MATRIX_ACTOR_SPECS,
    tables: MATRIX_TABLE_SPECS
  }
});

/** The shiny source stamp (7.7c, with the 7.16 authorship: the set's, or the ledger's for a named `_id`) on every spec of a set and on each embedded item without a stamp of its own. The spec files stay as they are. */
function kindsOf(id, authorship) {
  const stamp = { theme: 'shiny', set: id };
  const kinds = { items: [], actors: [], mobs: [], tables: [] };
  for (const [kind, specs] of Object.entries(LEGACY_KINDS[id] ?? {})) kinds[kind] = [...specs];
  for (const file of RELEASE_FILES.filter((f) => f.set === id)) kinds[file.kind].push(...file.specs);
  return Object.freeze(Object.fromEntries(Object.entries(kinds).map(([k, v]) => [k, Object.freeze(v.map((spec) => stampSpec(spec, { ...stamp, authorship: authorshipFor(spec._id, authorship) })))])));
}

/** Every example set: the metadata plus `kinds` (specs by kind) and `specs` (all kinds, in KIND_ORDER). */
export const EXAMPLE_SETS = Object.freeze(EXAMPLE_SET_META.map((meta) => {
  const kinds = kindsOf(meta.id, meta.authorship);
  return Object.freeze({ ...meta, kinds, specs: Object.freeze(KIND_ORDER.flatMap((k) => kinds[k])) });
}));

/** Every example Item spec (the examples-items pack). Referenced documents come before the ones that reference them. */
export const EXAMPLE_ITEM_SPECS = Object.freeze(EXAMPLE_SETS.flatMap((s) => s.kinds.items));

/** Every example Actor spec (the examples-actors pack): each set's actors, then its mobs. */
export const EXAMPLE_ACTOR_SPECS = Object.freeze(EXAMPLE_SETS.flatMap((s) => [...s.kinds.actors, ...s.kinds.mobs]));

/** Every example RollTable spec (the examples-tables pack). */
export const EXAMPLE_TABLE_SPECS = Object.freeze(EXAMPLE_SETS.flatMap((s) => s.kinds.tables));

const PACK_KINDS = Object.freeze({ 'examples-items': ['items'], 'examples-actors': ['actors', 'mobs'], 'examples-tables': ['tables'] });

/**
 * The sets that have documents in an examples pack, for the `build:packs` compendium folders.
 * @param {string} pack examples-items | examples-actors | examples-tables
 * @returns {Array<{ id: string, label: string, release: string|null, sort: number, ids: string[] }>}
 */
export function examplePackSets(pack) {
  const kinds = PACK_KINDS[pack] ?? [];
  const out = [];
  EXAMPLE_SETS.forEach((set, index) => {
    const ids = kinds.flatMap((k) => set.kinds[k]).map((s) => s._id);
    if (ids.length) out.push({ id: set.id, label: set.label, release: set.release, sort: (index + 1) * 100000, ids });
  });
  return out;
}
