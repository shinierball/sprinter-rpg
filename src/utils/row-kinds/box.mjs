/** Core kinds of `boxContents` (the prizes of a loot box), registered at import. */
import { SYSTEM_ID } from '../../constants.mjs';
import { registerCoreKind } from './registry.mjs';

// --- boxContents (discriminator `kind`; 7.3a descriptors, 7.3c handlers) ---------------------------------------------

/**
 * The prizes of a loot box. `apply.boxOpen(acc, row, ctx)` is async (it reads documents and rolls tables) and runs on the
 * GM client inside the open engine (`loot-box-open.mjs`), which awaits it and catches a throw. It never writes: it pushes
 * prizes onto `acc.prizes` and GM warnings onto `acc.warnings`, and returns false when the row gave nothing.
 * This module stays a leaf, so every read goes through `ctx.services`, the same services a module's own kind gets:
 *   resolveDocument({ uuid, identifier }, type) -> plain data | null    itemPrizes(data, quantity) -> prize[]
 *   tomePrize(spell, rank) -> prize      rollGold(formula) -> number | null      loadTable({ key, uuid }) -> snapshot | null
 *   followTableRef(uuid) -> snapshot | null      rollTable(snapshot) -> { total, row }
 *   rollMagicItem({ generator, tier }) -> rollMagicItem's result      text(key, data) -> string
 *   choiceCandidates({ query, itemType }) -> [{ uuid, identifier, name, img, type }]      skillPotionPrize(skill, ranks, stem) -> prize
 * `boxChoose(row, ctx)` is sync and pure (no writes, no rolls): `{ label, itemType, rank, candidates } | null`. The opener's
 * answer reaches `boxOpen` as `ctx.choice = { uuid }`.
 * ctx: { actor, box: { itemId, name, tier }, tierDef, depth, services }.
 * Prizes: { type: 'item', data, name, img, quantity, label, lines, pending, generated } | { type: 'gold', amount, label }
 *   | { type: 'line', text, notice }  (a narrative line; `notice` marks something that went wrong, shown to everyone).
 */

/** How deep a table row may follow `tableRef` links: the box's own table is depth 1. */
const BOX_TABLE_DEPTH_LIMIT = 3;

const svc = (ctx) => ctx?.services ?? {};
const say = (ctx, key, data) => (typeof svc(ctx).text === 'function' ? svc(ctx).text(key, data) : key);
const withLabel = (prize, label) => (label ? { ...prize, label } : prize);

/** A missing prize: a GM warning and a notice line on the reveal. */
function missingPrize(acc, ctx, key, data) {
  const text = say(ctx, key, data);
  acc.warnings.push(text);
  acc.prizes.push({ type: 'line', text, notice: true });
  return false;
}

/**
 * What a rolled table row is called and says, from its own cells: the first column (`name`) is the entry and the rest its
 * description; a one-column row is the entry alone, and a row of only options reads its first option's label.
 * @param {{ name?: string, narrative?: string, options?: object[] }} row a TableSnapshot row
 * @returns {{ entry: string, description: string }}
 */
export function tableRowEntry(row) {
  const name = typeof row?.name === 'string' ? row.name.trim() : '';
  const narrative = typeof row?.narrative === 'string' ? row.narrative.trim() : '';
  if (name) return { entry: name, description: narrative };
  if (narrative) return { entry: narrative, description: '' };
  const option = (Array.isArray(row?.options) ? row.options : []).find((o) => typeof o?.label === 'string' && o.label.trim());
  return { entry: option ? option.label.trim() : '', description: '' };
}

/** The most rolls a table row's `times` formula may ask for. */
const BOX_TABLE_TIMES_CAP = 50;

/** Whether a rolled `named` / `spell` option is a spell. */
const isSpellOption = (option) => option?.kind === 'spell' || option?.docKind === 'spell';

/**
 * Roll a table snapshot once and push what the rolled row gives: its narrative as a line, document options as item or
 * spell (Tome) prizes, `gold` options as gold, any other option's label as a line, and its `tableRef` followed while
 * `depth` is under `BOX_TABLE_DEPTH_LIMIT`. Shared by the `table` kind and any module kind that rolls a table.
 * @param {{ prizes: object[], warnings: string[] }} acc
 * @param {object} snapshot a TableSnapshot
 * @param {object} ctx the boxOpen ctx
 * @param {number} [depth=1]
 * @returns {Promise<boolean>} whether the roll gave a row
 */
async function rollBoxTableInto(acc, snapshot, ctx, depth = 1, as = null) {
  const services = svc(ctx);
  const tableName = snapshot?.name || snapshot?.key || '';
  const rolled = await services.rollTable(snapshot);
  const row = rolled?.row;
  if (!row) return missingPrize(acc, ctx, 'COG.LootBoxOpen.TableNoRow', { table: tableName, total: rolled?.total ?? '' });
  if (as?.as === 'skillPotion' || as?.as === 'item') {
    // The rolled row's own cells: its entry (first column) is the name, its other cells the description
    const { entry, description } = tableRowEntry(row);
    if (!entry) return missingPrize(acc, ctx, 'COG.LootBoxOpen.TableNoRow', { table: tableName, total: rolled?.total ?? '' });
    const prize = as.as === 'skillPotion'
      ? services.customSkillPotionPrize(entry, as.rank ?? 1, as.stem || '')
      : services.placeholderItemPrize(as.label ? `${as.label}: ${entry}` : entry, description);
    acc.prizes.push(as.as === 'skillPotion' ? withLabel(prize, as.label) : prize);
    return true;
  }
  if (row.narrative) acc.prizes.push({ type: 'line', text: row.narrative, notice: false });
  for (const option of Array.isArray(row.options) ? row.options : []) {
    if (option?.kind === 'named' || option?.kind === 'spell') {
      const spell = isSpellOption(option);
      const doc = await services.resolveDocument({ uuid: option.uuid, identifier: option.identifier }, spell ? 'spell' : (option.docKind || ''));
      const name = option.name || option.identifier || option.uuid || '';
      if (!doc) {
        missingPrize(acc, ctx, 'COG.LootBoxOpen.PrizeMissing', { name });
        continue;
      }
      if (spell) acc.prizes.push(services.tomePrize(doc, option.rank ?? 1));
      else acc.prizes.push(...services.itemPrizes(doc, Number(option.quantity) || 1));
    } else if (option?.kind === 'gold') {
      const amount = await services.rollGold(option.formula);
      if (amount === null) missingPrize(acc, ctx, 'COG.LootBoxOpen.BadFormula', { formula: option.formula ?? '' });
      else acc.prizes.push(withLabel({ type: 'gold', amount }, option.label || ''));
    } else {
      const text = typeof option?.label === 'string' ? option.label.trim() : '';
      if (text) acc.prizes.push({ type: 'line', text, notice: false });
    }
  }
  if (row.tableRef) {
    if (depth >= BOX_TABLE_DEPTH_LIMIT) {
      missingPrize(acc, ctx, 'COG.LootBoxOpen.TableTooDeep', { table: tableName, depth: BOX_TABLE_DEPTH_LIMIT });
    } else {
      const next = await services.followTableRef(row.tableRef);
      if (next) await rollBoxTableInto(acc, next, ctx, depth + 1);
      else missingPrize(acc, ctx, 'COG.LootBoxOpen.TableMissing', { table: row.tableRef });
    }
  }
  return true;
}

/** The `method` of the enchantment entries a generated magic item carries (`MAGIC_ITEM_METHOD` in `magic-item.mjs`). */
const GENERATED_METHOD = 'loot-box';

/**
 * A prize whose document carries the `magicItem` flag (a Pre-rolled item) is a generated prize: it gets the ledger labels as
 * `lines`, the indexes of its still-pending entries as `pendingLines` and their count as `pending`, exactly as an item
 * generated at open time does. Any other prize is returned as it is.
 */
function generatedMarks(prize) {
  const data = prize?.data;
  const flag = data?.flags?.[SYSTEM_ID]?.magicItem;
  if (!flag || typeof flag !== 'object' || Array.isArray(flag)) return prize;
  const entries = (Array.isArray(data.system?.enchantments) ? data.system.enchantments : [])
    .filter((e) => e && typeof e === 'object' && e.method === GENERATED_METHOD);
  const pendingLines = [];
  entries.forEach((e, i) => { if (e.pending === true) pendingLines.push(i); });
  return { ...prize, generated: true, lines: entries.map((e) => String(e.label ?? '')), pendingLines, pending: pendingLines.length };
}

registerCoreKind('boxContents', {
  id: 'item',
  label: 'COG.Rows.Kind.BoxContents.item.Label',
  hint: 'COG.Rows.Kind.BoxContents.item.Hint',
  fields: ['uuid', 'identifier', 'itemType', 'name', 'img', 'quantity', 'label'],
  apply: {
    // The document by uuid, else by identifier through the catalogs; `quantity` units of it
    async boxOpen(acc, row, ctx) {
      const doc = await svc(ctx).resolveDocument({ uuid: row.uuid, identifier: row.identifier }, row.itemType || '');
      if (!doc) return missingPrize(acc, ctx, 'COG.LootBoxOpen.PrizeMissing', { name: row.name || row.identifier || row.uuid });
      acc.prizes.push(...svc(ctx).itemPrizes(doc, row.quantity).map((p) => generatedMarks(withLabel(p, row.label))));
    }
  }
});

registerCoreKind('boxContents', {
  id: 'spell',
  label: 'COG.Rows.Kind.BoxContents.spell.Label',
  hint: 'COG.Rows.Kind.BoxContents.spell.Hint',
  fields: ['uuid', 'identifier', 'name', 'rank', 'label'],
  apply: {
    // A Tome of the spell at the row's Rank (537 a), read later through its learn_spell outcome
    async boxOpen(acc, row, ctx) {
      const doc = await svc(ctx).resolveDocument({ uuid: row.uuid, identifier: row.identifier }, 'spell');
      if (!doc) return missingPrize(acc, ctx, 'COG.LootBoxOpen.PrizeMissing', { name: row.name || row.identifier || row.uuid });
      acc.prizes.push(withLabel(svc(ctx).tomePrize(doc, row.rank ?? 1), row.label));
    }
  }
});

registerCoreKind('boxContents', {
  id: 'gold',
  label: 'COG.Rows.Kind.BoxContents.gold.Label',
  hint: 'COG.Rows.Kind.BoxContents.gold.Hint',
  fields: ['formula', 'label'],
  apply: {
    // An integer or a Roll formula, floored at 0, added to the opener's gold
    async boxOpen(acc, row, ctx) {
      const amount = await svc(ctx).rollGold(row.formula);
      if (amount === null) return missingPrize(acc, ctx, 'COG.LootBoxOpen.BadFormula', { formula: row.formula });
      acc.prizes.push(withLabel({ type: 'gold', amount }, row.label));
    }
  }
});

registerCoreKind('boxContents', {
  id: 'table',
  label: 'COG.Rows.Kind.BoxContents.table.Label',
  hint: 'COG.Rows.Kind.BoxContents.table.Hint',
  fields: ['tableKey', 'uuid', 'formula', 'quantity', 'times', 'as', 'rank', 'name', 'label'],
  apply: {
    // The table by key (a world copy wins), else by uuid; rolled `quantity` times (its own formula unless the row names one)
    async boxOpen(acc, row, ctx) {
      const snapshot = await svc(ctx).loadTable({ key: row.tableKey, uuid: row.uuid });
      if (!snapshot) return missingPrize(acc, ctx, 'COG.LootBoxOpen.TableMissing', { table: row.label || row.name || row.tableKey || row.uuid });
      const table = row.formula ? { ...snapshot, formula: row.formula } : snapshot;
      let times = Math.max(1, Math.trunc(Number(row.quantity)) || 1);
      if (row.times) {
        const rolledTimes = await svc(ctx).rollGold(row.times);
        if (rolledTimes === null) return missingPrize(acc, ctx, 'COG.LootBoxOpen.BadFormula', { formula: row.times });
        times = Math.min(rolledTimes, BOX_TABLE_TIMES_CAP);
      }
      const as = row.as === 'skillPotion' || row.as === 'item' ? { as: row.as, rank: row.rank, stem: row.name || '', label: row.label || '' } : null;
      for (let i = 0; i < times; i += 1) await rollBoxTableInto(acc, table, ctx, Math.max(1, Number(ctx?.depth) || 1), as);
    }
  }
});

registerCoreKind('boxContents', {
  id: 'magicItem',
  label: 'COG.Rows.Kind.BoxContents.magicItem.Label',
  hint: 'COG.Rows.Kind.BoxContents.magicItem.Hint',
  fields: ['generator', 'tier', 'quantity', 'label'],
  apply: {
    // `quantity` independent generated items; `tier` '' is the box's tier, `generator` '' the tier's
    async boxOpen(acc, row, ctx) {
      const tier = row.tier || ctx?.box?.tier || '';
      const times = Math.max(1, Math.trunc(Number(row.quantity)) || 1);
      let gave = false;
      for (let i = 0; i < times; i += 1) {
        const result = await svc(ctx).rollMagicItem({ generator: row.generator || '', tier });
        if (!result || result.error) {
          missingPrize(acc, ctx, `COG.LootBoxOpen.Generator.${result?.error === 'no-generator' ? 'NoGenerator' : (result?.error === 'no-tables' ? 'NoTables' : 'Failed')}`,
            { generator: row.generator || ctx?.tierDef?.generator || '', tier });
          continue;
        }
        for (const w of result.warnings ?? []) acc.warnings.push(w);
        const data = result.data ?? {};
        acc.prizes.push(withLabel({
          type: 'item', data, name: data.name ?? '', img: data.img ?? '', quantity: 1,
          lines: Array.isArray(result.lines) ? [...result.lines] : [],
          pendingLines: Array.isArray(result.pendingLines) ? [...result.pendingLines] : [],
          pending: Number(result.pending) || 0, generated: true
        }, row.label));
        gave = true;
      }
      return gave;
    }
  }
});

/** The item types a `choice` row with no `itemType` may offer and give: the ones that sit in an inventory. */
export const BOX_CHOICE_INVENTORY_TYPES = Object.freeze(['gear', 'loot']);

registerCoreKind('boxContents', {
  id: 'choice',
  label: 'COG.Rows.Kind.BoxContents.choice.Label',
  hint: 'COG.Rows.Kind.BoxContents.choice.Hint',
  fields: ['itemType', 'query', 'quantity', 'rank', 'name', 'label'],
  apply: {
    // The opener picks one candidate of the tag query before the open (a two-pass open, 7.3i-2)
    boxChoose(row, ctx) {
      const itemType = String(row?.itemType ?? '');
      const candidates = svc(ctx).choiceCandidates?.({ query: row?.query ?? null, itemType }) ?? [];
      return { label: row?.label || row?.name || '', itemType, rank: row?.rank ?? 1, candidates };
    },
    // `itemType` decides the prize: a spell gives a Tome at `rank`, a skill a skill potion of `rank` Ranks, anything else
    // the picked item itself (`quantity` units). `ctx.choice.uuid` is the pick.
    async boxOpen(acc, row, ctx) {
      const uuid = typeof ctx?.choice?.uuid === 'string' ? ctx.choice.uuid.trim() : '';
      if (!uuid) return missingPrize(acc, ctx, 'COG.LootBoxOpen.ChoiceNoPick', { name: row.label || row.name || '' });
      const type = String(row.itemType ?? '');
      const doc = await svc(ctx).resolveDocument({ uuid }, type);
      if (!doc) return missingPrize(acc, ctx, 'COG.LootBoxOpen.PrizeMissing', { name: uuid });
      if (type === 'spell' || type === 'skill') {
        if (doc.type !== type) return missingPrize(acc, ctx, 'COG.LootBoxOpen.ChoiceWrongType', { name: doc.name ?? uuid, type });
        const prize = type === 'spell' ? svc(ctx).tomePrize(doc, row.rank ?? 1) : svc(ctx).skillPotionPrize(doc, row.rank ?? 1, row.name || '');
        acc.prizes.push({ ...withLabel(prize, row.label), chosen: true });
        return true;
      }
      const allowed = type ? [type] : BOX_CHOICE_INVENTORY_TYPES;
      if (!allowed.includes(doc.type)) return missingPrize(acc, ctx, 'COG.LootBoxOpen.ChoiceWrongType', { name: doc.name ?? uuid, type: type || 'gear, loot' });
      acc.prizes.push(...svc(ctx).itemPrizes(doc, row.quantity).map((p) => ({ ...withLabel(p, row.label), chosen: true })));
      return true;
    }
  }
});
