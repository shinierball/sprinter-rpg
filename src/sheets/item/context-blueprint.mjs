/**
 * Crafting editors on the item sheet (3.15 S6a): the Enchantments ledger of gear and loot, the loot blueprint part, and the
 * enchantment template views the blueprint and the `enchant_item` outcome rows share. Every name, option list and
 * `selected` flag is computed here (CONTRIBUTING section 5); the templates compute nothing.
 */
import { HAZARD_ENCHANTMENTS, enchantmentCount } from '../../utils/crafting/crafting-engine.mjs';
import { ruleBreakBadgeHtml } from '../../utils/rule-break-visibility.mjs';
import { enchantmentCategoriesInOrder, getEnchantmentCategory } from '../../data/rules/crafting-rules.mjs';
import { sizeOptions } from '../../data/sizes.mjs';
import { isBlueprintLootType } from '../../models/items/loot-model.mjs';
import { buildQueryView } from './context-query.mjs';
import { buildRowEditorContext } from './context-rows.mjs';
import { grantAddBar } from './context-identity-rows.mjs';
import { grantRowView } from './grant-row-fields.mjs';
import { buildTemplateAsTriggerView } from './context-as-triggers.mjs';
import { renameRowPaths } from './row-host.mjs';
import { TEMPLATE_ROW_KEYS, TemplateRowsHost } from './template-rows-host.mjs';
import { pickOptions } from '../../utils/ui/field-options.mjs';
import { toArray } from './util.mjs';

const loc = (key, data) => {
  const i18n = globalThis.game?.i18n;
  if (data && typeof i18n?.format === 'function') return i18n.format(key, data);
  return i18n?.localize?.(key) ?? key;
};

/** The blueprint modes in display order (`enchant`: puts enchantments on an existing item; `item`: makes an item). */
const BLUEPRINT_MODES = Object.freeze(['enchant', 'item']);

/** The category select: every registered category, then the stored id when the registry lacks it. */
function categoryOptions(current) {
  const entries = enchantmentCategoriesInOrder().map((def) => ({ id: def.id, label: loc(def.label) }));
  const options = pickOptions(entries, current);
  const cur = String(current ?? '');
  if (cur && !options.some((o) => o.selected)) options.push({ value: cur, label: loc('COG.CraftSheet.Template.UnknownCategory', { value: cur }), selected: true });
  return options;
}

/**
 * The Enchantments block of a gear or loot sheet: the ledger entries, and the notice from the third enchantment on.
 * `count` is the engine's own count (properties, not rows), the number the hazard check reads.
 * @param {object} context render context (mutated)
 * @param {object} item
 */
export function buildEnchantmentLedgerContext(context, item) {
  const sys = context.system ?? item.system;
  const count = enchantmentCount(sys);
  const entries = toArray(sys.enchantments).filter((e) => e && typeof e === 'object').map((e) => ({
    id: String(e.id ?? ''),
    label: String(e.label || '') || loc('COG.CraftSheet.Ledger.Unnamed'),
    categoryLabel: loc(getEnchantmentCategory(e.category).label),
    bonusLevel: Number(e.bonusLevel) || 0,
    method: String(e.method ?? ''),
    methodLabel: loc(`COG.CraftSheet.Ledger.Method.${['craft', 'outcome', 'floor-sim', 'gm'].includes(e.method) ? e.method : 'other'}`),
    ruleBreak: e.ruleBreak === true,
    ruleBreakBadge: e.ruleBreak === true ? ruleBreakBadgeHtml({ cls: 'cog-badge cog-badge-rule-break' }) : ''
  }));
  context.enchantmentLedger = {
    entries,
    count,
    hasEntries: entries.length > 0,
    hazard: count >= HAZARD_ENCHANTMENTS,
    notice: count >= HAZARD_ENCHANTMENTS ? loc('COG.CraftSheet.Ledger.Notice', { count }) : '',
    badge: loc('COG.CraftSheet.Ledger.Badge', { count })
  };
}

/** The view of one material line (`path` is the line's document path). */
function materialView(line, path, index, tagOptions) {
  const m = line && typeof line === 'object' ? line : {};
  return {
    index,
    path,
    labelName: `${path}.label`,
    label: String(m.label ?? ''),
    identifierName: `${path}.identifier`,
    identifier: String(m.identifier ?? ''),
    quantityName: `${path}.quantity`,
    quantity: Number.isFinite(Number(m.quantity)) ? Number(m.quantity) : 1,
    salvageableName: `${path}.salvageable`,
    salvageable: m.salvageable !== false,
    query: buildQueryView(m.query, `${path}.query`),
    tagOptions
  };
}

/**
 * The material lines of a blueprint or of one template.
 * @param {object[]} lines the stored `materials`
 * @param {string} path document path of the list, e.g. `system.blueprint.materials`
 * @param {object[]} tagOptions registered tags grouped by namespace
 */
function materialViews(lines, path, tagOptions) {
  return toArray(lines).map((line, index) => materialView(line, `${path}.${index}`, index, tagOptions));
}

/**
 * The views of a list of enchantment templates, for the shared `enchantment-templates` partial.
 * @param {object[]} templates the stored templates
 * @param {string} listPath document path of the list, e.g. `system.blueprint.enchantments`
 * @param {{ item: object, tagOptions: object[], damageTypes?: string[], craft: boolean }} ctx `craft` shows the crafting
 *   fields (skills, tables, materials); an `enchant_item` outcome applies its templates as they are, with none of them
 */
export function buildTemplateViews(templates, listPath, ctx) {
  return toArray(templates).map((tpl, index) => {
    const t = tpl && typeof tpl === 'object' ? tpl : {};
    const path = `${listPath}.${index}`;
    const host = new TemplateRowsHost(ctx.item, path);
    const rowContext = { system: host.system, damageTypes: ctx.damageTypes, techniqueTagOptions: ctx.tagOptions };
    buildRowEditorContext(rowContext, host);
    const editors = renameRowPaths(rowContext.rowEditors ?? { blocks: [], addBar: [] }, TEMPLATE_ROW_KEYS, `${path}.rows`);
    const grants = renameRowPaths({
      rows: host.system.grants.map((row, i) => grantRowView(row ?? {}, `system.grants.${i}`, { item: host, tagOptions: ctx.tagOptions, index: i })),
      addBar: grantAddBar()
    }, TEMPLATE_ROW_KEYS, `${path}.rows`);
    const asTriggers = renameRowPaths(buildTemplateAsTriggerView(host.system.asTriggers, ctx.availableDebuffs), TEMPLATE_ROW_KEYS, `${path}.rows`);
    return {
      index,
      number: index + 1,
      path,
      templatesPath: listPath,
      craft: ctx.craft === true,
      labelName: `${path}.label`,
      label: String(t.label ?? ''),
      propertyName: `${path}.property`,
      property: String(t.property ?? ''),
      categoryName: `${path}.category`,
      categoryOptions: categoryOptions(t.category),
      bonusLevelName: `${path}.bonusLevel`,
      bonusLevel: Number.isFinite(Number(t.bonusLevel)) ? Number(t.bonusLevel) : 1,
      skills: ctx.craft ? buildQueryView(t.skills, `${path}.skills`) : null,
      tables: ctx.craft ? buildQueryView(t.tables, `${path}.tables`) : null,
      materialsPath: `${path}.materials`,
      materials: ctx.craft ? materialViews(t.materials, `${path}.materials`, ctx.tagOptions) : [],
      blocks: editors.blocks,
      addBar: editors.addBar,
      grants,
      asTriggers,
      tagOptions: ctx.tagOptions
    };
  });
}

/**
 * The loot blueprint part: mode, output, size, Difficulty, queries, base materials and the enchantment templates. Sets
 * `context.isBlueprint`; the rest only for a blueprint.
 * @param {object} context render context (mutated; `context.techniqueTagOptions` and `context.damageTypes` are already set)
 * @param {object} item
 */
export function buildBlueprintContext(context, item) {
  const sys = context.system;
  context.isBlueprint = isBlueprintLootType(sys.lootType);
  if (!context.isBlueprint) return;
  const bp = sys.blueprint ?? {};
  const tagOptions = context.techniqueTagOptions ?? [];
  const mode = BLUEPRINT_MODES.includes(bp.mode) ? bp.mode : 'enchant';
  const output = bp.output ?? {};
  context.blueprint = {
    modeOptions: pickOptions(BLUEPRINT_MODES.map((id) => ({ id, label: loc(`COG.CraftSheet.Blueprint.Mode.${id}`) })), mode),
    isEnchantMode: mode === 'enchant',
    isItemMode: mode === 'item',
    output: { name: String(output.name ?? ''), identifier: String(output.identifier ?? ''), uuid: String(output.uuid ?? ''), has: Boolean(output.name || output.identifier || output.uuid) },
    sizeOptions: sizeOptions(bp.size, { blankLabel: 'COG.CraftSheet.Blueprint.NoSize' }),
    dc: bp.dc ?? '',
    target: buildQueryView(bp.target, 'system.blueprint.target'),
    skills: buildQueryView(bp.skills, 'system.blueprint.skills'),
    tables: buildQueryView(bp.tables, 'system.blueprint.tables'),
    materialsPath: 'system.blueprint.materials',
    materials: materialViews(bp.materials, 'system.blueprint.materials', tagOptions),
    templatesPath: 'system.blueprint.enchantments',
    templates: buildTemplateViews(bp.enchantments, 'system.blueprint.enchantments', { item, tagOptions, damageTypes: context.damageTypes, availableDebuffs: context.availableDebuffs, craft: true }),
    tagOptions
  };
}
