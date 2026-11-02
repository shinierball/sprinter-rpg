/**
 * src/sourcery/sync-existing.mjs
 * After an import: offer to bring the world's items, and the items embedded in actors, up to date with the
 * imported text. It reuses the compendium sync (`syncCompendiumItemToWorld`, rule 5), which matches a world or embedded item
 * to its compendium document by `_id` (the `compendiumId` flag) or by the source uuid, never by name.
 * Nothing changes unless the GM confirms. Pure up to the injected `sync`.
 */

/** The Item documents an import wrote, as the compendium documents the sync reads (id, pack, uuid, name, type, system). */
export function importedItemDocuments(set) {
  const out = [];
  for (const pack of set?.packs ?? []) {
    if (pack.documentName !== 'Item') continue;
    for (const doc of pack.docs ?? []) {
      if (!doc || typeof doc !== 'object' || !doc._id || !doc.type) continue;
      out.push({ ...doc, id: doc._id, pack: pack.packId, uuid: `Compendium.${pack.packId}.Item.${doc._id}` });
    }
  }
  return out;
}

/**
 * Run the compendium sync for every imported Item document.
 * @param {object} set the `buildCommitSet` result
 * @param {(doc: object) => Promise<{ actorsUpdated: number, itemsUpdated: number, worldItemsUpdated: number }>} sync
 * @returns {Promise<{ documents: number, actorsUpdated: number, itemsUpdated: number, worldItemsUpdated: number }>}
 */
export async function syncImportedItems(set, sync) {
  const totals = { documents: 0, actorsUpdated: 0, itemsUpdated: 0, worldItemsUpdated: 0 };
  for (const doc of importedItemDocuments(set)) {
    const res = await sync(doc);
    totals.documents++;
    totals.actorsUpdated += res?.actorsUpdated ?? 0;
    totals.itemsUpdated += res?.itemsUpdated ?? 0;
    totals.worldItemsUpdated += res?.worldItemsUpdated ?? 0;
  }
  return totals;
}
