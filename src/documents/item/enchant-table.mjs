/**
 * Sprinter RPG - an `enchant_item` outcome that rolls a table (Scroll of Upgrade)
 *
 * The outcome names a roll table (by `tableKey`, else by uuid). On Use the table is found, rolled with a Foundry `Roll`
 * (not `RollTable#draw`: a scroll wants no card of its own and no draw-without-replacement), and the rolled row's
 * choices are offered: each Amazing Success trigger, then "Record only". After the roll there is no Cancel: the dialog
 * picks the trigger and the new name, and closing it takes the first choice. The only ways back out are the item's own
 * Rule Break confirms (a second trigger, a non-weapon target); refusing one keeps the unit (the caller's F3 rule).
 */
import { escapeAttr } from '../../utils/escape-attr.mjs';
import { craftText } from '../../utils/crafting/craft-text.mjs';
import { confirmRuleBreak } from '../../utils/rule-break.mjs';
import { ruleBreakBadgeHtml } from '../../utils/rule-break-visibility.mjs';
import { outcomeEnchantTable } from '../../utils/loot/outcome-defaults.mjs';
import { upgradeChoices, upgradeTemplate, upgradedName } from '../../utils/crafting/upgrade-table.mjs';
import { isWeaponGear } from '../../utils/gear/wielding.mjs';
import { contentRegistry } from '../../content/registry.mjs';
import { findFloorTableData, foundryFloorTableSources, rowForTotal, tableSnapshotFromRollTable } from '../../data/floor-simulator/tables.mjs';
import { applyEnchantment } from './enchantments.mjs';

/** Pack category of the imported book tables (Sourcery). */
const IMPORTED_TABLE_CATEGORY = 'sourceryTables';

/**
 * Where a table key is looked up: the world's tables, then the Floor Simulator table packs, then the imported table
 * packs, in priority order.
 * @param {object} [registry]
 */
export function enchantTableSources(registry = contentRegistry) {
  const base = foundryFloorTableSources(registry);
  const imported = typeof registry.getPacksForKind === 'function' ? registry.getPacksForKind(IMPORTED_TABLE_CATEGORY) : [];
  return { world: base.world, packs: [...base.packs, ...imported.map((p) => ({ packId: p.packId, pack: p.pack }))] };
}

/**
 * The outcome's table as a TableSnapshot: by key first (a GM's world copy wins over packs), else by uuid; null when
 * neither resolves.
 * @param {{ key?: string, uuid?: string }} ref
 * @param {{ sources?: object, resolveUuid?: Function }} [opts]
 */
export async function loadEnchantTable(ref, { sources, resolveUuid } = {}) {
  const key = typeof ref?.key === 'string' ? ref.key.trim() : '';
  const uuid = typeof ref?.uuid === 'string' ? ref.uuid.trim() : '';
  if (key) {
    const found = await findFloorTableData(key, sources ?? enchantTableSources());
    if (found) return { ...tableSnapshotFromRollTable(found.data, { resolveUuid }), key };
  }
  if (uuid && typeof globalThis.fromUuid === 'function') {
    try {
      const doc = await globalThis.fromUuid(uuid);
      if (doc) return tableSnapshotFromRollTable(typeof doc.toObject === 'function' ? doc.toObject() : doc, { resolveUuid });
    } catch (err) {
      console.warn(`Sprinter RPG | Could not read roll table ${uuid}:`, err);
    }
  }
  return null;
}

/**
 * Roll the table's formula and find the row. A table with no formula rolls one die as wide as its last range.
 * @param {{ formula?: string, rows?: Array<{ range: number[] }> }} snapshot
 * @returns {Promise<{ total: number, formula: string, row: object|null }>}
 */
export async function rollEnchantTable(snapshot) {
  const widest = Math.max(1, ...(snapshot?.rows ?? []).map((r) => Number(r?.range?.[1]) || 1));
  const formula = (typeof snapshot?.formula === 'string' && snapshot.formula.trim()) || `1d${widest}`;
  const roll = await new Roll(formula).evaluate();
  const total = Number(roll.total);
  return { total, formula, row: rowForTotal(snapshot, total) };
}

/**
 * The trigger (or "Record only") and the new name. Always answers: a closed dialog, a missing dialog API and
 * `interactive: false` all take the first choice with the prefilled name.
 * @param {Item} target
 * @param {{ total: number, formula: string, row: object }} rolled
 * @param {string} tableName
 * @param {{ interactive?: boolean }} [opts]
 * @returns {Promise<{ choice: object, name: string }>}
 */
export async function chooseUpgrade(target, rolled, tableName, { interactive = true } = {}) {
  const choices = upgradeChoices(rolled.row);
  const nameFor = (choice) => upgradedName(target.name, choice.nameAddition);
  const fallback = { choice: choices[0], name: nameFor(choices[0]) };
  const DialogV2 = globalThis.foundry?.applications?.api?.DialogV2;
  if (!interactive || typeof DialogV2?.prompt !== 'function') return fallback;

  const options = choices.map((c, i) => {
    const label = c.kind === 'record' ? craftText('COG.EnchantTable.Record') : (c.label || craftText('COG.Upgrade.TriggerLabel'));
    return `<option value="${i}">${escapeAttr(label)}</option>`;
  }).join('');
  const narrative = rolled.row?.narrative ? `<p>${escapeAttr(rolled.row.narrative)}</p>` : '';
  const content = `<p>${escapeAttr(craftText('COG.EnchantTable.Rolled', { total: rolled.total, formula: rolled.formula }))}</p>${narrative}`
    + `<div class="form-group"><label>${escapeAttr(craftText('COG.EnchantTable.Choice'))}</label><select name="choice">${options}</select></div>`
    + `<div class="form-group"><label>${escapeAttr(craftText('COG.EnchantTable.NewName'))}</label><input type="text" name="newName" value="${escapeAttr(fallback.name)}" /></div>`;
  let answer;
  try {
    answer = await DialogV2.prompt({
      window: { title: craftText('COG.EnchantTable.Title', { table: tableName }) },
      content,
      ok: {
        label: craftText('COG.EnchantTable.Apply'),
        callback: (event, button) => ({ index: button.form?.elements?.choice?.value, name: button.form?.elements?.newName?.value })
      },
      rejectClose: false,
      modal: true
    });
  } catch {
    answer = null;
  }
  const index = Number.parseInt(answer?.index, 10);
  const choice = choices[Number.isInteger(index) ? index : -1] ?? choices[0];
  const typed = typeof answer?.name === 'string' ? answer.name.trim() : '';
  // The prefilled name belongs to the first choice; a different choice with an untouched name gets its own addition.
  const name = !typed || typed === fallback.name ? nameFor(choice) : typed;
  return { choice, name };
}

/**
 * Run the table half of an `enchant_item` outcome on the chosen item.
 * @param {object} outcome the outcome row
 * @param {Item|null} target
 * @param {{ interactive?: boolean, sources?: object, bonusLevel?: number }} [opts]
 * @returns {Promise<{ attempted: boolean, applied: boolean, destroyed: boolean, line: string }>} `line` is card HTML
 */
export async function applyEnchantTableOutcome(outcome, target, { interactive = true, sources, bonusLevel = 1 } = {}) {
  const ref = outcomeEnchantTable(outcome);
  const none = { attempted: false, applied: false, destroyed: false, line: '' };
  if (!ref) return none;
  const tableLabel = ref.name || ref.key || ref.uuid;
  if (!target) return { ...none, attempted: true, line: `${escapeAttr(tableLabel)}: no item chosen.` };

  const snapshot = await loadEnchantTable(ref, { sources });
  if (!snapshot) {
    globalThis.ui?.notifications?.warn?.(craftText('COG.EnchantTable.NotFound', { name: tableLabel }));
    return { ...none, attempted: true, line: escapeAttr(craftText('COG.EnchantTable.NotFound', { name: tableLabel })) };
  }
  const table = snapshot.name || tableLabel;
  const rolled = await rollEnchantTable(snapshot);
  if (!rolled.row) {
    return { ...none, attempted: true, line: escapeAttr(craftText('COG.EnchantTable.NoRow', { table, total: rolled.total })) };
  }

  const rolledText = escapeAttr(craftText('COG.EnchantTable.Rolled', { total: rolled.total, formula: rolled.formula }));
  const { choice, name } = await chooseUpgrade(target, rolled, table, { interactive });
  const label = choice.kind === 'record' ? craftText('COG.EnchantTable.Record') : choice.label;
  const itemName = target.name;
  let ruleBreak = false;
  if (choice.kind === 'trigger' && !isWeaponGear(target)) {
    const res = await confirmRuleBreak({
      title: craftText('COG.EnchantTable.NotWeaponTitle'),
      message: craftText('COG.EnchantTable.NotWeapon', { item: target.name }),
      options: { interactive }
    });
    if (!res.confirmed) return { ...none, attempted: true, line: `${rolledText}: ${escapeAttr(label)}, not applied` };
    ruleBreak = true;
  }
  const res = await applyEnchantment(target, upgradeTemplate(choice, { bonusLevel }), {
    method: 'outcome', tags: choice.kind === 'trigger' ? choice.extraTags : [], name, ruleBreak, interactive
  });
  const head = res.destroyed
    ? `${escapeAttr(itemName)} broke permanently!`
    : (res.applied
      ? escapeAttr(craftText('COG.EnchantTable.CardLine', { table, total: rolled.total, label, item: itemName }))
      : `${rolledText}: ${escapeAttr(label)}, not applied`);
  const narrative = rolled.row.narrative ? `<br><em>${escapeAttr(rolled.row.narrative)}</em>` : '';
  return {
    attempted: true, applied: res.applied, destroyed: res.destroyed,
    line: `${head}${res.applied && res.ruleBreak ? ` ${ruleBreakBadgeHtml()}` : ''}${narrative}`
  };
}
