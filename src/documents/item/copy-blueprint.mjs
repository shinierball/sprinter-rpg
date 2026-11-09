/**
 * Copy as blueprint (3.15 S7): a GM writes a blueprint from the enchantments an item already carries. One enchantment
 * template per ledger entry, holding the rows that entry stamped (the stamp is dropped: the crafter's own application
 * stamps them again). The blueprint is a new loot item compiled through `buildPayload`, like any other content.
 */
import { buildPayload } from '../../data/builders/item-payload.mjs';
import { ENCHANTMENT_ROW_ARRAYS } from '../../utils/crafting/crafting-engine.mjs';
import { sanitizeEnchantmentTemplate } from '../../utils/loot/outcome-defaults.mjs';
import { BLUEPRINT_LOOT_TYPE } from '../../models/items/loot-model.mjs';

const asArray = (v) => (Array.isArray(v) ? v : []);
const text = (v) => (typeof v === 'string' ? v.trim() : '');

/**
 * The enchantment templates of an item: one per ledger entry, with the rows stamped with that entry's id.
 * @param {object} itemSystem `item.system`
 * @returns {object[]} sanitised templates
 */
export function enchantmentTemplatesOf(itemSystem) {
  return asArray(itemSystem?.enchantments).filter((entry) => text(entry?.id)).map((entry) => {
    const rows = {};
    for (const array of ENCHANTMENT_ROW_ARRAYS) {
      rows[array] = asArray(itemSystem?.[array])
        .filter((row) => row && row.enchantment === entry.id)
        .map((row) => ({
          ...structuredClone(row),
          enchantment: '',
          // A Rule Break on the original is its own provenance, not part of the recipe
          ...(array === 'asTriggers' ? { ruleBreak: false } : {})
        }));
    }
    return sanitizeEnchantmentTemplate({
      id: entry.id, label: entry.label, property: entry.property, category: entry.category, bonusLevel: entry.bonusLevel, rows
    });
  });
}

/**
 * The creation spec of the blueprint an item's enchantments make: an `enchant`-mode blueprint that accepts any gear, one step
 * per enchantment. Skills, tables and materials are left for the GM to fill in on the blueprint's sheet.
 * @param {{ name?: string, system?: object }} item
 * @param {{ name?: string }} [options] the blueprint's name
 * @returns {{ name: string, system: object }|null} null when the item has no enchantments
 */
export function blueprintSpecFromItem(item, { name } = {}) {
  const templates = enchantmentTemplatesOf(item?.system);
  if (!templates.length) return null;
  return {
    name: name || `${item?.name ?? ''} Blueprint`.trim(),
    system: { lootType: BLUEPRINT_LOOT_TYPE, quantity: 1, blueprint: { mode: 'enchant', enchantments: templates } }
  };
}

/**
 * Create the blueprint of an item's enchantments as a world item. GM only; anyone else gets nothing.
 * @param {Item} item gear or loot with a ledger
 * @param {{ name?: string }} [options]
 * @returns {Promise<Item|null>} the new blueprint, or null (not a GM, or nothing to copy)
 */
export async function copyAsBlueprint(item, { name } = {}) {
  const game = globalThis.game;
  if (!game?.user?.isGM || !item) return null;
  const loc = (key, data) => game.i18n?.format?.(key, data) ?? key;
  const spec = blueprintSpecFromItem(item, { name: name || loc('COG.CopyBlueprint.Name', { name: item.name }) });
  if (!spec) {
    globalThis.ui?.notifications?.warn?.(loc('COG.CopyBlueprint.NothingToCopy', { name: item.name }));
    return null;
  }
  const payload = buildPayload('loot', spec, { warnings: [] });
  const created = await globalThis.Item.create(payload);
  globalThis.ui?.notifications?.info?.(loc('COG.CopyBlueprint.Done', { name: spec.name }));
  return created ?? null;
}
