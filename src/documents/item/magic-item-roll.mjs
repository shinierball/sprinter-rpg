/**
 * Sprinter RPG - the magic item generator, the table part
 *
 * The only part of the generator that reads tables. It finds the generator's item type table by key
 * (`loadEnchantTable`: world, then the floor table packs, then the imported packs), rolls it and the property table its
 * row points at (`rollEnchantTable`, a Foundry `Roll`), applies the stop rule, and hands the rolls to the pure
 * `magicItemPayload`. The picks inside a property kind use the injected `rng`, so tests are deterministic. GM side: the
 * loot box open engine calls it (7.3c). It never throws and never writes; the caller creates the item and shows the
 * warnings.
 */
import { loadEnchantTable, rollEnchantTable } from './enchant-table.mjs';
import { lootBoxTierDef } from '../../data/loot-box-tiers.mjs';
import { getLootGenerator } from '../../data/rules/loot-generators.mjs';
import { getMagicItemBase, magicItemBasesInOrder } from '../../data/rules/magic-item-bases.mjs';
import { catalogEntries } from '../../content/catalog-lookup.mjs';
import { getCurrentFloor } from '../../utils/floor/current-floor.mjs';
import { craftText } from '../../utils/crafting/craft-text.mjs';
import { firstScalar } from '../../utils/first-scalar.mjs';
import { foundryRng } from '../../utils/rng.mjs';
import {
  magicItemRollCount, magicBaseOf, magicBaseCandidates, pickMagicBase, magicItemPayload
} from '../../utils/crafting/magic-item.mjs';

const text = (v) => {
  const val = firstScalar(v);
  return typeof val === 'string' ? val.trim() : '';
};

/** Values of an array, Map or Foundry collection. */
function listOf(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  if (typeof collection.values === 'function') return Array.from(collection.values());
  return [];
}

/**
 * Load a row's tableRef by uuid, then re-resolve by the loaded table's key so a world copy wins.
 * @param {string} uuid
 * @param {{ sources?: object }} [opts]
 * @returns {Promise<object|null>} a TableSnapshot
 */
export async function followTableRef(uuid, { sources } = {}) {
  const ref = text(uuid);
  if (!ref) return null;
  const loaded = await loadEnchantTable({ uuid: ref }, { sources });
  if (!loaded) return null;
  if (loaded.key) {
    const byKey = await loadEnchantTable({ key: loaded.key }, { sources });
    if (byKey) return byKey;
  }
  return loaded;
}

/** One roll on a snapshot as a Rolled: `{ key, name, total, row }`. */
async function rollOn(snapshot) {
  const rolled = await rollEnchantTable(snapshot);
  return { key: snapshot.key ?? '', name: snapshot.name ?? '', total: rolled.total, row: rolled.row };
}

/** The `ctx` the property kinds read, from the opener and the catalogs. */
function propertyContext(actor, tierDef, { floor, rng }) {
  const ownedSkills = listOf(actor?.items).filter((i) => i?.type === 'skill').map((i) => ({
    identifier: text(i.system?.identifier), name: text(i.name), checkType: text(i.system?.checkType)
  })).filter((s) => s.identifier);
  const floorNumber = Number(floor);
  return {
    tierDef,
    floor: floor !== undefined && floor !== null && Number.isFinite(floorNumber) ? floorNumber : getCurrentFloor(),
    ownedSkills,
    catalog: { skills: catalogEntries('skills'), spells: catalogEntries('spells') },
    damageTypes: globalThis.CONFIG?.COG?.damageTypes ?? [],
    used: { stats: new Set(), skills: new Set() },
    rng
  };
}

async function rollMagicItemUnsafe({ generator, tier }, { actor, sources, rng, floor }) {
  const tierDef = lootBoxTierDef(tier);
  const gen = getLootGenerator(text(generator) || tierDef.generator);
  if (!gen) return { error: 'no-generator' };

  let typeTable = null;
  for (const key of gen.typeTableKeys) {
    typeTable = await loadEnchantTable({ key }, { sources });
    if (typeTable) break;
  }
  if (!typeTable) return { error: 'no-tables' };

  const warnings = [];
  const typeRoll = await rollOn(typeTable);
  if (!typeRoll.row) warnings.push(craftText('COG.MagicItem.Warn.NoRow', { table: typeTable.name || typeTable.key, total: typeRoll.total }));

  const baseId = magicBaseOf(typeRoll.row);
  let baseDef = getMagicItemBase(baseId);
  if (!baseDef) {
    baseDef = magicItemBasesInOrder()[0] ?? null;
    warnings.push(craftText('COG.MagicItem.Warn.UnknownBase', {
      base: baseId || '-', fallback: craftText(baseDef?.blank?.name || 'COG.MagicItem.Base.unknown')
    }));
  }

  const count = magicItemRollCount(tierDef);
  const where = { table: typeTable.name || typeTable.key, total: typeRoll.total };
  let propertyTable = null;
  if (count > 0 && typeRoll.row) {
    if (!typeRoll.row.tableRef) warnings.push(craftText('COG.MagicItem.Warn.NoPropertyTable', where));
    else {
      propertyTable = await followTableRef(typeRoll.row.tableRef, { sources });
      if (!propertyTable) warnings.push(craftText('COG.MagicItem.Warn.PropertyTableMissing', where));
    }
  }

  const propertyRolls = [];
  let unique = null;
  for (let i = 0; propertyTable && i < count; i += 1) {
    const roll = await rollOn(propertyTable);
    if (!roll.row) {
      warnings.push(craftText('COG.MagicItem.Warn.NoRow', { table: propertyTable.name || propertyTable.key, total: roll.total }));
      continue;
    }
    if (roll.row.tableRef) {
      // The unique row: stop, roll its table once, and note how many rolls were missed (the GM's call what they buy).
      const missed = count - i - 1;
      const uniqueTable = await followTableRef(roll.row.tableRef, { sources });
      if (uniqueTable) {
        unique = { ...(await rollOn(uniqueTable)), missed, via: roll };
      } else {
        warnings.push(craftText('COG.MagicItem.Warn.UniqueTableMissing', { table: propertyTable.name || propertyTable.key, total: roll.total }));
        unique = { ...roll, missed };
      }
      break;
    }
    propertyRolls.push(roll);
  }

  const candidates = magicBaseCandidates(baseDef, catalogEntries('items'));
  const base = pickMagicBase(baseDef, candidates, rng);
  const ctx = propertyContext(actor, tierDef, { floor, rng });
  const result = magicItemPayload({ generator: gen.id, tier: tierDef.id, base, typeRoll, propertyRolls, unique }, ctx);
  return { ...result, warnings: [...warnings, ...result.warnings] };
}

/**
 * Roll one magic item. GM side (called from the boxContents.magicItem handler). Never throws: an unexpected failure
 * comes back as `{ error: 'failed' }` with a console warning.
 * @param {{ generator?: string, tier?: string }} spec `generator` '' = the tier's
 * @param {{ actor?: object, sources?: object, rng?: *, floor?: number }} [opts] `rng` is an `rng.mjs` RNG or a
 *   `Math.random`-style function (default: Foundry's uniform source); `floor` defaults to the current floor
 * @returns {Promise<{ data: object, lines: string[], pendingLines: number[], pending: number, warnings: string[] }|{ error: 'no-generator'|'no-tables'|'failed' }>}
 */
export async function rollMagicItem({ generator = '', tier } = {}, { actor = null, sources, rng = foundryRng(), floor } = {}) {
  try {
    return await rollMagicItemUnsafe({ generator, tier }, { actor, sources, rng, floor });
  } catch (err) {
    console.warn('Sprinter RPG | rollMagicItem failed:', err);
    return { error: 'failed' };
  }
}
