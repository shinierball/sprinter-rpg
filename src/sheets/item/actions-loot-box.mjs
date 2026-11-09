/**
 * Loot box actions of the item sheet (7.3d, spec D5): filling a box (the loot sheet's Box part) and the achievement's
 * Reward Boxes editor with its Grant button. Every control is an action delegate with no `name`, so the form harvester never
 * meets the row arrays (GEMINI §5). Every handler runs with `this` = the item sheet. Rows are written whole
 * (`system.box.contents`, `system.rewardBoxes`) after passing through the same sanitizers the builders use.
 *
 * Filling a box is the GM's job: a player who owns a copy sees the tier and "Sealed" and every write here is refused quietly.
 * Nothing here hard-blocks a rule: granting a trophy's boxes a second time asks a Rule Break confirm.
 */
import { SYSTEM_ID } from '../../constants.mjs';
import { resolveLootBoxTier } from '../../data/loot-box-tiers.mjs';
import { BOX_TABLE_AS, sanitizeBoxRow, sanitizeRewardBoxes } from '../../data/loot-box-rows.mjs';
import { isLootBoxType } from '../../models/items/loot-model.mjs';
import { itemIdentifier } from '../../utils/identifier.mjs';
import { BOX_CHOICE_INVENTORY_TYPES, tableRowEntry } from '../../utils/row-kinds.mjs';
import { confirmRuleBreak } from '../../utils/rule-break.mjs';
import { choiceTextKey, promptChoicePicks } from '../../utils/ui/choice-picker.mjs';
import { getOrCreateItemFolder } from '../../utils/ui/world-folder.mjs';
import { boxText, boxOpenServices, choiceCandidates } from '../../documents/actor/loot-box-open.mjs';
import { rollMagicItem } from '../../documents/item/magic-item-roll.mjs';
import { grantLootBoxes, REWARD_BOXES_FLAG } from '../../documents/actor/achievement-award.mjs';
import { getAvailableRollTables } from './catalogs.mjs';
import { rowIndex, toArray } from './util.mjs';

const TEXT = Object.freeze({
  'COG.RewardBoxes.GrantAgainTitle': 'Already Granted',
  'COG.RewardBoxes.GrantAgainMessage': '{name} already granted its reward boxes to {actor}. Grant them again as a Rule Break?',
  'COG.RewardBoxes.Granted': 'Granted {count} reward box(es) to {actor}.',
  'COG.RewardBoxes.NotBox': '{name} is not a loot box.',
  'COG.LootBoxSheet.PrerollFolder': 'Loot Box Prizes',
  'COG.LootBoxSheet.PrerollDone': 'Pre-rolled {count} item(s) from {box}. Finish any pending enchantments on the items in the Loot Box Prizes folder.',
  'COG.LootBoxSheet.PrerollPartial': 'Pre-rolled {made} of {total} item(s) from {box}; the rest stays a generated item row.',
  'COG.LootBoxSheet.PrerollFailed': 'Could not pre-roll an item for {box}.',
  'COG.LootBoxSheet.ChooseNowTitle': 'Choose Now',
  'COG.LootBoxSheet.ChooseNowIntro': 'Pick the prize for {box}. The row becomes that prize.',
  'COG.LootBoxSheet.ChooseNowLabel': 'Choose one',
  'COG.LootBoxSheet.ChooseNowConfirm': 'Choose',
  'COG.LootBoxSheet.ChooseNowCancel': 'Cancel',
  'COG.LootBoxSheet.ChooseNowTableEntry': 'Table entry',
  'COG.LootBoxSheet.ChooseNowTypeLabel': 'Or type a name',
  'COG.LootBoxSheet.ChooseNowNone': 'Nothing in this world matches that choice, so there is nothing to pick.',
  'COG.LootBoxSheet.ChooseNowDone': 'Chose {name} for {box}.',
  'COG.LootBoxSheet.ChooseNowFailed': 'Could not create the prize for {box}.'
});

function text(key, data = {}) {
  const i18n = globalThis.game?.i18n;
  if (i18n?.has?.(key) && typeof i18n.format === 'function') return i18n.format(key, data);
  return (TEXT[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => String(data[k] ?? ''));
}

const isGM = () => globalThis.game?.user?.isGM === true;
const warn = (message) => globalThis.ui?.notifications?.warn?.(message);
const info = (message) => globalThis.ui?.notifications?.info?.(message);

/** Whole number from a control value, at least `min`; `fallback` when it is not a number. */
function whole(raw, { min = 1, fallback = 1 } = {}) {
  const n = Math.trunc(Number(raw));
  return Number.isFinite(n) ? Math.max(min, n) : fallback;
}

/** The value of an unnamed inline control (a checkbox gives its state). */
function valueOf(control) {
  const type = String(control?.getAttribute?.('type') ?? control?.type ?? '').toLowerCase();
  if (type === 'checkbox') return Boolean(control.checked);
  return control?.value;
}

// --- the box's prize rows ---------------------------------------------------------------------------------------------

/** Whether this sheet may edit the box's contents: the GM, on an editable box. */
const canFill = (sheet) => Boolean(sheet?.isEditable) && isGM() && isLootBoxType(sheet.item?.system?.lootType);

/** A blank prize row of `kind`, every field typed. */
function blankBoxRow(kind, extra = {}) {
  return sanitizeBoxRow({ kind, ...extra });
}

const boxRows = (item) => toArray(item.system?.box?.contents).map((row) => sanitizeBoxRow({ ...row }) ?? blankBoxRow('item'));
const writeBoxRows = (item, rows) => item.update({ 'system.box.contents': rows });

/**
 * Replace the row at `index` with `rows` (zero or more, sanitized), in place, and write the box.
 * @param {object} item the box
 * @param {number} index
 * @param {object[]} rows
 * @returns {Promise<object[]|null>} the new rows, or null when `index` is not a row
 */
export async function replaceBoxRow(item, index, rows) {
  const all = boxRows(item);
  if (!Number.isInteger(index) || index < 0 || index >= all.length) return null;
  all.splice(index, 1, ...toArray(rows).map((r) => sanitizeBoxRow({ ...r })).filter(Boolean));
  await writeBoxRows(item, all);
  return all;
}

/** The fields an inline control may write, with how each is read. */
const ROW_FIELD_READERS = Object.freeze({
  // A choice row's candidate type: blank (any inventory item), an inventory type, or skill / spell (a potion / a tome)
  itemType: (v) => {
    const id = String(v ?? '').trim();
    return id === 'skill' || id === 'spell' || BOX_CHOICE_INVENTORY_TYPES.includes(id) ? id : '';
  },
  name: (v) => String(v ?? '').trim(),
  // A table row's rolled rows: as printed (''), skill potions or placeholder items
  as: (v) => (BOX_TABLE_AS.includes(String(v ?? '').trim()) ? String(v).trim() : ''),
  times: (v) => String(v ?? '').trim(),
  quantity: (v) => whole(v),
  formula: (v) => String(v ?? '').trim(),
  label: (v) => String(v ?? '').trim(),
  rank: (v) => (v === '' || v === null || v === undefined ? null : whole(v)),
  tier: (v) => {
    const id = String(v ?? '').trim().toLowerCase();
    return id && resolveLootBoxTier(id) === id ? id : '';
  }
});

/**
 * Add a prize row, or add one to the quantity of the same document already listed.
 * @param {object} item the box
 * @param {object} row a prize row (sanitized here)
 * @param {(a: object, b: object) => boolean} [same] whether `a` is the same prize as `b`
 */
async function addBoxRow(item, row, same = null) {
  const rows = boxRows(item);
  const mate = same ? rows.find((r) => same(r, row)) : null;
  if (mate) mate.quantity += 1;
  else rows.push(sanitizeBoxRow(row));
  await writeBoxRows(item, rows);
  return rows;
}

/**
 * A dropped Item becomes an `item` row, a spell a `spell` row (a Tome when opened). Dropping one already listed adds 1.
 * @returns {Promise<object[]|null>} the new rows, or null when nothing was written
 */
export async function dropBoxItem(box, doc) {
  if (!isGM()) return null;
  if (!doc?.name || (doc.uuid && doc.uuid === box.uuid)) return null;
  const spell = doc.type === 'spell';
  const row = {
    kind: spell ? 'spell' : 'item',
    uuid: String(doc.uuid ?? ''),
    identifier: itemIdentifier(doc),
    itemType: spell ? '' : String(doc.type ?? ''),
    name: String(doc.name),
    img: String(doc.img ?? ''),
    quantity: 1
  };
  const same = (a, b) => a.kind === b.kind && (b.uuid ? a.uuid === b.uuid : (b.identifier && a.identifier === b.identifier));
  return addBoxRow(box, row, same);
}

/** A dropped RollTable becomes a `table` row (looked up by its table key first, then its uuid). */
export async function dropBoxTable(box, table) {
  if (!isGM() || !table?.name) return null;
  const row = {
    kind: 'table',
    uuid: String(table.uuid ?? ''),
    tableKey: String(table.flags?.[SYSTEM_ID]?.tableKey ?? '').trim(),
    name: String(table.name),
    img: String(table.img ?? ''),
    quantity: 1
  };
  const same = (a, b) => a.kind === 'table' && (b.tableKey ? a.tableKey === b.tableKey : a.uuid === b.uuid);
  return addBoxRow(box, row, same);
}

// --- Pre-roll and Choose now (GM) -----------------------------------------------------------------------------------------

/** `flags.sprinter-rpg.folderKey` of the world folder that holds pre-rolled and chosen prizes. */
export const PREROLL_FOLDER_KEY = 'loot-box-prizes';
/** The world item flag naming the box a prize was rolled or chosen for. */
export const PREROLL_FLAG = 'lootBoxPreroll';

/** An `item` row pointing at a world document. */
function itemRowFor(doc, extra = {}) {
  return {
    kind: 'item',
    uuid: String(doc.uuid ?? ''),
    identifier: itemIdentifier(doc),
    itemType: String(doc.type ?? ''),
    name: String(doc.name ?? ''),
    img: String(doc.img ?? ''),
    quantity: 1,
    ...extra
  };
}

/** Create one prize document in the Loot Box Prizes world folder, flagged with the box it was made for. */
async function createPrizeItem(box, data) {
  const folder = await getOrCreateItemFolder(PREROLL_FOLDER_KEY, text('COG.LootBoxSheet.PrerollFolder'));
  const out = structuredClone(data ?? {});
  delete out._id;
  out.folder = folder?.id ?? null;
  const own = out.flags?.[SYSTEM_ID] ?? {};
  out.flags = {
    ...(out.flags ?? {}),
    [SYSTEM_ID]: { ...own, [PREROLL_FLAG]: { boxUuid: String(box.uuid ?? ''), boxName: String(box.name ?? ''), at: Date.now(), by: globalThis.game?.user?.id ?? '' } }
  };
  return globalThis.Item.create(out, { cogSystemMade: true });
}

/**
 * GM: roll a `magicItem` row now. Each unit becomes its own world item (folder "Loot Box Prizes"), and the row becomes
 * one `item` row per unit, in place. A generator error stops the roll: the units already made are kept and the rest
 * stays one `magicItem` row; with none made the row is left as it was and the GM is warned. A crawler's copy rolls
 * with that crawler as the actor (owned skills); a template has none.
 * @param {object} box the box (an Item)
 * @param {number} index the row
 * @param {{ roll?: Function }} [opts] `roll`: the generator (default `rollMagicItem`)
 * @returns {Promise<object[]|null>} the new rows, or null when nothing changed
 */
export async function prerollRow(box, index, { roll = rollMagicItem } = {}) {
  if (!isGM()) return null;
  const row = boxRows(box)[index];
  if (!row || row.kind !== 'magicItem') return null;
  const tier = row.tier || resolveLootBoxTier(box.system?.box?.tier);
  const actor = box.parent?.documentName === 'Actor' ? box.parent : null;
  const total = whole(row.quantity);
  const made = [];
  let failure = '';
  for (let i = 0; i < total; i += 1) {
    const result = await roll({ generator: row.generator || '', tier }, { actor });
    if (!result || result.error) { failure = result?.error ?? 'failed'; break; }
    for (const w of toArray(result.warnings)) warn(w);
    let doc = null;
    try { doc = await createPrizeItem(box, result.data); } catch (err) { console.warn('Sprinter RPG | Pre-roll could not create an item:', err); }
    if (!doc) { failure = 'failed'; break; }
    made.push(doc);
  }
  if (failure) {
    const key = failure === 'no-generator' ? 'NoGenerator' : (failure === 'no-tables' ? 'NoTables' : 'Failed');
    warn(boxText(`COG.LootBoxOpen.Generator.${key}`, { generator: row.generator || '', tier }));
  }
  if (!made.length) return null;
  // The row may have been edited while the generator ran; replace it only if it is still this row
  if (boxRows(box)[index]?.kind !== 'magicItem') return null;
  const rows = made.map((doc) => itemRowFor(doc, row.label ? { label: row.label } : {}));
  if (made.length < total) rows.push({ ...row, quantity: total - made.length });
  const written = await replaceBoxRow(box, index, rows);
  const data = { count: made.length, made: made.length, total, box: box.name ?? '' };
  if (made.length < total) warn(text('COG.LootBoxSheet.PrerollPartial', data));
  else info(text('COG.LootBoxSheet.PrerollDone', data));
  return written;
}

/**
 * GM: pick a `choice` row's prize now (the book's "choose" mode). The picker lists the same candidates the opener would
 * see. An item becomes an `item` row, a spell a `spell` row at the row's Rank, a skill a skill potion made in the Loot
 * Box Prizes folder (an `item` row). Cancel changes nothing.
 * @param {object} box the box (an Item)
 * @param {number} index the row
 * @param {{ pick?: Function }} [opts] `pick`: the picker (default `promptChoicePicks`)
 * @returns {Promise<object[]|null>} the new rows, or null when nothing changed
 */
export async function chooseRow(box, index, { pick = promptChoicePicks } = {}) {
  if (!isGM()) return null;
  const row = boxRows(box)[index];
  if (row?.kind === 'table' && row.as === 'skillPotion') return chooseTableHobby(box, index, row, { pick });
  if (!row || row.kind !== 'choice') return null;
  const itemType = String(row.itemType ?? '');
  const candidates = choiceCandidates({ query: row.query ?? null, itemType });
  if (!candidates.length) {
    warn(text('COG.LootBoxSheet.ChooseNowNone'));
    return null;
  }
  const key = '0';
  const picks = await pick({
    title: text('COG.LootBoxSheet.ChooseNowTitle'),
    intro: text('COG.LootBoxSheet.ChooseNowIntro', { box: box.name ?? '' }),
    entries: [{ key, label: row.label || row.name || text('COG.LootBoxSheet.ChooseNowLabel'), candidates: candidates.map((c) => ({ value: c.uuid, label: c.name || c.uuid })) }],
    confirmLabel: text('COG.LootBoxSheet.ChooseNowConfirm'),
    cancelLabel: text('COG.LootBoxSheet.ChooseNowCancel')
  });
  const chosen = candidates.find((c) => c.uuid === picks?.[key]);
  if (!chosen) return null;
  let next;
  if (itemType === 'spell') {
    next = { kind: 'spell', uuid: chosen.uuid, identifier: chosen.identifier, name: chosen.name, img: chosen.img, rank: row.rank ?? 1, ...(row.label ? { label: row.label } : {}) };
  } else if (itemType === 'skill') {
    const prize = boxOpenServices().skillPotionPrize({ name: chosen.name, identifier: chosen.identifier }, row.rank ?? 1, row.name || '');
    let doc = null;
    try { doc = await createPrizeItem(box, prize.data); } catch (err) { console.warn('Sprinter RPG | Choose now could not create the potion:', err); }
    if (!doc) {
      warn(text('COG.LootBoxSheet.ChooseNowFailed', { box: box.name ?? '' }));
      return null;
    }
    next = itemRowFor(doc, row.label ? { label: row.label } : {});
  } else {
    next = { kind: 'item', uuid: chosen.uuid, identifier: chosen.identifier, itemType: chosen.type, name: chosen.name, img: chosen.img, quantity: row.quantity ?? 1, ...(row.label ? { label: row.label } : {}) };
  }
  if (boxRows(box)[index]?.kind !== 'choice') return null;
  const written = await replaceBoxRow(box, index, [next]);
  info(text('COG.LootBoxSheet.ChooseNowDone', { name: chosen.name, box: box.name ?? '' }));
  return written;
}

/**
 * GM: pick the potion of an `as: skillPotion` table row now. The picker lists the table's entries and has a field to type a
 * name instead; the row becomes an `item` row for a skill potion of a custom Skill with that name, made in the Loot Box
 * Prizes folder. Cancel (or nothing picked and nothing typed) changes nothing.
 */
async function chooseTableHobby(box, index, row, { pick }) {
  const services = boxOpenServices();
  const snapshot = await services.loadTable({ key: row.tableKey, uuid: row.uuid });
  const names = [...new Set((snapshot?.rows ?? []).map((r) => tableRowEntry(r).entry).filter(Boolean))];
  const key = '0';
  const picks = await pick({
    title: text('COG.LootBoxSheet.ChooseNowTitle'),
    intro: text('COG.LootBoxSheet.ChooseNowIntro', { box: box.name ?? '' }),
    entries: [{
      key, label: row.label || text('COG.LootBoxSheet.ChooseNowTableEntry'),
      candidates: names.map((n) => ({ value: n, label: n })),
      freeText: { label: text('COG.LootBoxSheet.ChooseNowTypeLabel') }
    }],
    confirmLabel: text('COG.LootBoxSheet.ChooseNowConfirm'),
    cancelLabel: text('COG.LootBoxSheet.ChooseNowCancel')
  });
  const typed = String(picks?.[choiceTextKey(key)] ?? '').trim();
  const name = typed || (names.includes(picks?.[key]) ? picks[key] : '');
  if (!name) return null;
  const prize = services.customSkillPotionPrize(name, row.rank ?? 1, row.name || '');
  let doc = null;
  try { doc = await createPrizeItem(box, prize.data); } catch (err) { console.warn('Sprinter RPG | Choose now could not create the potion:', err); }
  if (!doc) {
    warn(text('COG.LootBoxSheet.ChooseNowFailed', { box: box.name ?? '' }));
    return null;
  }
  const now = boxRows(box)[index];
  if (now?.kind !== 'table' || now.as !== 'skillPotion') return null;
  const written = await replaceBoxRow(box, index, [itemRowFor(doc, row.label ? { label: row.label } : {})]);
  info(text('COG.LootBoxSheet.ChooseNowDone', { name, box: box.name ?? '' }));
  return written;
}

// --- the achievement's reward box rows ---------------------------------------------------------------------------------

const rewardRows = (item) => sanitizeRewardBoxes(toArray(item.system?.rewardBoxes).map((row) => ({ ...row })));
const canEditAchievement = (sheet) => Boolean(sheet?.isEditable) && sheet.item?.type === 'achievement';

/**
 * A dropped loot box on an achievement becomes a template reward row (same template again adds 1).
 * @returns {Promise<object[]|null>}
 */
export async function dropRewardBoxTemplate(achievement, doc) {
  if (achievement?.type !== 'achievement') return null;
  if (!isLootBoxType(doc?.system?.lootType)) {
    warn(text('COG.RewardBoxes.NotBox', { name: doc?.name ?? '' }));
    return null;
  }
  const rows = rewardRows(achievement);
  const uuid = String(doc.uuid ?? '');
  const identifier = itemIdentifier(doc);
  const mate = rows.find((r) => (uuid && r.uuid === uuid) || (!uuid && identifier && r.identifier === identifier));
  if (mate) mate.quantity += 1;
  else rows.push({ tier: resolveLootBoxTier(doc.system?.box?.tier), quantity: 1, uuid, identifier, name: String(doc.name ?? '') });
  await achievement.update({ 'system.rewardBoxes': rows });
  return rows;
}

export const LOOT_BOX_ACTIONS = {
  /** Add a gold row (the formula is typed in the row). */
  async addBoxGold() {
    if (!canFill(this)) return;
    await addBoxRow(this.item, blankBoxRow('gold', { formula: '10' }));
  },

  /** Add a generated magic item row; its tier select blank means this box's tier. */
  async addBoxMagicItem() {
    if (!canFill(this)) return;
    await addBoxRow(this.item, blankBoxRow('magicItem'));
  },

  /** Add a choice row: the opener picks one item (or a skill potion, or a spell tome) from a tag query. */
  async addBoxChoice() {
    if (!canFill(this)) return;
    await addBoxRow(this.item, blankBoxRow('choice', { itemType: '' }));
  },

  /** GM: roll a generated magic item row now; it becomes world item(s) the row points at. */
  async prerollBoxRow(event, target) {
    if (!canFill(this)) return;
    await prerollRow(this.item, rowIndex(target));
  },

  /** GM: pick a choice row's prize now; the row becomes that prize. */
  async chooseBoxRow(event, target) {
    if (!canFill(this)) return;
    await chooseRow(this.item, rowIndex(target));
  },

  /** change: the table picker adds a `table` row for the chosen roll table. */
  async addBoxTable(event, target) {
    if (!canFill(this)) return;
    const uuid = String(valueOf(target) ?? '');
    if (!uuid) return;
    const table = (await getAvailableRollTables({ packs: true })).find((t) => t.uuid === uuid);
    if (!table) return;
    await dropBoxTable(this.item, { uuid: table.uuid, name: table.name, img: table.img, flags: { [SYSTEM_ID]: { tableKey: table.key } } });
  },

  /** change: a `table` row's select points the row at another roll table. */
  async pickBoxTable(event, target) {
    if (!canFill(this)) return;
    const idx = rowIndex(target);
    const rows = boxRows(this.item);
    const row = rows[idx];
    const uuid = String(valueOf(target) ?? '');
    if (!row || row.kind !== 'table' || !uuid) return;
    const table = (await getAvailableRollTables({ packs: true })).find((t) => t.uuid === uuid);
    if (!table) return;
    // A hobby-potion row keeps its name stem; any other table row is named for its table
    Object.assign(row, { uuid: table.uuid, tableKey: table.key, img: table.img }, row.as === 'skillPotion' ? {} : { name: table.name });
    await writeBoxRows(this.item, rows);
  },

  /** change: an inline field of a prize row (`data-index`, `data-field`: quantity, formula, label, rank, tier, itemType, name). */
  async editBoxRow(event, target) {
    if (!canFill(this)) return;
    const field = String(target?.dataset?.field ?? '');
    if (!Object.hasOwn(ROW_FIELD_READERS, field)) return;
    const rows = boxRows(this.item);
    const row = rows[rowIndex(target)];
    if (!row) return;
    const next = ROW_FIELD_READERS[field](valueOf(target));
    // A table row's name is its table's until its rolls become something; then it is a potion's name stem (blank to start)
    if (field === 'as' && next && row.as !== next && row.kind === 'table') row.name = '';
    row[field] = next;
    await writeBoxRows(this.item, rows);
  },

  async removeBoxRow(event, target) {
    if (!canFill(this)) return;
    const rows = boxRows(this.item);
    const idx = rowIndex(target);
    if (idx < 0 || idx >= rows.length) return;
    rows.splice(idx, 1);
    await writeBoxRows(this.item, rows);
  },

  /** change: the GM checkbox "Keep sealed until filled" writes `system.box.whenEmpty` ('keep' or ''). */
  async toggleBoxKeepSealed(event, target) {
    if (!canFill(this)) return;
    await this.item.update({ 'system.box.whenEmpty': valueOf(target) === true ? 'keep' : '' });
  },

  /** Achievement: add a generic reward box row (Bronze, 1). */
  async addRewardBox() {
    if (!canEditAchievement(this)) return;
    await this.item.update({ 'system.rewardBoxes': [...rewardRows(this.item), { tier: 'bronze', quantity: 1, uuid: '', identifier: '', name: '' }] });
  },

  /** change: a reward row's tier or quantity (`data-index`, `data-field`). */
  async editRewardBox(event, target) {
    if (!canEditAchievement(this)) return;
    const field = String(target?.dataset?.field ?? '');
    const rows = rewardRows(this.item);
    const row = rows[rowIndex(target)];
    if (!row) return;
    if (field === 'quantity') row.quantity = whole(valueOf(target));
    else if (field === 'tier') row.tier = resolveLootBoxTier(valueOf(target));
    else return;
    await this.item.update({ 'system.rewardBoxes': rows });
  },

  async removeRewardBox(event, target) {
    if (!canEditAchievement(this)) return;
    const rows = rewardRows(this.item);
    const idx = rowIndex(target);
    if (idx < 0 || idx >= rows.length) return;
    rows.splice(idx, 1);
    await this.item.update({ 'system.rewardBoxes': rows });
  },

  /** Forget a row's template: it gives the generic box of its tier again. */
  async clearRewardBoxTemplate(event, target) {
    if (!canEditAchievement(this)) return;
    const rows = rewardRows(this.item);
    const row = rows[rowIndex(target)];
    if (!row) return;
    Object.assign(row, { uuid: '', identifier: '', name: '' });
    await this.item.update({ 'system.rewardBoxes': rows });
  },

  /**
   * GM: give the crawler that holds this trophy its reward boxes (the trophy arrived another way: dropped from a
   * compendium, made by hand). A second grant asks a Rule Break confirm and is recorded.
   */
  async grantRewardBoxes() {
    const achievement = this.item;
    const actor = achievement?.parent;
    if (!isGM() || achievement?.type !== 'achievement' || actor?.documentName !== 'Actor') return;
    const rows = rewardRows(achievement);
    if (!rows.length) return;
    let ruleBreak = false;
    if (achievement.flags?.[SYSTEM_ID]?.[REWARD_BOXES_FLAG]) {
      const res = await confirmRuleBreak({
        title: text('COG.RewardBoxes.GrantAgainTitle'),
        message: text('COG.RewardBoxes.GrantAgainMessage', { name: achievement.name, actor: actor.name })
      });
      if (!res.confirmed) return;
      ruleBreak = true;
    }
    const boxes = await grantLootBoxes(actor, rows, { sourceName: achievement.name });
    await achievement.setFlag(SYSTEM_ID, REWARD_BOXES_FLAG, { at: Date.now(), by: globalThis.game?.user?.id ?? '', ruleBreak });
    info(text('COG.RewardBoxes.Granted', { count: rows.reduce((sum, r) => sum + r.quantity, 0), actor: actor.name }));
    return boxes;
  }
};
