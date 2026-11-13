/**
 * src/sourcery/canon.mjs
 * What the importer imports into: the canon packs, their Sourcery kinds, the five books that have recipes and the names of
 * the world compendiums the importer owns. Pure, no Foundry globals.
 *
 * The canon documents are the compiled specs of the bundled packs (`compilePackSpecs`, the same compile `build:packs` and
 * the bundled provider use). A redacted spec compiles to a document whose human-text fields are empty; the importer
 * hydrates those from the owner's PDFs and writes the result to world compendiums with the same document shapers the
 * system packs are built with.
 */
import { compilePackSpecs } from '../data/builders/item-payload.mjs';
import { isHiddenId } from '../content/visibility.mjs';

/** Compiled document type -> Sourcery kind (the grammar and field map). A type absent here has no grammar (pets, mercenaries). */
export const KIND_OF_TYPE = Object.freeze({
  skill: 'skill', spell: 'spell', race: 'race', class: 'class', mob: 'mob', gear: 'gear', loot: 'gear',
  buff: 'buff', debuff: 'debuff', achievement: 'achievement', space_upgrade: 'space', deity: 'deity',
  patron: 'patron'
});

/** The books that have committed recipes (`src/content/sourcery/<id>.anchors.json`), in tie-break order. */
export const BOOKS = Object.freeze([
  { id: 'core', label: 'Core' },
  { id: 'toolkit', label: 'Toolkit' },
  { id: 'crawlers', label: 'Crawlers' },
  { id: 'survival', label: 'Survival' },
  { id: 'atlas', label: 'Atlas' }
]);

/** The registry's kind tag of a document kind (`kind.skill`). */
const kindTag = (name) => `kind.${name}`;

/**
 * The canon packs the importer rewrites. `category` and `kind` are what the bundled provider registers the system pack
 * under, so a Sourcery pack of the same category stands in for it (higher priority, same theme).
 */
export const IMPORT_PACKS = Object.freeze([
  { pack: 'skills', documentName: 'Item', category: 'skills', kind: kindTag('skill'), label: 'Skills' },
  { pack: 'spells', documentName: 'Item', category: 'spells', kind: kindTag('spell'), label: 'Spells' },
  { pack: 'buffs', documentName: 'Item', category: 'buffs', kind: kindTag('buff'), label: 'Buffs and Debuffs' },
  { pack: 'items', documentName: 'Item', category: 'items', kind: kindTag('item'), label: 'Items' },
  { pack: 'races', documentName: 'Item', category: 'races', kind: kindTag('race'), label: 'Races' },
  { pack: 'classes', documentName: 'Item', category: 'classes', kind: kindTag('class'), label: 'Classes' },
  { pack: 'mobs', documentName: 'Actor', category: 'mobs', kind: kindTag('mob'), label: 'Mobs' },
  { pack: 'achievements', documentName: 'Item', category: 'achievements', kind: kindTag('achievement'), label: 'Achievements' }
]);

/** The world compendiums holding the imported tables and the per-book table journals. */
export const TABLE_PACK = Object.freeze({ pack: 'tables', documentName: 'RollTable', category: 'sourceryTables', kind: kindTag('rolltable'), label: 'Tables' });
export const JOURNAL_PACK = Object.freeze({ pack: 'journals', documentName: 'JournalEntry', category: 'sourceryJournals', kind: kindTag('journal'), label: 'Table Journals' });

/** The world compendium holding the vehicles built from a book's vehicle table (3.44j). */
export const VEHICLE_PACK = Object.freeze({ pack: 'vehicles', documentName: 'Actor', category: 'sourceryVehicles', kind: kindTag('vehicle'), label: 'Vehicles' });

/** Prefix of every world pack name the importer owns. */
export const WORLD_PACK_PREFIX = 'sourcery-';

/** `sourcery-skills`. */
export const worldPackName = (pack) => `${WORLD_PACK_PREFIX}${pack}`;

/** `world.sourcery-skills`. */
export const worldPackId = (pack) => `world.${worldPackName(pack)}`;

/**
 * Compile the canon documents of the importable packs.
 * @param {object[]} packSpecs `PACK_SPECS`-shaped entries `{ pack, documentName, specs, delegate? }`
 * @returns {{ pack: string, documentName: string, docs: { id: string, type: string, kind: string|null, hidden: boolean, doc: object }[] }[]}
 *   `hidden`: a book document, written by the import only when its entry was found
 *   one entry per importable pack present in `packSpecs`
 */
export function compileCanon(packSpecs) {
  const out = [];
  for (const def of IMPORT_PACKS) {
    const entry = (packSpecs ?? []).find(e => e.pack === def.pack);
    if (!entry) continue;
    const docs = compilePackSpecs(entry, { warnings: [], dataModel: false }).map(doc => ({
      id: doc._id, type: doc.type, kind: KIND_OF_TYPE[doc.type] ?? null, hidden: isHiddenId(doc._id), doc
    }));
    out.push({ pack: def.pack, documentName: def.documentName, docs });
  }
  return out;
}
