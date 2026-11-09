/**
 * Item summary blocks for crafting (3.15 S2): the enchantment ledger of gear and loot, the blueprint part of a blueprint
 * loot item, the `enchant_item` outcome line, broken and destroyed items, and the effective tier of a crafting table.
 * Reads only structured fields. Text lives under `COG.ItemSummary.Crafting` in lang/en.json.
 */
import { itemLine, t, defineItemSummaryTemplates, str, whole, humanizeId } from './shared.mjs';
import { normalizeTagList } from '../tag/tag-query.mjs';
import { getTagDefinition } from '../../data/tag-definitions.mjs';
import { sizeName } from '../../data/sizes.mjs';
import { isBlueprintLootType } from '../../models/items/loot-model.mjs';
import { outcomeEnchantments, outcomeEnchantTable } from '../loot/outcome-defaults.mjs';
import { getCurrentFloor } from '../floor/current-floor.mjs';
import { ITEM_STATE_TAGS } from '../tag/tag-mechanics.mjs';
import { effectiveTableTier } from '../crafting/crafting-engine.mjs';

const K = 'COG.ItemSummary.Crafting.';

defineItemSummaryTemplates({
  [`${K}Enchantment`]: 'Enchantment: {label} ({category}, bonus level {level}){extra}',
  [`${K}EnchantmentRows`]: ', rows: {n}',
  [`${K}EnchantmentRuleBreak`]: ', Rule Break',
  [`${K}BlueprintEnchant`]: 'Blueprint: adds enchantments to {target}',
  [`${K}BlueprintAnyGear`]: 'any gear',
  [`${K}BlueprintItem`]: 'Blueprint: makes {name}',
  [`${K}BlueprintItemLinked`]: 'a linked item',
  [`${K}BlueprintItemUnnamed`]: 'an item',
  [`${K}BlueprintQuantity`]: 'Makes {n} per success',
  [`${K}BlueprintBatchable`]: 'Can be made in batches',
  [`${K}BlueprintOneRoll`]: 'One roll covers every step',
  [`${K}BlueprintSize`]: 'Base item size: {size}',
  [`${K}BlueprintDc`]: 'Base step Difficulty {dc}',
  [`${K}BlueprintJunk`]: 'Misc. Junk beyond the size cost: {n}',
  [`${K}BlueprintSkills`]: 'Skills: {query}',
  [`${K}BlueprintTables`]: 'Tables: {query}',
  [`${K}BlueprintMaterials`]: 'Materials: {list}',
  [`${K}BlueprintMaterial`]: '{n} x {name}',
  [`${K}BlueprintStep`]: 'Enchantment step: {label} ({category}, bonus level {level})',
  [`${K}QueryAny`]: 'any of {tags}',
  [`${K}QueryNone`]: 'not {tags}',
  [`${K}OutcomeEnchant`]: 'Enchants an equipped item: {list}',
  [`${K}OutcomeEnchantNone`]: 'Enchants an equipped item',
  [`${K}OutcomeEnchantTable`]: 'Rolls {table} for an Amazing Success trigger',
  [`${K}ItemBroken`]: 'Broken: unequipped until repaired',
  [`${K}ItemDestroyed`]: 'Destroyed for good',
  [`${K}TableTier`]: 'tier {tier} now: base {base}, bought {bought}, coupons {coupons}, floors {floors}'
});

const sysOf = (item) => (item?.system && typeof item.system === 'object' ? item.system : {});
const isGear = (item) => item?.type === 'gear';
const isLoot = (item) => item?.type === 'loot';
const arr = (v) => (Array.isArray(v) ? v.filter((e) => e && typeof e === 'object') : []);

const { broken: BROKEN_TAG, destroyed: DESTROYED_TAG } = ITEM_STATE_TAGS;

const tagLabels = (list) => normalizeTagList(list).map((id) => getTagDefinition(id)?.label || id).join(', ');

/** A tag query as one phrase ("A, B, any of C, not D"); '' when it names nothing. */
function queryText(q) {
  if (!q || typeof q !== 'object') return '';
  const any = tagLabels(q.any);
  const none = tagLabels(q.none);
  return [tagLabels(q.all), any && t(`${K}QueryAny`, { tags: any }), none && t(`${K}QueryNone`, { tags: none })].filter(Boolean).join(', ');
}

const categoryName = (id) => humanizeId(str(id) || 'other');

/** The bonus level of a ledger entry or template, a whole number of at least 0. */
const levelOf = (e) => whole(e?.bonusLevel, 0);

/** Every row array an enchantment may stamp, as one list of rows. */
function stampedRows(sys) {
  return ['grants', 'damageModifiers', 'defenseModifiers', 'attackModifiers', 'checkModifiers', 'asTriggers'].flatMap((k) => arr(sys[k]));
}

const gearEnchantments = {
  id: 'gear-enchantments',
  group: 'other',
  applies: (item) => (isGear(item) || isLoot(item)) && arr(sysOf(item).enchantments).length > 0,
  describe: (item) => {
    const sys = sysOf(item);
    const rows = stampedRows(sys);
    return arr(sys.enchantments).map((e, i) => {
      const id = str(e.id);
      const n = id ? rows.filter((r) => str(r.enchantment) === id).length : 0;
      const extra = (n ? t(`${K}EnchantmentRows`, { n }) : '') + (e.ruleBreak === true ? t(`${K}EnchantmentRuleBreak`) : '');
      const label = str(e.label) || humanizeId(id) || categoryName(e.category);
      return itemLine('mod', t(`${K}Enchantment`, { label, category: categoryName(e.category), level: levelOf(e), extra }), `system.enchantments.${i}`);
    });
  }
};

const materialsText = (list) => arr(list).map((m) => t(`${K}BlueprintMaterial`, {
  n: whole(m.quantity, 1), name: str(m.label) || humanizeId(m.identifier) || tagLabels(m.query?.all) || tagLabels(m.query?.any) || '?'
})).join(', ');

const lootBlueprint = {
  id: 'loot-blueprint',
  group: 'other',
  applies: (item) => isLoot(item) && isBlueprintLootType(sysOf(item).lootType),
  describe: (item) => {
    const bp = sysOf(item).blueprint && typeof sysOf(item).blueprint === 'object' ? sysOf(item).blueprint : {};
    const at = (leaf) => `system.blueprint.${leaf}`;
    const out = [];
    if (str(bp.mode) === 'item') {
      const o = bp.output && typeof bp.output === 'object' ? bp.output : {};
      const name = str(o.name) || humanizeId(o.identifier)
        || (str(o.uuid) ? t(`${K}BlueprintItemLinked`) : t(`${K}BlueprintItemUnnamed`));
      out.push(itemLine('use', t(`${K}BlueprintItem`, { name }), at('output')));
      if (whole(bp.quantity, 1) > 1) out.push(itemLine('use', t(`${K}BlueprintQuantity`, { n: whole(bp.quantity, 1) }), at('quantity')));
      if (str(bp.size)) out.push(itemLine('cost', t(`${K}BlueprintSize`, { size: sizeName(bp.size) }), at('size')));
    } else {
      out.push(itemLine('use', t(`${K}BlueprintEnchant`, { target: queryText(bp.target) || t(`${K}BlueprintAnyGear`) }), at('target')));
    }
    if (bp.batchable === true) out.push(itemLine('use', t(`${K}BlueprintBatchable`), at('batchable')));
    if (bp.oneRoll === true) out.push(itemLine('use', t(`${K}BlueprintOneRoll`), at('oneRoll')));
    if (bp.dc !== null && bp.dc !== undefined && Number.isFinite(Number(bp.dc))) out.push(itemLine('cost', t(`${K}BlueprintDc`, { dc: whole(bp.dc) }), at('dc')));
    if (whole(bp.junk) > 0) out.push(itemLine('cost', t(`${K}BlueprintJunk`, { n: whole(bp.junk) }), at('junk')));
    const skills = queryText(bp.skills);
    if (skills) out.push(itemLine('skill', t(`${K}BlueprintSkills`, { query: skills }), at('skills')));
    const tables = queryText(bp.tables);
    if (tables) out.push(itemLine('use', t(`${K}BlueprintTables`, { query: tables }), at('tables')));
    const mats = materialsText(bp.materials);
    if (mats) out.push(itemLine('cost', t(`${K}BlueprintMaterials`, { list: mats }), at('materials')));
    arr(bp.enchantments).forEach((e, i) => {
      out.push(itemLine('mod', t(`${K}BlueprintStep`, {
        label: str(e.label) || categoryName(e.category), category: categoryName(e.category), level: levelOf(e)
      }), at(`enchantments.${i}`)));
    });
    return out;
  }
};

const itemState = {
  id: 'item-state',
  group: 'other',
  applies: (item) => (isGear(item) || isLoot(item)) && Array.isArray(sysOf(item).tags)
    && (sysOf(item).tags.includes(BROKEN_TAG) || sysOf(item).tags.includes(DESTROYED_TAG)),
  describe: (item) => {
    const tags = sysOf(item).tags;
    // Destroyed wins: a destroyed item is never repaired
    return [itemLine('debuff', t(tags.includes(DESTROYED_TAG) ? `${K}ItemDestroyed` : `${K}ItemBroken`), 'system.tags')];
  }
};

/**
 * The `enchant_item` outcome as `{ kind, effect }` for the outcomes block.
 * @param {object} out the outcome row
 */
export function enchantOutcomeEffect(out) {
  const list = outcomeEnchantments(out).map((e) => e.label || categoryName(e.category)).join(', ');
  const table = outcomeEnchantTable(out);
  if (table) {
    const rolls = t(`${K}OutcomeEnchantTable`, { table: table.name || table.key || table.uuid });
    return { kind: 'mod', effect: list ? `${t(`${K}OutcomeEnchant`, { list })}. ${rolls}` : rolls };
  }
  return { kind: 'mod', effect: list ? t(`${K}OutcomeEnchant`, { list }) : t(`${K}OutcomeEnchantNone`) };
}

/**
 * A crafting table's tier now and where it comes from.
 * The tier is the engine's `effectiveTableTier`; the breakdown only splits it for the line.
 * @param {object} ct the item's `craftingTable`
 * @param {number} floor the floor the crawler reached
 * @returns {{ tier: number, base: number, bought: number, coupons: number, floors: number }}
 */
export function tableTierParts(ct, floor = getCurrentFloor()) {
  const base = whole(ct?.baseTier);
  const bought = whole(ct?.purchasedTiers);
  const coupons = whole(ct?.couponTiers);
  const acquired = ct?.acquiredAtFloor;
  const floors = acquired === null || acquired === undefined || !Number.isFinite(Number(acquired)) ? 0 : Math.max(0, whole(floor, 1) - whole(acquired, 1));
  return { tier: effectiveTableTier(ct, floor), base, bought, coupons, floors };
}

/** The "tier 3 now: ..." phrase of the table line. */
export const tableTierText = (ct, floor) => t(`${K}TableTier`, tableTierParts(ct, floor));

/** @type {ReadonlyArray<import('./shared.mjs').ItemSummaryBlock>} */
export const BLOCKS = Object.freeze([gearEnchantments, lootBlueprint, itemState]);
