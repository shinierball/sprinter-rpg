/**
 * src/content/shiny-content-provider.mjs
 * The Shiny content provider: the one provider of the built-in `shiny` theme. The theme itself is defined by
 * the registry (`_initShinyBaseline`), so it exists with an empty registry.
 *
 * Every example document joins a shiny catalog by its type: skill, spell, buff, debuff, race, class and achievement items
 * and the mob, pet and mercenary actors go to the catalog of that name; every other item type (gear, loot, space upgrade,
 * deity, sponsor) goes to `items`. Crawlers, personal spaces, vehicles, NPCs and tables stay compendium-only. The items
 * compile from the `examples-items` pack specs and the actors from the `examples-actors` entry (with its `buildOptions`),
 * the same specs `build:packs` compiles, so the catalogs and the compendiums cannot drift.
 *
 * Shiny also supplies its own setting data (the sample species and background matrices, the sample story tables, the
 * example creation loadouts and the example grinding table), so a world whose primary theme is shiny never falls through
 * to the rulebook's. The Base Skills and Base Set documents, and the example buffs and debuffs, are also registered as
 * references, so their identifiers resolve under any theme.
 *
 * Nothing registers at import time. cog.mjs calls `installShinyContentHook()` once at load; the tests and build:packs call the
 * functions directly.
 */
import { SYSTEM_ID } from '../constants.mjs';
import { contentRegistry } from './registry.mjs';
import { catalogKindOfItemType, ITEM_TYPE_CATALOGS } from './registry/catalogs.mjs';
import { getPackSpecs } from './specs/index.mjs';
import { EXAMPLE_SET_META } from './specs/examples/sets.mjs';
import { exampleTagDefinitions } from './specs/examples/refs.mjs';
import { EXAMPLE_CREATION_LOADOUTS } from './specs/examples/creation-loadouts.mjs';
import { EXAMPLE_GRIND_COMPLICATION_TABLE } from './specs/examples/grind-complications.mjs';
import { SPECS as BASE_SKILL_SPECS } from './specs/examples/items/base-skills.mjs';
import { SPECS as BASE_SET_SPECS } from './specs/examples/items/base-set.mjs';
import { compilePackSpecs } from '../data/builders/item-payload.mjs';
// Registers the race and class delegates, which compile the Base Set's classes and races (the point-buy compiler is pure).
import '../data/builders/point-buy-payload.mjs';
import { SAMPLE_CRAWLER_SPECIES, SAMPLE_BACKGROUND_TABLES } from '../data/creation-samples.mjs';
import { SETTING_AUTHORSHIP, AUTHORSHIP_LEDGER, authorshipFor } from './specs/authorship.mjs';

export const SHINY_THEME_ID = 'shiny';
export const SHINY_PROVIDER = 'sprinter-rpg-shiny';

/** Actor types that join a catalog; every other actor type stays compendium-only. */
const SHINY_ACTOR_KINDS = Object.freeze({ mob: 'mobs', pet: 'pets', mercenary: 'mercenaries' });

const ITEMS_PACK = `${SYSTEM_ID}.examples-items`;
const ACTORS_PACK = `${SYSTEM_ID}.examples-actors`;
const TABLES_PACK = `${SYSTEM_ID}.examples-tables`;

/** Registries whose tags are registered already. */
const registered = new WeakSet();

/**
 * Register the tags the example documents carry. build:packs and the tests call this before compiling the examples
 * (the builder's tag check must know them). Idempotent per registry.
 * @param {import('./registry.mjs').COGContentRegistry} [registry=contentRegistry]
 */
export function registerShinyTags(registry = contentRegistry) {
  if (!registry || registered.has(registry)) return;
  registered.add(registry);
  for (const tag of exampleTagDefinitions()) registry.registerTag(tag, { priority: 1 });
}

/**
 * The compiled shiny documents by catalog kind (skills, spells, items, buffs, debuffs, races, classes, achievements, mobs,
 * pets, mercenaries), compiled the way `build:packs` compiles them.
 * @returns {Record<string, object[]>}
 */
export function compiledShinyCatalogs() {
  const out = {};
  const push = (kind, doc) => (out[kind] ??= []).push(doc);
  const itemEntry = getPackSpecs('examples-items');
  if (itemEntry) for (const doc of compilePackSpecs(itemEntry, { warnings: [], dataModel: false })) push(catalogKindOfItemType(doc.type), doc);
  const actorEntry = getPackSpecs('examples-actors');
  if (actorEntry) {
    const specs = actorEntry.specs.filter(spec => SHINY_ACTOR_KINDS[spec?.type]);
    for (const doc of compilePackSpecs({ ...actorEntry, specs }, { warnings: [], dataModel: false })) push(SHINY_ACTOR_KINDS[doc.type], doc);
  }
  return out;
}

/**
 * Register the shiny catalogs, packs, setting data, references and tags.
 * @param {import('./registry.mjs').COGContentRegistry} [registry=contentRegistry]
 * @param {Record<string, { authorship: string }>} [ledger=AUTHORSHIP_LEDGER] names a setting kind as `setting:<kind>` (7.16h)
 */
export function registerShinyContent(registry = contentRegistry, ledger = AUTHORSHIP_LEDGER) {
  if (!registry) return;
  registerShinyTags(registry);
  for (const set of EXAMPLE_SET_META) registry.registerSourceSet(SHINY_THEME_ID, set.id, { label: set.label, symbol: set.symbol, release: set.release ?? 'Unreleased' });
  const opts = { theme: SHINY_THEME_ID, priority: 0, provider: SHINY_PROVIDER };
  const catalogs = compiledShinyCatalogs();

  for (const kind of [...Object.values(ITEM_TYPE_CATALOGS), 'items']) {
    registry.registerCatalog(kind, catalogs[kind] ?? [], { ...opts, origin: ITEMS_PACK });
  }
  for (const kind of Object.values(SHINY_ACTOR_KINDS)) {
    registry.registerCatalog(kind, catalogs[kind] ?? [], { ...opts, origin: ACTORS_PACK });
  }

  // Referenceable under every theme: a Base identifier and an example buff resolve whatever the primary theme is.
  const baseIds = new Set([...BASE_SKILL_SPECS, ...BASE_SET_SPECS].map(spec => spec._id));
  const isBase = doc => baseIds.has(doc._id);
  registry.registerReferences('skills', (catalogs.skills ?? []).filter(isBase));
  registry.registerReferences('spells', (catalogs.spells ?? []).filter(isBase));
  registry.registerReferences('classes', (catalogs.classes ?? []).filter(isBase));
  registry.registerReferences('races', (catalogs.races ?? []).filter(isBase));
  registry.registerReferences('buffs', catalogs.buffs ?? []);
  registry.registerReferences('debuffs', catalogs.debuffs ?? []);

  // Packs under categories no manager reads, so the mixed packs never leak into a typed list. The example tables pack is a
  // lookup below the floor tables: `loadEnchantTable` finds the example generator chain by key, and a world table
  // with the same key, an import's `sourcery.*` tables and the floor tables all win over it.
  registry.registerPack('shinyItems', ITEMS_PACK, { label: 'Shiny Items', ...opts });
  registry.registerPack('shinyActors', ACTORS_PACK, { label: 'Shiny Actors', ...opts });
  registry.registerPack('floorTables', TABLES_PACK, { kind: 'kind.rolltable', label: 'Shiny Tables', ...opts });

  // Setting data (creator content): the sample species with its matrices, the sample story tables, the example loadouts
  // and the example grinding table. The grinding table is registered as the same object, so the reader still knows it.
  registry.registerSpecies(SAMPLE_CRAWLER_SPECIES.id, structuredClone(SAMPLE_CRAWLER_SPECIES), { ...opts, authorship: authorshipFor('setting:species', SETTING_AUTHORSHIP.species, ledger) });
  registry.registerBackgroundTables(structuredClone(SAMPLE_BACKGROUND_TABLES), { ...opts, authorship: authorshipFor('setting:backgroundTables', SETTING_AUTHORSHIP.backgroundTables, ledger) });
  registry.registerCatalog('creationLoadouts', EXAMPLE_CREATION_LOADOUTS.map(entry => ({ ...structuredClone(entry), baseline: true })), { ...opts, authorship: authorshipFor('setting:creationLoadouts', SETTING_AUTHORSHIP.creationLoadouts, ledger) });
  registry.registerCatalog('grindComplications', [EXAMPLE_GRIND_COMPLICATION_TABLE], { ...opts, authorship: authorshipFor('setting:grindComplications', SETTING_AUTHORSHIP.grindComplications, ledger) });
}

/** Listen to `sprinter-rpg.registerContent` and register the shiny content. Called once at load by cog.mjs. */
export function installShinyContentHook() {
  globalThis.Hooks?.on?.('sprinter-rpg.registerContent', registry => registerShinyContent(registry));
}
