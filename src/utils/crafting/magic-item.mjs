/**
 * Sprinter RPG - the magic item generator, the pure part
 *
 * The book's procedure (Core pp. 219-220, Atlas pp. 26-27) as an algorithm, with the table reading left to
 * `src/documents/item/magic-item-roll.mjs`: an item type row names the base (a `magicBase` option) and its property
 * table (the row's `tableRef`); each rolled property row's `magic` option names a `CONFIG.COG.rowKinds.magicProperties`
 * kind, whose handler turns it into an enchantment template sized by the box tier. A row the kinds cannot finish is
 * recorded: a ledger entry with the row's own words, no rows and `pending: true`, for the GM to finish on the live sheet.
 * Every enchantment goes through `buildEnchantmentWrite` (method `loot-box`), the path the Floor Simulator's
 * `compileWeapon` uses; a generated item arrives made, so the over-enchanting 1d10 is never rolled.
 *
 * No Foundry globals and no text parsing: the row's words are carried as words, never read for meaning (GEMINI §2).
 */
import { SYSTEM_ID } from '../../constants.mjs';
import { buildEnchantmentWrite } from './crafting-engine.mjs';
import { upgradeTemplate, upgradedName } from './upgrade-table.mjs';
import { getRowKind } from '../row-kinds.mjs';
import { craftText } from './craft-text.mjs';
import { firstScalar } from '../first-scalar.mjs';
import { rngPick } from '../rng.mjs';
import { lootBoxTierDef } from '../../data/loot-box-tiers.mjs';
import { buildPayload } from '../../data/builders/item-payload.mjs';

/** The ledger `method` of every enchantment a generated item carries. */
export const MAGIC_ITEM_METHOD = 'loot-box';
/** The most property rolls a tier may ask for (the tier sanitizer's bound). */
const MAX_ROLLS = 10;
/** The most damage types a `magic` option lists (the recipe reader's bound). */
const MAX_DAMAGE_TYPES = 8;

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v) => {
  const val = firstScalar(v);
  return typeof val === 'string' ? val.trim() : (typeof val === 'number' ? String(val) : '');
};
/** Human words (a row's narrative, a label): trimmed, commas kept. */
const words = (v) => (typeof v === 'string' ? v.trim() : '');
const optionsOf = (row) => (Array.isArray(row?.options) ? row.options.filter(isPlain) : []);

/**
 * The tier's property roll count (0 when the tier has no magicItem block).
 * @param {object|string} tierDef a `lootBoxTierDef` entry (a tier id is resolved first)
 * @returns {number}
 */
export function magicItemRollCount(tierDef) {
  const def = isPlain(tierDef) ? tierDef : lootBoxTierDef(tierDef);
  const n = Number(def?.magicItem?.rolls);
  return Number.isInteger(n) && n > 0 ? Math.min(n, MAX_ROLLS) : 0;
}

/**
 * The magicBase option id of an item type row, '' when it has none.
 * @param {{ options?: object[] }|null} row a TableSnapshot row
 * @returns {string}
 */
export function magicBaseOf(row) {
  const option = optionsOf(row).find((o) => o.kind === 'magicBase');
  return option ? text(option.base).toLowerCase() : '';
}

/**
 * The first `magic` option of a property row, or null (the row is then recorded).
 * @param {{ options?: object[] }|null} row a TableSnapshot row
 * @returns {{ kind: 'magic', property: string, damageTypes: string[], label: string }|null}
 */
export function magicPropertyOf(row) {
  const option = optionsOf(row).find((o) => o.kind === 'magic');
  if (!option) return null;
  const types = Array.isArray(option.damageTypes) ? option.damageTypes : (text(option.damageTypes) ? [option.damageTypes] : []);
  return {
    kind: 'magic',
    property: text(option.property),
    damageTypes: types.map((t) => (typeof t === 'string' ? t.trim() : '')).filter(Boolean).slice(0, MAX_DAMAGE_TYPES),
    label: words(option.label)
  };
}

/**
 * The rolled row's own words: its narrative, else its custom options' labels. Carried, never parsed.
 * @param {{ narrative?: string, options?: object[] }|null} row
 * @returns {string}
 */
export function magicRowWords(row) {
  const narrative = words(row?.narrative);
  if (narrative) return narrative;
  return optionsOf(row).filter((o) => o.kind === 'custom').map((o) => words(o.label)).filter(Boolean).join(' ');
}

/**
 * The catalog items a base can be made from: those it `matches` that carry no enchantments yet.
 * @param {{ matches: Function }|null} baseDef
 * @param {object[]} entries item data (`catalogEntries('items')`)
 * @returns {object[]}
 */
export function magicBaseCandidates(baseDef, entries) {
  if (typeof baseDef?.matches !== 'function') return [];
  return (Array.isArray(entries) ? entries : []).filter((entry) => {
    if (!isPlain(entry)) return false;
    if (Array.isArray(entry.system?.enchantments) && entry.system.enchantments.length) return false;
    try {
      return baseDef.matches(entry) === true;
    } catch {
      return false;
    }
  });
}

/**
 * Pick the base: a structuredClone of a matching candidate (no _id, quantity 1), or the base's blank spec built with
 * buildPayload('gear'). With no base at all, a plain gear item.
 * @param {{ blank?: object }|null} baseDef
 * @param {object[]} candidates already filtered ({@link magicBaseCandidates})
 * @param {*} rng an injectable rng (`rng.mjs`)
 * @returns {{ data: object, fromCatalog: boolean }}
 */
export function pickMagicBase(baseDef, candidates, rng) {
  const pool = (Array.isArray(candidates) ? candidates : []).filter(isPlain);
  const picked = rngPick(rng, pool);
  if (picked) {
    const data = structuredClone(picked);
    delete data._id;
    delete data.id;
    data.system = { ...(isPlain(data.system) ? data.system : {}), quantity: 1 };
    return { data, fromCatalog: true };
  }
  const spec = isPlain(baseDef?.blank) ? structuredClone(baseDef.blank) : { name: 'COG.MagicItem.Base.unknown' };
  spec.name = craftText(text(spec.name) || 'COG.MagicItem.Base.unknown');
  spec.system = { ...(isPlain(spec.system) ? spec.system : {}), quantity: 1 };
  return { data: buildPayload('gear', spec, { warnings: [] }), fromCatalog: false };
}

/** The `{ key, total }` provenance of one roll. */
const rollRef = (r) => ({ key: text(r?.key), total: Number.isFinite(Number(r?.total)) && r?.total !== null ? Number(r.total) : null });

/**
 * THE row → item function. Folds every rolled property into the base with buildEnchantmentWrite (method 'loot-box'),
 * in roll order, renames with upgradedName when enchantedName, and stamps flags.sprinter-rpg.magicItem.
 * @param {{ generator: string, tier: string, base: { data: object }, typeRoll: object|null, propertyRolls: object[],
 *   unique: (object & { missed: number, via?: object })|null }} rolled Rolled = { key, name, total, row } (row is a
 *   TableSnapshot row); `unique.via` is the property roll that pointed at the unique table, kept for provenance
 * @param {object} ctx as for the magicProperties kinds (`tierDef` defaults to the rolled tier's)
 * @returns {{ data: object, lines: string[], pendingLines: number[], pending: number, warnings: string[] }} `data` is
 *   Item creation data; `pendingLines` are the indexes of the `lines` that are recorded entries (GM to finish)
 */
export function magicItemPayload(rolled, ctx = {}) {
  const warnings = [];
  const lines = [];
  const pendingLines = [];
  const tierDef = isPlain(ctx?.tierDef) ? ctx.tierDef : lootBoxTierDef(rolled?.tier);
  const data = structuredClone(isPlain(rolled?.base?.data) ? rolled.base.data : {});
  data.system = isPlain(data.system) ? data.system : {};
  const used = {
    stats: ctx?.used?.stats instanceof Set ? ctx.used.stats : new Set(),
    skills: ctx?.used?.skills instanceof Set ? ctx.used.skills : new Set()
  };
  const kindCtx = { ...ctx, tierDef, used };

  const write = (template, pending) => {
    const written = buildEnchantmentWrite(data.system, template, { method: MAGIC_ITEM_METHOD });
    for (const [key, value] of Object.entries(written.update)) {
      if (key.startsWith('system.')) data.system[key.slice('system.'.length)] = value;
    }
    if (pending) {
      const list = data.system.enchantments;
      list[list.length - 1] = { ...list[list.length - 1], pending: true };
    }
  };
  const record = (label, lineKey = 'COG.MagicItem.Pending', extra = {}) => {
    const template = upgradeTemplate({ kind: 'record', label });
    write(template, true);
    pendingLines.push(lines.push(craftText(lineKey, { words: template.label, ...extra })) - 1);
  };

  for (const roll of Array.isArray(rolled?.propertyRolls) ? rolled.propertyRolls : []) {
    const row = roll?.row;
    if (!isPlain(row)) continue;
    const rowWords = magicRowWords(row);
    const option = magicPropertyOf(row);
    if (!option) { record(rowWords); continue; }
    const def = option.property ? getRowKind('magicProperties', option.property) : null;
    if (typeof def?.apply?.magicItem !== 'function') {
      warnings.push(craftText('COG.MagicItem.Warn.UnknownProperty', { kind: option.property || '""' }));
      record(rowWords);
      continue;
    }
    let result = null;
    try {
      result = def.apply.magicItem(option, { ...kindCtx, rowWords });
    } catch (err) {
      warnings.push(craftText('COG.MagicItem.Warn.PropertyFailed', { kind: option.property }));
      console.warn(`Sprinter RPG | magic property "${option.property}" threw:`, err);
    }
    if (!isPlain(result?.template)) { record(rowWords); continue; }
    write(result.template, false);
    lines.push(words(result.line) || words(result.template.label));
  }

  const unique = isPlain(rolled?.unique) ? rolled.unique : null;
  const missed = unique ? Math.max(0, Math.trunc(Number(unique.missed) || 0)) : 0;
  if (unique) record(magicRowWords(unique.row) || words(unique.name), 'COG.MagicItem.Unique', { missed });

  // An item that gained nothing (no applied or recorded entry) keeps its plain name.
  if (tierDef?.magicItem?.enchantedName && lines.length) data.name = upgradedName(data.name, craftText('COG.MagicItem.EnchantedPrefix'));

  const rolls = [rolled?.typeRoll, ...(Array.isArray(rolled?.propertyRolls) ? rolled.propertyRolls : []), unique?.via, unique]
    .filter(isPlain).map(rollRef);
  data.flags = isPlain(data.flags) ? data.flags : {};
  data.flags[SYSTEM_ID] = {
    ...(isPlain(data.flags[SYSTEM_ID]) ? data.flags[SYSTEM_ID] : {}),
    magicItem: { generator: text(rolled?.generator), tier: tierDef?.id ?? text(rolled?.tier), rolls, missed }
  };
  const pending = (Array.isArray(data.system.enchantments) ? data.system.enchantments : []).filter((e) => e?.pending === true).length;
  return { data, lines, pendingLines, pending, warnings };
}
