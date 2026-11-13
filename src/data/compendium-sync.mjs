import { SYSTEM_ID } from '../constants.mjs';
import { contentRegistry } from '../content/registry.mjs';
import { recordedPicks } from '../utils/character/recorded-picks.mjs';
import { readSourceStamp } from '../utils/content-source.mjs';
import { isRedacted, emptiedPaths } from '../sourcery/redacted.mjs';
import { firstScalar } from '../utils/first-scalar.mjs';
import { catalogKindOfItemType } from '../content/registry/catalogs.mjs';
import { RACE_CLASS_TYPES } from '../utils/document-types.mjs';
import { tokenMustBeLinked } from '../documents/actor/token-link.mjs';
/**
 * Sprinter RPG - Compendium Synchronization Engine
 * Handles globally unique item/spell/class/race/buff/debuff idempotence and
 * propagates compendium modifications across all world actors and items.
 */

const structuredCloneSafe = (value) => {
  if (value === undefined || value === null) return value;
  try { return structuredClone(value); } catch (_) { return JSON.parse(JSON.stringify(value)); }
};

/**
 * Checks whether a document belongs to a compendium pack.
 * @param {object} doc
 * @returns {boolean}
 */
function isCompendiumDocument(doc) {
  if (!doc) return false;
  return Boolean(
    doc.pack ||
    doc.compendium ||
    doc.isCompendium ||
    doc.collection?.isCompendium ||
    (typeof doc.uuid === 'string' && doc.uuid.startsWith('Compendium.'))
  );
}

/** The id of the compendium a document (or an `options.pack` value) belongs to, or ''. */
export function compendiumPackId(docOrId) {
  if (typeof docOrId === 'string') return docOrId;
  return docOrId?.pack || docOrId?.collection?.collection || docOrId?.collection?.metadata?.id || '';
}

/**
 * Whether a compendium document comes from a pack the content registry lists: the bundled packs, a content
 * module's packs and the packs a Sourcery import wrote. An edit in any other compendium is not canon content and does not
 * propagate to the world.
 * @param {object|string} docOrPack a compendium document, or a pack id
 * @param {{ getRegisteredPackIds: () => Set<string> }} [registry=contentRegistry]
 * @returns {boolean}
 */
export function isRegisteredCompendiumDocument(docOrPack, registry = contentRegistry) {
  const id = compendiumPackId(docOrPack);
  if (!id) return false;
  return registry.getRegisteredPackIds().has(id);
}

/**
 * The compendium link an embedded copy of `def` carries so a later pack edit finds it: its `_id` as
 * `flags.sprinter-rpg.compendiumId`, and, when `def` is a pack document, its pack uuid as `flags.sprinter-rpg.sourceUuid`
 * and `_stats.compendiumSource`. A catalog entry (no pack) gets the `compendiumId` alone. A world item keeps the
 * `compendiumId` it already carries (its own `_id` is not the pack's), else none.
 * @param {object|null} def a pack document, catalog entry or world item (document or data)
 * @returns {{ flags: object, stats: object }} `flags` merges into `flags['sprinter-rpg']`, `stats` into `_stats`
 */
export function compendiumLinkFor(def) {
  if (!def || typeof def !== 'object') return { flags: {}, stats: {} };
  const uuid = typeof def.uuid === 'string' ? def.uuid : '';
  const fromPack = uuid.startsWith('Compendium.');
  const own = def.flags?.[SYSTEM_ID]?.compendiumId;
  const isWorld = uuid.startsWith('Item.') && !own;
  const id = own || (isWorld ? '' : (def._id || def.id || ''));
  const flags = {};
  const stats = {};
  if (id) flags.compendiumId = id;
  if (fromPack) {
    flags.sourceUuid = uuid;
    stats.compendiumSource = uuid;
  }
  // The source stamp (7.7c) travels with the copy; a copy that already has one keeps it (see `stampCompendiumLink`).
  const source = readSourceStamp(def);
  if (source) flags.source = source;
  return { flags, stats };
}

/** Merges the {@link compendiumLinkFor} link into item creation data (`flags` and `_stats`), in place. */
export function stampCompendiumLink(data, def) {
  const link = compendiumLinkFor(def);
  if (readSourceStamp(data)) delete link.flags.source;
  if (Object.keys(link.flags).length) {
    data.flags = { ...(data.flags || {}), [SYSTEM_ID]: { ...(data.flags?.[SYSTEM_ID] || {}), ...link.flags } };
  }
  if (Object.keys(link.stats).length) data._stats = { ...(data._stats || {}), ...link.stats };
  return data;
}

/**
 * Preserves actor-specific progression and state when syncing a compendium item.
 * @param {object} existingItem - The embedded item currently on the actor
 * @param {object} compendiumSystem - The system data from the compendium
 * @param {string} itemType - Item type (spell, gear, loot, skill, etc.)
 * @returns {object} Merged system data with actor progression preserved
 */
function preserveItemActorState(existingItem, compendiumSystem, itemType) {
  const merged = structuredClone(compendiumSystem || {});
  const existingSystem = existingItem.system || {};

  switch (itemType) {
    case 'spell':
      // Preserve actor-specific spell rank
      if (existingSystem.rank !== undefined) {
        merged.rank = existingSystem.rank;
      }
      break;

    case 'gear':
      // Preserve equipped state, quantity, and current charge value
      if (existingSystem.equipped !== undefined) {
        merged.equipped = existingSystem.equipped;
      }
      if (existingSystem.quantity !== undefined) {
        merged.quantity = existingSystem.quantity;
      }
      if (existingSystem.slot !== undefined && existingSystem.slot !== '') {
        merged.slot = existingSystem.slot;
      }
      if (existingSystem.charges?.value !== undefined) {
        merged.charges = {
          ...(merged.charges || {}),
          value: existingSystem.charges.value
        };
      }
      break;

    case 'loot':
      // Preserve inventory quantity and current charges
      if (existingSystem.quantity !== undefined) {
        merged.quantity = existingSystem.quantity;
      }
      if (existingSystem.charges?.value !== undefined) {
        merged.charges = {
          ...(merged.charges || {}),
          value: existingSystem.charges.value
        };
      }
      break;

    case 'skill':
      // Preserve skill rank and invested training hours
      if (existingSystem.rank !== undefined) {
        merged.rank = existingSystem.rank;
      }
      if (existingSystem.investedHours !== undefined) {
        merged.investedHours = existingSystem.investedHours;
      }
      if (existingSystem.itemBonus !== undefined) {
        merged.itemBonus = existingSystem.itemBonus;
      }
      if (existingSystem.boonBonus !== undefined) {
        merged.boonBonus = existingSystem.boonBonus;
      }
      break;

    case 'buff':
    case 'debuff':
      // Preserve active state or specific duration remaining if present
      if (existingSystem.active !== undefined) {
        merged.active = existingSystem.active;
      }
      break;

    default:
      break;
  }

  return merged;
}

/** An identifier from stored data: an array takes its first entry, a comma string its first part, then trimmed. */
function sanitizeIdentifier(raw) {
  const val = firstScalar(raw);
  return typeof val === 'string' ? val.trim() : '';
}

/**
 * The `flags` update for a synced item. The durable link is `compendiumId` (the pack `_id`, the same in the bundled
 * pack and an import pack), so it is always written. The source uuids (`core.sourceId`, `sourceUuid`) are only filled
 * when missing: rewriting them to the pack of the edited document would point a bundled-pack item at an import pack
 * that can be deleted later, a dead link. The `sourcery.redacted` marker follows the document: a synced doc that is
 * not redacted clears a stale marker (the name is no longer a placeholder); a redacted one keeps it. `sourcery.emptied`
 * is cleared the same way when the compendium document lists no emptied path.
 */
function syncedFlags(target, id, sourceUuid, compendiumItem) {
  const own = target.flags?.[SYSTEM_ID] || {};
  const flags = {
    core: { ...(target.flags?.core || {}), sourceId: target.flags?.core?.sourceId || sourceUuid },
    [SYSTEM_ID]: { ...own, compendiumId: id, sourceUuid: own.sourceUuid || sourceUuid }
  };
  if (own.sourcery?.redacted && !isRedacted(compendiumItem)) {
    // Foundry's `-=key` deletes the stale marker; the rest of the `sourcery` flag is left to the merge
    flags[SYSTEM_ID].sourcery = { ...own.sourcery };
    delete flags[SYSTEM_ID].sourcery.redacted;
    flags[SYSTEM_ID].sourcery['-=redacted'] = null;
  }
  if (own.sourcery?.emptied && !emptiedPaths(compendiumItem).length) {
    // the same for the emptied-paths list: the compendium document no longer lists any, so the world copy drops it
    flags[SYSTEM_ID].sourcery = { ...(flags[SYSTEM_ID].sourcery || own.sourcery) };
    delete flags[SYSTEM_ID].sourcery.emptied;
    flags[SYSTEM_ID].sourcery['-=emptied'] = null;
  }
  return flags;
}

/**
 * Synchronizes an updated compendium item to all world actors and world items.
 * Guarantees that compendium modifications update for every user. An item matches by its `compendiumId` flag (the
 * compendium `_id`), by the source uuid (`flags.core.sourceId`, `flags.sprinter-rpg.sourceUuid`, `_stats.compendiumSource`),
 * never by name (CONTRIBUTING rule 2): a renamed or same-named unrelated item is left alone.
 * @param {object} compendiumItem - The modified compendium item
 * @param {object} [options={}] - Additional sync options (`pack` when the document carries none)
 * @returns {Promise<{ actorsUpdated: number, itemsUpdated: number, worldItemsUpdated: number }>}
 */
export async function syncCompendiumItemToWorld(compendiumItem, options = {}) {
  if (!compendiumItem) return { actorsUpdated: 0, itemsUpdated: 0, worldItemsUpdated: 0 };

  const id = compendiumItem.id || compendiumItem._id;
  const name = compendiumItem.name;
  const type = compendiumItem.type;
  const img = compendiumItem.img;
  const pack = compendiumItem.pack || compendiumItem.collection?.collection || options.pack || '';
  const uuid = compendiumItem.uuid || (pack ? `Compendium.${pack}.${id}` : null);
  const canonicalSourceId = uuid || (pack ? `Compendium.${pack}.${id}` : null);

  let actorsUpdated = 0;
  let itemsUpdated = 0;
  let worldItemsUpdated = 0;

  // The catalog the race/class appliers and the pickers read must hold the edit before any actor is re-applied
  refreshCatalogEntry(compendiumItem);

  // 1. Synchronize to all World Actors
  const actors = Array.from(globalThis.game?.actors || []);
  for (const actor of actors) {
    const actorItems = Array.from(actor.items ?? []);
    const matchingItems = actorItems.filter(item => {
      if (item.type !== type) return false;
      // A transformation's item belongs to its affliction, not to the sync
      if (item.flags?.[SYSTEM_ID]?.transformationOf) return false;

      // Check explicit source references
      const sourceId = item.flags?.core?.sourceId || item.flags?.[SYSTEM_ID]?.sourceUuid;
      const compId = item.flags?.[SYSTEM_ID]?.compendiumId;

      if (canonicalSourceId && sourceId === canonicalSourceId) return true;
      if (id && compId === id) return true;
      if (canonicalSourceId && item._stats?.compendiumSource === canonicalSourceId) return true;

      return false;
    });

    // The picks the crawler made when this race or class was applied, read before the sync overwrites the embedded item
    const appliedFlag = RACE_CLASS_TYPES.includes(type)
      ? actor.getFlag?.(SYSTEM_ID, type === 'race' ? 'appliedRace' : 'appliedClass') : null;
    const appliedItem = appliedFlag?.itemId ? matchingItems.find(item => (item.id || item._id) === appliedFlag.itemId) : null;
    const embeddedBefore = appliedItem ? structuredCloneSafe(appliedItem.system?.toObject?.() ?? appliedItem.system) : null;

    if (matchingItems.length > 0) {
      actorsUpdated++;
      for (const item of matchingItems) {
        const updatedSystem = preserveItemActorState(item, compendiumItem.system, type);
        const updatePayload = {
          name,
          img: img || item.img,
          system: updatedSystem,
          flags: syncedFlags(item, id, canonicalSourceId, compendiumItem)
        };

        if (typeof item.update === 'function') {
          await item.update(updatePayload, { cogAuthorship: false });
        } else if (typeof actor.updateEmbeddedDocuments === 'function') {
          await actor.updateEmbeddedDocuments('Item', [{ _id: item.id || item._id, ...updatePayload }], { cogAuthorship: false });
        }
        itemsUpdated++;
      }
    }

    // A synced race or class is re-applied only to an actor whose applier flag points at one of the matched
    // embedded items, never by the `details.race` / `details.class` text
    if (RACE_CLASS_TYPES.includes(type)) {
      const applied = actor.getFlag?.(SYSTEM_ID, type === 'race' ? 'appliedRace' : 'appliedClass');
      const isApplied = Boolean(applied?.itemId) && matchingItems.some(item => (item.id || item._id) === applied.itemId);
      const apply = type === 'race' ? actor.applyRace : actor.applyClass;
      if (isApplied && typeof apply === 'function') {
        // The appliers resolve an identifier, never a name (names are placeholders before an import, CONTRIBUTING rule 2)
        const identifier = sanitizeIdentifier(compendiumItem.system?.identifier);
        if (identifier) {
          // The recorded picks go back as selections; one that no longer fits the updated item takes the default
          const { COGRaceClassApplier } = await import('./race-class-applier.mjs');
          const picks = recordedPicks(embeddedBefore, compendiumItem, COGRaceClassApplier.detectChoices(compendiumItem));
          await apply.call(actor, identifier, { interactive: false, ...picks });
        } else {
          console.warn(`Sprinter RPG | ${type} "${id}" has no identifier; ${actor.name ?? 'an actor'} was not re-applied`);
        }
      }
    }
  }

  // 2. Synchronize to World Items in game.items
  const worldItems = Array.from(globalThis.game?.items || []);
  for (const wItem of worldItems) {
    if (wItem.type !== type) continue;

    const sourceId = wItem.flags?.core?.sourceId || wItem.flags?.[SYSTEM_ID]?.sourceUuid;
    const compId = wItem.flags?.[SYSTEM_ID]?.compendiumId;
    const isMatch = (canonicalSourceId && sourceId === canonicalSourceId) ||
      (id && compId === id) ||
      (canonicalSourceId && wItem._stats?.compendiumSource === canonicalSourceId);

    if (isMatch) {
      const updatedSystem = structuredClone(compendiumItem.system || {});
      const updatePayload = {
        name,
        img: img || wItem.img,
        system: updatedSystem,
        flags: syncedFlags(wItem, id, canonicalSourceId, compendiumItem)
      };

      if (typeof wItem.update === 'function') {
        await wItem.update(updatePayload, { cogAuthorship: false });
      }
      worldItemsUpdated++;
    }
  }

  return { actorsUpdated, itemsUpdated, worldItemsUpdated };
}

/**
 * Write a pack edit into every view of the content catalog that readers use: `CONFIG.COG[kind]`, `game.cog[kind]`, and the
 * registry catalog (`catalogEntries` falls back to it while the views are empty). The views hold the registry's entry
 * objects, so an entry found in one is updated in place and the others see it; each is still visited for a view that
 * holds its own copy. Runs before the actor loop, so a re-applied race or class is built from the edited entry.
 */
function refreshCatalogEntry(compendiumItem) {
  const id = compendiumItem.id || compendiumItem._id;
  if (!id) return;
  const type = compendiumItem.type;
  const kind = catalogKindOfItemType(type);
  const views = [globalThis.CONFIG?.COG?.[kind], globalThis.game?.cog?.[kind], contentRegistry.getCatalog(kind)];
  for (const view of views) {
    if (!Array.isArray(view)) continue;
    const match = view.find(c => c && (c._id === id || c.id === id));
    if (!match) continue;
    match.name = compendiumItem.name;
    if (compendiumItem.img) match.img = compendiumItem.img;
    match.system = structuredClone(compendiumItem.system || {});
  }
}

/**
 * The `updateItem` handler, the one path from a compendium edit to the world: only the initiating client runs it, and only
 * for a pack the registry lists.
 */
export async function onUpdateItemSync(item, changed, options, userId) {
  if (globalThis.game?.user && userId && userId !== globalThis.game.user.id) return null;
  if ((isCompendiumDocument(item) || options?.pack) && isRegisteredCompendiumDocument(compendiumPackId(item) || options?.pack)) {
    return syncCompendiumItemToWorld(item, { changed, options });
  }
  return null;
}

/**
 * Registers Foundry VTT hooks for automatic compendium item synchronization.
 */
const _hooksWithSync = new WeakSet(); // once per Hooks object
export function registerCompendiumSyncHooks() {
  if (typeof globalThis.Hooks === 'undefined' || _hooksWithSync.has(globalThis.Hooks)) return;
  _hooksWithSync.add(globalThis.Hooks);

  // When any item is updated, check if it's a compendium document and sync
  globalThis.Hooks.on('updateItem', onUpdateItemSync);

  // Guard against unlinking a crawler, pet or mercenary token on scene update
  globalThis.Hooks.on('preUpdateToken', guardLinkAfterUpdate);
}

/** The link guard: decides from the actor the token will have after the update. */
function guardLinkAfterUpdate(tokenDoc, changes) {
  const actor = changes.actorId !== undefined
    ? globalThis.game?.actors?.get?.(changes.actorId)
    : (tokenDoc.actor || globalThis.game?.actors?.get?.(tokenDoc.actorId));
  if (tokenMustBeLinked(actor, changes.actorLink ?? tokenDoc.actorLink)) changes.actorLink = true;
}
