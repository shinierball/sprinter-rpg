/**
 * The one reader for what an item outcome row means when a field is blank (loot, gear abilities and tomes).
 *
 * The model (`normalizeOutcome`), the executor (`resolveSingleOutcome`, `learnSpellFromTome`) and the item summary
 * all read through here, so an edge row ("heal" with no `healBars`, a restore with `amount: 0`) reads and plays the
 * same everywhere. Pure functions over the row; nothing is stored.
 */
import { slugifyIdentifier } from '../identifier.mjs';

/** Health Bars a heal or heal-over-time outcome restores (`healBars`, else the `bars` alias); 1 when blank. */
export function outcomeHealBars(out) {
  return Math.floor(Number(out?.healBars) || Number(out?.bars)) || 1;
}

/** Rounds a heal-over-time outcome lasts; 3 when blank. */
export function outcomeRounds(out) {
  return Math.floor(Number(out?.rounds)) || 3;
}

/** Ranks a skill_rank outcome adds; 1 when blank. */
export function outcomeRankBonus(out) {
  return Math.floor(Number(out?.rankBonus)) || 1;
}

/** Rank a learn_spell outcome teaches the spell at; at least 1. */
export function outcomeLearnRank(out) {
  return Math.max(1, Math.floor(Number(out?.rank)) || 1);
}

/** Points a stat_permanent outcome adds (negative values allowed); 1 when blank. */
export function outcomeStatValue(out) {
  return Number(out?.value) || 1;
}

/** Mana restored when a restore outcome names no usable amount. */
export const DEFAULT_RESTORE_AMOUNT = 10;

/**
 * A restore outcome as `{ full, amount }`. It refills the pool when `mode` is "full" or no amount is set (`amount`,
 * else the `value` alias: undefined, null, '' or "full"); otherwise it restores `amount`, and an amount that is zero
 * or not a number restores {@link DEFAULT_RESTORE_AMOUNT}.
 * @param {object} out
 * @returns {{ full: boolean, amount: number }}
 */
export function outcomeRestore(out) {
  const raw = out?.amount ?? out?.value;
  const unset = raw === undefined || raw === null || (typeof raw === 'string' && (raw.trim() === '' || raw.trim().toLowerCase() === 'full'));
  if (out?.mode === 'full' || unset) return { full: true, amount: 0 };
  return { full: false, amount: Number(raw) || DEFAULT_RESTORE_AMOUNT };
}

/** The loot outcome type that enchants one of the user's equipped items when the item is used (3.15, crafting-system.md 5.2). */
export const ENCHANT_ITEM_OUTCOME = 'enchant_item';

/** The row arrays an enchantment writes into, and a template carries under `rows`. The one list (crafting-engine re-exports it). */
export const ENCHANTMENT_ROW_ARRAYS = Object.freeze(['grants', 'damageModifiers', 'defenseModifiers', 'attackModifiers', 'checkModifiers', 'asTriggers']);

const plain = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const cleanString = (v) => {
  let val = v ?? '';
  if (Array.isArray(val)) val = val[0] ?? '';
  return String(val ?? '').trim();
};
const cleanList = (v) => (Array.isArray(v) ? v.map(cleanString).filter(Boolean) : []);

/** A tag query as `{ all, any, none }` string lists, or null when the input is not an object. */
function cleanQuery(raw) {
  const q = plain(raw);
  return q ? { all: cleanList(q.all), any: cleanList(q.any), none: cleanList(q.none) } : null;
}

/**
 * The roll table an `enchant_item` outcome rolls on Use, as `{ key, uuid, name }` (the table's `tableKey` flag, its uuid
 * as the fallback, and a label that is never resolved); null when the key and the uuid are both blank.
 * @param {object} out
 * @returns {{ key: string, uuid: string, name: string }|null}
 */
export function outcomeEnchantTable(out) {
  const key = cleanString(out?.tableKey);
  const uuid = cleanString(out?.tableUuid);
  if (!key && !uuid) return null;
  return { key, uuid, name: cleanString(out?.tableName) };
}

/**
 * One enchantment template (an `enchant_item` outcome's, or a blueprint's) made safe to read: strings trimmed, `category`
 * 'other' when blank, `bonusLevel` a whole number of at least 0 (1 when blank), queries null or three string lists,
 * material lines with a quantity of at least 1, and each row array an array of objects. Row contents are not validated
 * here (the item's row schemas do that when the rows are written).
 * @param {*} raw
 * @returns {object} always a complete template
 */
export function sanitizeEnchantmentTemplate(raw) {
  const t = plain(raw) ?? {};
  const level = Number.parseInt(t.bonusLevel, 10);
  const rows = plain(t.rows) ?? {};
  return {
    id: cleanString(t.id),
    label: cleanString(t.label),
    property: cleanString(t.property),
    category: cleanString(t.category) || 'other',
    bonusLevel: Number.isFinite(level) ? Math.max(0, level) : 1,
    skills: cleanQuery(t.skills),
    tables: cleanQuery(t.tables),
    materials: (Array.isArray(t.materials) ? t.materials : []).filter(plain).map((m) => {
      const qty = Number.parseInt(m.quantity, 10);
      return {
        label: cleanString(m.label),
        identifier: cleanString(m.identifier),
        query: cleanQuery(m.query),
        quantity: Number.isFinite(qty) ? Math.max(1, qty) : 1,
        salvageable: m.salvageable !== false
      };
    }),
    rows: Object.fromEntries(ENCHANTMENT_ROW_ARRAYS.map((k) => [k, (Array.isArray(rows[k]) ? rows[k] : []).filter(plain).map((r) => ({ ...r }))]))
  };
}

/**
 * The id of an enchantment template: its label's slug (`enchantment` when the label has none), with `-2`, `-3`, ... added
 * until it is not in `taken`. Unique within one list (a blueprint's templates, or one `enchant_item` outcome's); the lists
 * are separate, because the only reader of a template id (a craft step matching its skill pick) reads one list.
 * @param {*} label
 * @param {Iterable<string>} [taken] ids already used in the list
 * @returns {string}
 */
export function enchantmentTemplateId(label, taken = []) {
  const used = new Set(taken);
  const base = slugifyIdentifier(label) || 'enchantment';
  let id = base;
  for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
  return id;
}

/**
 * A list of enchantment templates with every blank id filled from its label (an explicit id stays as given). The same
 * objects, changed in place; anything that is not an object is left alone.
 * @param {*} list
 * @returns {*} the list
 */
export function fillEnchantmentTemplateIds(list) {
  if (!Array.isArray(list)) return list;
  const entries = list.filter(plain);
  const taken = new Set(entries.map((t) => cleanString(t.id)).filter(Boolean));
  for (const t of entries) {
    if (cleanString(t.id)) continue;
    t.id = enchantmentTemplateId(t.label, taken);
    taken.add(t.id);
  }
  return list;
}

/** The templates of an `enchant_item` outcome: a list of {@link sanitizeEnchantmentTemplate} results; [] when blank or not a list. */
export function outcomeEnchantments(out) {
  return (Array.isArray(out?.enchantments) ? out.enchantments : []).filter(plain).map(sanitizeEnchantmentTemplate);
}

/** The resource a restore outcome refills (the only pool the executor restores today). */
export const RESTORE_RESOURCES = Object.freeze([{ value: 'mana', label: 'Mana' }]);

/**
 * The outcome types the item sheets offer, one list for the loot and gear sheets (their type selects are built from it).
 * `label` is the loot scratch table's text; `gearLabel` / `effectLabel` override it on the gear sheet / loot effects table; `labelKey` is a localization key that wins
 * over both. Every type `resolveSingleOutcome` dispatches on has a row here (tests/outcome-type-options-7-11.test.mjs).
 */
export const OUTCOME_TYPES = Object.freeze([
  { value: 'spell', label: 'Spell / Damage', effectLabel: 'Cast Spell / Damage' },
  { value: 'damage', label: 'Damage', effectLabel: 'Deal Damage' },
  { value: 'heal', label: 'Heal Bars', effectLabel: 'Heal Bars (Fixed)' },
  { value: 'heal_over_time', label: 'Heal over Time (HoT)' },
  { value: 'restore_resource', label: 'Restore Resource' },
  { value: 'mend_injury', label: 'Mend Injury' },
  { value: 'cure_debuff', label: 'Cure Debuff', effectLabel: 'Cure Debuff(s)' },
  { value: 'buff', label: 'Buff', gearLabel: 'Grant Buff', effectLabel: 'Grant Buff' },
  { value: 'debuff', label: 'Debuff', gearLabel: 'Inflict Debuff', effectLabel: 'Inflict Debuff' },
  { value: 'skill_rank', label: 'Skill Rank (+)', gearLabel: 'Raise Skill (+)', effectLabel: 'Raise Skill (+)' },
  { value: 'learn_spell', label: 'Learn Spell (tome)' },
  { value: 'stat_permanent', label: 'Stat Boost (+)', effectLabel: 'Permanent Stat (+)' },
  { value: 'roll_table', label: 'Roll Table' },
  { value: ENCHANT_ITEM_OUTCOME, labelKey: 'COG.CraftSheet.Outcome.Type' },
  { value: 'custom', label: 'Custom' }
]);

/**
 * The type select's options for one outcome row: every {@link OUTCOME_TYPES} entry with `selected`, plus the row's own
 * type as an extra selected option when it is not in the list (so a save never rewrites an unknown type).
 * @param {object} out the outcome row
 * @param {'loot'|'gear'|'effect'} surface `effect` is the loot sheet's consumable effects table
 * @param {(key: string) => string} [localize]
 */
export function outcomeTypeOptions(out, surface = 'loot', localize = (k) => k) {
  const type = String(out?.type ?? '');
  const options = OUTCOME_TYPES.map((t) => ({
    value: t.value,
    label: t.labelKey ? localize(t.labelKey) : (surface === 'effect' && t.effectLabel) || (surface === 'gear' && t.gearLabel) || t.label,
    selected: t.value === type
  }));
  if (type && !options.some((o) => o.selected)) options.push({ value: type, label: type, selected: true });
  return options;
}
