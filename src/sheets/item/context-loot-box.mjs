/**
 * Context for the loot box editors (7.3d, spec D5): the Box part of a `box` loot item and the Reward Boxes editor of an
 * achievement. Pure view-model builders; the rows are precomputed here so the templates only print them. The prize rows
 * are shown to the GM only; a player sees the tier and "Sealed".
 */
import { lootBoxTierDef, lootBoxTierOptions, resolveLootBoxTier } from '../../data/loot-box-tiers.mjs';
import { isLootBoxType } from '../../models/items/loot-model.mjs';
import { COG_ACHIEVEMENT_TIERS } from '../../data/rules/achievement-tiers.mjs';
import { BOX_TABLE_AS } from '../../data/loot-box-rows.mjs';
import { choiceCandidates } from '../../documents/actor/loot-box-open.mjs';
import { buildQueryView } from './context-query.mjs';
import { pickOptions } from '../../utils/ui/field-options.mjs';
import { toArray } from './util.mjs';
import { INVENTORY_ITEM_TYPES, RANKED_ITEM_TYPES } from '../../utils/document-types.mjs';

const KIND_LABELS = Object.freeze({
  item: 'Item', spell: 'Spell tome', gold: 'Gold', table: 'Table', magicItem: 'Generated magic item', choice: 'Choice'
});

/** Localized text with the English default when the key is not loaded (tests, early load). */
function loc(key, fallback) {
  const i18n = globalThis.game?.i18n;
  if (i18n?.has?.(key) && typeof i18n.localize === 'function') return i18n.localize(key);
  return fallback ?? key;
}

const isGM = () => globalThis.game?.user?.isGM === true;

/** Tier options with a leading blank ("this box's tier") for a generated item row. */
function rowTierOptions(selected, boxTier) {
  const own = lootBoxTierDef(boxTier).label || boxTier;
  const options = lootBoxTierOptions(selected || boxTier).map((o) => ({ value: o.key, label: o.label, selected: Boolean(selected) && o.selected }));
  options.unshift({ value: '', label: `${loc('COG.LootBoxSheet.BoxTier', "This box's tier")} (${own})`, selected: !selected });
  return options;
}

const tableChoices = (tables) => tables.map((t) => ({ id: t.uuid, label: t.group ? `${t.name} (${t.group})` : t.name }));

/** The candidate type options of a choice row: any inventory item, each inventory type, a skill potion, a spell tome. */
function choiceTypeOptions(selected) {
  const ids = ['', ...INVENTORY_ITEM_TYPES, ...RANKED_ITEM_TYPES];
  const fallbacks = { '': 'Any item', gear: 'Gear', loot: 'Loot', skill: 'Skill (potion)', spell: 'Spell (tome)' };
  return ids.map((id) => ({ value: id, label: loc(`COG.LootBoxSheet.ChoiceType.${id || 'any'}`, fallbacks[id]), selected: id === selected }));
}

/** What a table row's rolled rows become: as printed, a skill potion of a custom Skill, a placeholder item. */
function tableAsOptions(selected) {
  const ids = ['', ...BOX_TABLE_AS];
  const fallbacks = { '': 'As printed', skillPotion: 'Skill potions', item: 'Placeholder items' };
  return ids.map((id) => ({ value: id, label: loc(`COG.LootBoxSheet.TableAs.${id || 'printed'}`, fallbacks[id]), selected: id === selected }));
}

/** One prize row as the template prints it. */
function rowView(row, index, { boxTier, tables, tagOptions }) {
  const kind = String(row?.kind ?? 'item');
  const view = {
    index,
    kind,
    kindLabel: loc(`COG.LootBoxSheet.Kind.${kind}`, KIND_LABELS[kind] ?? kind),
    isItem: kind === 'item',
    isSpell: kind === 'spell',
    isGold: kind === 'gold',
    isTable: kind === 'table',
    isMagicItem: kind === 'magicItem',
    isChoice: kind === 'choice',
    name: String(row?.name ?? ''),
    img: String(row?.img ?? ''),
    quantity: Number(row?.quantity) || 1,
    formula: String(row?.formula ?? ''),
    rank: row?.rank ?? '',
    label: String(row?.label ?? ''),
    tier: String(row?.tier ?? ''),
    hasRank: kind === 'spell',
    hasQuantity: kind === 'item' || kind === 'table' || kind === 'magicItem' || kind === 'choice'
  };
  if (view.isChoice) {
    const itemType = String(row?.itemType ?? '');
    view.itemTypeOptions = choiceTypeOptions(itemType);
    view.hasRank = RANKED_ITEM_TYPES.includes(itemType);
    view.hasStem = itemType === 'skill';
    view.query = buildQueryView(row?.query, `system.box.contents.${index}.query`, ['all', 'any', 'none'], { gm: false });
    view.tagOptions = tagOptions;
    view.incomplete = !view.query.buckets.some((b) => b.bucket !== 'none' && b.tags.length > 0);
    view.candidateCount = view.incomplete ? 0 : choiceCandidates({ query: row?.query ?? null, itemType }).length;
  }
  if (view.isTable) {
    const as = BOX_TABLE_AS.includes(row?.as) ? row.as : '';
    view.times = String(row?.times ?? '');
    view.asOptions = tableAsOptions(as);
    view.isSkillPotion = as === 'skillPotion';
    // The stem and the Rank of a hobby-potion row; Choose now picks the potion's entry
    if (view.isSkillPotion) { view.hasStem = true; view.hasRank = true; }
    view.canChoose = view.isSkillPotion;
  }
  if (view.isChoice) view.canChoose = true;
  if (view.isMagicItem) view.tierOptions = rowTierOptions(view.tier, boxTier);
  if (view.isTable) {
    const key = String(row?.tableKey ?? '');
    const uuid = String(row?.uuid ?? '');
    const picked = tables.find((t) => (uuid && t.uuid === uuid) || (key && t.key === key));
    view.tableOptions = pickOptions(tableChoices(tables), picked?.uuid ?? '', { blankLabel: (view.isSkillPotion ? '' : view.name) || loc('COG.LootBoxSheet.Unresolved', 'Not found in this world') });
    view.unresolved = !picked;
  }
  return view;
}

/**
 * The Box part. Sets `context.isLootBox`; the rest only for a box.
 * `context.availableBoxTables` (set by the sheet for a GM) feeds the table pickers.
 * @param {object} context render context (mutated)
 * @param {object} item the loot item
 */
export function buildLootBoxContext(context, item) {
  const sys = context.system ?? item?.system ?? {};
  context.isLootBox = isLootBoxType(sys.lootType);
  if (!context.isLootBox) return;
  const box = sys.box ?? {};
  const tier = resolveLootBoxTier(box.tier);
  const def = lootBoxTierDef(tier);
  const gm = isGM();
  const tables = Array.isArray(context.availableBoxTables) ? context.availableBoxTables : [];
  const tagOptions = Array.isArray(context.techniqueTagOptions) ? context.techniqueTagOptions : [];
  const contents = toArray(box.contents);
  context.lootBox = {
    tier,
    tierLabel: def.label || tier,
    tierIcon: def.icon || '',
    tierOptions: lootBoxTierOptions(tier),
    showRows: gm,
    sealed: !gm,
    keepSealed: box.whenEmpty === 'keep',
    // A stack of copies shares its rows: Pre-roll and Choose now give every unit the same prizes
    stackHint: gm && (Number(sys.quantity) || 1) > 1 && contents.some((r) => r?.kind === 'magicItem' || r?.kind === 'choice'),
    count: contents.length,
    rows: gm ? contents.map((row, index) => rowView(row, index, { boxTier: tier, tables, tagOptions })) : [],
    tablePicker: pickOptions(tableChoices(tables), '', { blankLabel: loc('COG.LootBoxSheet.AddTable', 'Add a roll table...') }),
    hasTables: tables.length > 0
  };
}

/**
 * The achievement's Reward Boxes editor and the grant button.
 * @param {object} context render context (mutated)
 * @param {object} item the achievement
 */
export function buildRewardBoxesContext(context, item) {
  const sys = context.system ?? item?.system ?? {};
  const rows = toArray(sys.rewardBoxes).map((row, index) => {
    const tier = resolveLootBoxTier(row?.tier);
    return {
      index,
      tier,
      tierOptions: lootBoxTierOptions(tier).map((o) => ({ value: o.key, label: o.label, selected: o.selected })),
      quantity: Number(row?.quantity) || 1,
      templateName: String(row?.name ?? ''),
      hasTemplate: Boolean(row?.uuid || row?.identifier)
    };
  });
  context.rewardBoxes = {
    rows,
    count: rows.length,
    canGrant: isGM() && item?.parent?.documentName === 'Actor' && rows.length > 0
  };
}

/**
 * Achievement tier select options from the registry (`CONFIG.COG.achievementTiers`), keeping an unregistered stored tier.
 * @param {object} context render context (mutated)
 */
export function buildAchievementTierContext(context) {
  const registry = globalThis.CONFIG?.COG?.achievementTiers ?? COG_ACHIEVEMENT_TIERS;
  const current = String(context.system?.tier ?? '');
  const entries = Object.values(registry).map((def) => ({ id: def.id, label: def.label || def.id }));
  if (current && !entries.some((e) => e.id === current)) entries.push({ id: current, label: current });
  context.achievementTierOptions = pickOptions(entries, current);
}
