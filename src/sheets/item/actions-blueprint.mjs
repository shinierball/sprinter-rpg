/**
 * Crafting actions of the item sheet (3.15 S6a): the Enchantments ledger's Remove, the blueprint's material lines and
 * enchantment templates, the output drop zone, and the crafting table's Buy a tier and Apply a coupon.
 *
 * The row editors inside a template are the item sheet's own (`addRow`, `deleteRow`, `moveRow`, `duplicateRow`,
 * `clearRowField` and the pick-list actions). Their controls sit inside an element with `data-template-path`; for those,
 * {@link viaTemplateHost} runs the same handler against a `TemplateRowsHost` of that template, and any other control keeps
 * the original handler. Every handler runs with `this` = the item sheet.
 */
import { removeEnchantment } from '../../documents/item/enchantments.mjs';
import { buyTableTier, applyTableCoupon, isCraftingTable } from '../../documents/actor/crafting-tables.mjs';
import { crawlerDoc, spaceLinksCrawler } from '../../documents/actor/personal-space-links.mjs';
import { enchantmentTemplateId, sanitizeEnchantmentTemplate } from '../../utils/loot/outcome-defaults.mjs';
import { COGCraftingApp, craftingContextFor } from '../../apps/crafting-app.mjs';
import { ROW_ACTIONS } from './actions-rows.mjs';
import { PICK_LIST_ACTIONS } from './actions-lists.mjs';
import { AS_TRIGGER_ACTIONS } from './actions-as-triggers.mjs';
import { retargetRow } from './row-host.mjs';
import { TemplateRowsHost, readAtPath, writeAtPath } from './template-rows-host.mjs';
import { rowIndex, toArray } from './util.mjs';

const loc = (key, data) => {
  const i18n = globalThis.game?.i18n;
  if (data && typeof i18n?.format === 'function') return i18n.format(key, data);
  return i18n?.localize?.(key) ?? key;
};
const warn = (key, data) => globalThis.ui?.notifications?.warn?.(loc(key, data));

const isIndex = (v) => v !== undefined && v !== '' && Number.isInteger(Number(v));

/**
 * What a control's list path names: `'enchantments'` (a blueprint's templates or an `enchant_item` outcome's), `'materials'`
 * (the blueprint's base lines or one template's), or '' for any other path. A control may name no other list.
 * @param {string} path
 * @returns {'enchantments'|'materials'|''}
 */
export function craftListKind(path) {
  const s = String(path ?? '').split('.');
  if (s[0] !== 'system') return '';
  if (s.length === 3 && s[1] === 'blueprint' && (s[2] === 'materials' || s[2] === 'enchantments')) return s[2];
  if (s.length === 4 && s[1] === 'outcomes' && isIndex(s[2]) && s[3] === 'enchantments') return 'enchantments';
  if (s.length === 5 && s[1] === 'blueprint' && s[2] === 'enchantments' && isIndex(s[3]) && s[4] === 'materials') return 'materials';
  return '';
}

/**
 * Wrap a row or pick-list handler so a control inside a template runs it against that template's rows.
 * @param {Function} handler an item-sheet action handler
 */
function viaTemplateHost(handler) {
  return async function templateHostAction(event, target) {
    const path = target?.closest?.('[data-template-path]')?.dataset?.templatePath;
    if (!path) return handler.call(this, event, target);
    return handler.call({ isEditable: this.isEditable, item: new TemplateRowsHost(this.item, path) }, event, retargetRow(target, (p) => p));
  };
}

const wrap = (table, names) => Object.fromEntries(names.map((name) => [name, viaTemplateHost(table[name])]));

/** The stored list at `path` (a copy). */
const readList = (item, path) => toArray(readAtPath(item, path)).map((entry) => foundry.utils.deepClone(entry));

/**
 * The payer of a table: the clicking user's assigned character when it owns or occupies the table's space; otherwise the
 * crawler that owns the space (a GM with no such character charges the owner).
 */
export function tablePayer(table) {
  const space = table?.parent;
  const mine = crawlerDoc(globalThis.game?.user?.character);
  if (mine?.type === 'crawler' && spaceLinksCrawler(space, mine)) return mine;
  return space?.system?.getOwnerActor?.() ?? null;
}

/**
 * Whether this user may buy tiers for a table: a crafting table on a personal space whose payer they can write (a GM
 * always). That is the space's owner crawler, or the user's own character when it occupies the space; the tier itself is
 * written through the GM relay when the user cannot write the space. A space with no owner crawler has no payer to
 * write; the buttons then report that.
 * @param {object} table
 */
export function canManageTable(table) {
  if (!isCraftingTable(table) || table.parent?.type !== 'personal_space') return false;
  if (globalThis.game?.user?.isGM === true) return true;
  const payer = tablePayer(table);
  if (!payer) return table.isOwner === true;
  // The user's own character that occupies the space pays without owning the space; anyone else needs the space too.
  const mine = crawlerDoc(globalThis.game?.user?.character);
  if (mine && mine === crawlerDoc(payer)) return payer.isOwner === true;
  return table.isOwner === true && payer.isOwner === true;
}

/** Say what a table action did when it did nothing. */
function reportTableRefusal(result, payer) {
  const reasons = { gold: 'COG.CraftSheet.Table.Refused.gold', maxTier: 'COG.CraftSheet.Table.Refused.maxTier', noCoupon: 'COG.CraftSheet.Table.Refused.noCoupon' };
  if (result?.reason && reasons[result.reason]) warn(reasons[result.reason], { name: payer?.name ?? '' });
}

export const BLUEPRINT_ACTIONS = {
  ...wrap(ROW_ACTIONS, ['addRow', 'deleteRow', 'moveRow', 'duplicateRow', 'clearRowField']),
  ...wrap(PICK_LIST_ACTIONS, ['addPick', 'addCustomPick', 'removePick']),
  ...wrap(AS_TRIGGER_ACTIONS, ['addAsTrigger', 'removeAsTrigger']),

  /** Ledger: take an enchantment off the item (its ledger entry and every row it wrote). */
  async removeItemEnchantment(event, target) {
    if (!this.isEditable) return;
    await removeEnchantment(this.item, String(target.dataset.id ?? ''));
  },

  /** Add a blank template to a list (`data-templates-path`: a blueprint's or an `enchant_item` outcome's). */
  async addEnchantmentTemplate(event, target) {
    if (!this.isEditable) return;
    const path = target.dataset.templatesPath;
    if (craftListKind(path) !== 'enchantments') return;
    const list = readList(this.item, path);
    const label = loc('COG.CraftSheet.Template.NewLabel', { number: list.length + 1 });
    list.push(sanitizeEnchantmentTemplate({ id: enchantmentTemplateId(label, list.map((t) => t?.id)), label, bonusLevel: 1 }));
    await writeAtPath(this.item, path, list);
  },

  async removeEnchantmentTemplate(event, target) {
    if (!this.isEditable) return;
    const path = target.dataset.templatesPath;
    if (craftListKind(path) !== 'enchantments') return;
    const list = readList(this.item, path);
    const idx = rowIndex(target);
    if (idx < 0 || idx >= list.length) return;
    list.splice(idx, 1);
    await writeAtPath(this.item, path, list);
  },

  /** Add a blank material line to a list (`data-materials-path`). */
  async addCraftMaterial(event, target) {
    if (!this.isEditable) return;
    const path = target.dataset.materialsPath;
    if (craftListKind(path) !== 'materials') return;
    const list = readList(this.item, path);
    list.push({ label: '', identifier: '', query: null, quantity: 1, salvageable: true });
    await writeAtPath(this.item, path, list);
  },

  async removeCraftMaterial(event, target) {
    if (!this.isEditable) return;
    const path = target.dataset.materialsPath;
    if (craftListKind(path) !== 'materials') return;
    const list = readList(this.item, path);
    const idx = rowIndex(target);
    if (idx < 0 || idx >= list.length) return;
    list.splice(idx, 1);
    await writeAtPath(this.item, path, list);
  },

  /** Blueprint: open the crafting app on this blueprint, for the crawler (or the user's crawler in the space) that holds it. */
  openCraftingApp() {
    const { crawler, space } = craftingContextFor(this.item);
    if (!crawler) { warn('COG.CraftApp.NoCrawlerForBlueprint'); return; }
    COGCraftingApp.open({ crawler, space, blueprint: this.item });
  },

  /** Blueprint: forget the dropped output item. */
  async clearBlueprintOutput() {
    if (!this.isEditable) return;
    await this.item.update({ 'system.blueprint.output': { uuid: '', identifier: '', name: '' } });
  },

  /** Space upgrade: buy one tier for the table with the space owner's gold (S3's `buyTableTier`; Rule Breaks asked there). */
  async buyTableTier() {
    const table = this.item;
    if (!canManageTable(table)) return;
    const payer = tablePayer(table);
    if (!payer) { warn('COG.CraftSheet.Table.NoPayer'); return; }
    reportTableRefusal(await buyTableTier(table, payer), payer);
    await this.render();
  },

  /** Space upgrade: spend one of the space owner's table coupons on the table (S3's `applyTableCoupon`). */
  async applyTableCoupon() {
    const table = this.item;
    if (!canManageTable(table)) return;
    const payer = tablePayer(table);
    if (!payer) { warn('COG.CraftSheet.Table.NoPayer'); return; }
    reportTableRefusal(await applyTableCoupon(table, payer), payer);
    await this.render();
  }
};
