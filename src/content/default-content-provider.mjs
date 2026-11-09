/**
 * src/content/default-content-provider.mjs
 * Default Bundled Content Provider.
 *
 * Seeds the registry with bundled content datasets (catalogs, mercenaries, space types/upgrades,
 * species/creation matrices, background tables, character sheet PDF asset, and canonical packs).
 *
 * Nothing registers at import time. `installBundledContentHook()` (called once from cog.mjs) listens
 * to `sprinter-rpg.registerContent`; everything is registered under the `cog` theme. Every theme is active, so its
 * documents are in the pickers beside the shiny ones; the `primaryTheme` setting decides whose species, backgrounds and
 * other setting data the creators use (the default primary, `shiny`, supplies the sample creation content).
 */

import { SYSTEM_ID } from '../constants.mjs';
import { contentRegistry } from './registry.mjs';
import { isHiddenDoc } from './visibility.mjs';
import { PACK_SPECS } from './specs/index.mjs';
import { COG_GRIND_COMPLICATION_TABLES } from './specs/grind-complications.mjs';
import { COG_POINT_BUILD_ENTRIES } from './specs/point-build.mjs';
import { compilePackSpecs } from '../data/builders/item-payload.mjs';
import { COG_SPACE_TYPES, COG_SPACE_UPGRADES } from '../data/personal-spaces.mjs';
import { COG_SPECIES_DATA } from '../data/crawler-creation.mjs';
import { COG_PERK_TAGS } from '../data/perk-tags.mjs';
import { COG_CREATION_LOADOUTS } from './specs/creation-loadouts.mjs';
import { BOOKS } from '../sourcery/canon.mjs';
import { BUNDLED_SET_ID } from '../utils/content-source.mjs';

/** The badge symbol of each book (7.7c). */
const BOOK_SYMBOLS = Object.freeze({ core: 'CO', toolkit: 'TK', crawlers: 'CW', survival: 'SV', atlas: 'AT' });

/**
 * Registers the bundled descriptive perk tags (3.9a). build:packs and the golden tests call this before compiling,
 * so the tag check knows the vocabulary the races and classes use.
 * @param {import('./registry.mjs').COGContentRegistry} [registry=contentRegistry]
 */
export function registerBundledTags(registry = contentRegistry) {
  for (const tag of COG_PERK_TAGS) registry.registerTag(tag);
}

/**
 * Registers bundled content into the given registry.
 * @param {import('./registry.mjs').COGContentRegistry} [registry=contentRegistry]
 */
export const COG_THEME_ID = 'cog';
const PROVIDER = 'cog-bundled';

/**
 * The compiled documents of one bundled pack: the same specs `build:packs` compiles, so the runtime
 * catalogs and the compendiums cannot drift. A book document is left out: it reaches the catalogs through an import. Warnings are the build's business (`--strict`, the 3.5 test), not init's.
 * @param {string} pack
 * @returns {object[]}
 */
function compiledSpecs(pack) {
  const entry = PACK_SPECS.find(e => e.pack === pack);
  return entry ? compilePackSpecs(entry, { warnings: [], dataModel: false }).filter(doc => !isHiddenDoc(doc)) : [];
}

export function registerBundledCOGContent(registry = contentRegistry) {
  if (!registry) return;

  registry.registerTheme(COG_THEME_ID, {
    label: 'Rulebook Content',
    description: 'Skills, spells, items, species, mercenaries and background tables from the rulebooks you imported.',
    badge: { icon: 'fa-solid fa-book-open', color: '--cog-source-rulebook' }
  }, { priority: 5, provider: PROVIDER });

  // The source sets of the theme (7.7c): the bundled documents, and one per book a Sourcery import fills.
  registry.registerSourceSet(COG_THEME_ID, BUNDLED_SET_ID, { label: 'Bundled', symbol: 'BD', note: 'Bundled with the system' });
  for (const book of BOOKS) registry.registerSourceSet(COG_THEME_ID, book.id, { label: book.label, symbol: BOOK_SYMBOLS[book.id] ?? book.id.slice(0, 2).toUpperCase() });

  const opts = { theme: COG_THEME_ID, priority: 5, provider: PROVIDER };
  // `origin` is the pack a catalog entry lives in, so a uuid is built from the entry's own pack (`getCatalogOrigin`).
  const from = pack => ({ ...opts, origin: `${SYSTEM_ID}.${pack}` });

  // Descriptive tags for the rulebook perks the races and classes carry (3.9a): label plus rules text, no engine reader.
  registerBundledTags(registry);

  // 0. Catalogs
  registry.registerCatalog('skills', compiledSpecs('skills'), from('skills'));
  registry.registerCatalog('spells', compiledSpecs('spells'), from('spells'));
  registry.registerCatalog('items', compiledSpecs('items'), from('items'));
  registry.registerCatalog('races', compiledSpecs('races'), from('races'));
  registry.registerCatalog('classes', compiledSpecs('classes'), from('classes'));
  registry.registerCatalog('mobs', compiledSpecs('mobs'), from('mobs'));
  registry.registerCatalog('pets', compiledSpecs('pets'), from('pets'));
  // Buffs and debuffs share one pack; the catalogs split on the document type. A provider that adds its
  // own buffs registers them with `registerCatalog('buffs' | 'debuffs', ...)`; the examples provider will do so here.
  const conditions = compiledSpecs('buffs');
  registry.registerCatalog('buffs', conditions.filter(doc => doc.type === 'buff'), from('buffs'));
  registry.registerCatalog('debuffs', conditions.filter(doc => doc.type === 'debuff'), from('buffs'));

  // 1. Mercenaries
  registry.registerMercenaries(compiledSpecs('mercenaries'), from('mercenaries'));

  // 2. Personal Space Types & Upgrades
  if (COG_SPACE_TYPES) {
    for (const [tag, typeDef] of Object.entries(COG_SPACE_TYPES)) {
      registry.registerSpaceType(tag, typeDef, opts);
    }
  }
  if (Array.isArray(COG_SPACE_UPGRADES)) {
    for (const upgrade of COG_SPACE_UPGRADES) {
      registry.registerSpaceUpgrade(upgrade.id, upgrade, opts);
    }
  }

  // 3. Playable Species & Background Creation Matrices
  if (COG_SPECIES_DATA) {
    for (const [id, spec] of Object.entries(COG_SPECIES_DATA)) {
      registry.registerSpecies(id, {
        ...spec,
        matrices: {},
        tags: [`species.${id}`]
      }, opts);
    }
  }

  // 4. Background matrices and story tables (Past Traumas, Loose Ends, Regrets) are not bundled: a cog world
  // gets them from the Sourcery import (sourcery-content-provider), a theme from its own provider.

  // 5. No character sheet PDF is bundled: the GM sets their own in the system settings (characterSheetPdfPath), or a
  // module registers one with registerCharacterSheetPdf.

  // 6. Canonical Compendium Packs
  const bundledPacks = [
    { category: 'skills', packId: 'sprinter-rpg.skills', kind: 'kind.skill', label: 'Canonical Skills' },
    { category: 'spells', packId: 'sprinter-rpg.spells', kind: 'kind.spell', label: 'Canonical Spells' },
    { category: 'items', packId: 'sprinter-rpg.items', kind: 'kind.item', label: 'Canonical Items' },
    { category: 'mobs', packId: 'sprinter-rpg.mobs', kind: 'kind.mob', label: 'Canonical Mobs' },
    { category: 'races', packId: 'sprinter-rpg.races', kind: 'kind.race', label: 'Canonical Races' },
    { category: 'classes', packId: 'sprinter-rpg.classes', kind: 'kind.class', label: 'Canonical Classes' },
    { category: 'buffs', packId: 'sprinter-rpg.buffs', kind: 'kind.buff', label: 'Canonical Buffs and Debuffs' },
    { category: 'floorTables', packId: 'sprinter-rpg.floor-tables', kind: 'kind.rolltable', label: 'Floor Tables', theme: 'all' }
  ];
  for (const pack of bundledPacks) {
    registry.registerPack(pack.category, pack.packId, {
      kind: pack.kind,
      label: pack.label,
      ...opts,
      ...(pack.theme ? { theme: pack.theme } : {})
    });
  }
  // The example tables lookup pack below the floor tables is the shiny provider's (shiny-content-provider.mjs).

  // 7. Achievements (3.6a R1)
  registry.registerCatalog('achievements', compiledSpecs('achievements'), opts);

  // 8. Point-build entries (R2)
  registry.registerCatalog('pointBuild', COG_POINT_BUILD_ENTRIES, opts);

  // 9. Creation loadouts (R3): the book's starter spells, unarmed packages and mana potion, by catalog identifier
  registry.registerCatalog('creationLoadouts', structuredClone(COG_CREATION_LOADOUTS), opts);

  // 10. Grinding complications (R4)
  registry.registerCatalog('grindComplications', COG_GRIND_COMPLICATION_TABLES, opts);

}

/**
 * Listens to `sprinter-rpg.registerContent` and registers the bundled content. Call once at load.
 * Errors propagate so a broken dataset is visible rather than silently leaving the registry empty.
 */
export function installBundledContentHook() {
  globalThis.Hooks?.on?.('sprinter-rpg.registerContent', registry => registerBundledCOGContent(registry));
}
