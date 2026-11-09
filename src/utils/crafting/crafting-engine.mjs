/**
 * Sprinter RPG - Crafting engine
 *
 * Pure functions over plain data: no document writes, no Foundry calls that need a running game. Callers pass items as
 * documents or as `{ id, type, name, system }` objects and get plain data back. The rules are the book's crafting chapter:
 * Difficulty by category, hours by bonus level or size, the table tier and Table 47 salvage.
 *
 * Nothing here parses names or descriptions: materials are matched by `system.identifier` or a tag query, tables by the
 * `crafting.table.<type>` tag on `craftingTable.tableTypeTag`.
 */

import { evaluateRollOutcome, COG_ROLL_OUTCOMES, COG_OUTCOME_CONFIG } from '../../documents/session/roll-outcomes.mjs';
import { matchesTagQuery } from '../tag/tag-query.mjs';
import { getItemAllTags } from '../../documents/active-tags.mjs';
import { hasAsTrigger } from '../roll/amazing-success.mjs';
import { ENCHANTMENT_ROW_ARRAYS } from '../loot/outcome-defaults.mjs';
import { craftText } from './craft-text.mjs';
import { getRowKind, kindOf } from '../row-kinds.mjs';
import { getSizeInfo, sanitizeSizeId } from '../../data/sizes.mjs';
import { enchantmentFactor, getEnchantmentCategory } from '../../data/rules/crafting-rules.mjs';
import { upgradeKindsOf } from '../../data/rules/vehicle-rules.mjs';
import { VEHICLE_TAGS } from '../../data/tag-vocabulary.mjs';
import { CHECK_TAGS, CRAFT_TAGS, ITEM_STATE_TAGS, MATERIAL_UNSALVAGEABLE_TAG, isJunkItem } from '../tag/tag-mechanics.mjs';
import { firstScalar } from '../first-scalar.mjs';

/** The highest table tier. */
export const MAX_TABLE_TIER = 10;
/** Magic items (enchanting) start on this floor. */
const ENCHANTING_FLOOR = 4;
/** An item with this many enchantments or more risks breaking when another is applied. */
export const HAZARD_ENCHANTMENTS = 3;
/** The over-enchanting 1d10 breaks the item permanently on this or less. */
export const HAZARD_BREAKS_ON = 5;

/**
 * The update that marks an item broken (repairable) or destroyed (permanent) and unequips it. Pure; `breakItem` and the
 * Floor Simulator both write it.
 * @param {{ tags?: string[], equipped?: boolean }} itemState the item's `system` (or a snapshot with `tags` and `equipped`)
 * @param {{ destroyed?: boolean }} [opts]
 * @returns {object} a (possibly empty) `system.*` update
 */
export function breakItemUpdate(itemState, { destroyed = false } = {}) {
  const tag = destroyed ? ITEM_STATE_TAGS.destroyed : ITEM_STATE_TAGS.broken;
  const tags = Array.isArray(itemState?.tags) ? itemState.tags.filter((t) => typeof t === 'string') : [];
  const update = {};
  if (!tags.includes(tag)) update['system.tags'] = [...tags, tag];
  if (itemState?.equipped) update['system.equipped'] = false;
  return update;
}

/** The row arrays an enchantment writes into (one list, defined in `outcome-defaults.mjs`). */
export { ENCHANTMENT_ROW_ARRAYS };

/**
 * The item update that writes one enchantment: the template's rows appended to the item's arrays with the `enchantment`
 * stamp, plus one ledger entry. Pure; no confirm, no dialog. `applyEnchantment` and the Floor Simulator both use it.
 * @param {object} itemSystem the item's `system` (or a snapshot with the row arrays and `enchantments`)
 * @param {object} template a sanitised enchantment template
 * @param {{ id?: string, method?: string, ruleBreak?: boolean, asBreak?: boolean, tags?: string[], name?: string }} [opts] `asBreak` marks the
 *   copied AS trigger rows; `tags` are added to `system.tags` when not already there (the new ones go in the ledger entry, so removing
 *   the enchantment removes them); a non-blank `name` renames the item
 * @returns {{ id: string, update: object, entry: object, rows: object }} `rows` are the stamped rows by array
 */
export function buildEnchantmentWrite(itemSystem, template, { id, method = 'craft', ruleBreak = false, asBreak = false, tags = [], name } = {}) {
  const ledgerId = id || globalThis.foundry?.utils?.randomID?.() || Math.random().toString(36).slice(2, 18);
  const keep = (v) => (Array.isArray(v) ? structuredClone(v) : []);
  const update = {};
  const rows = {};
  for (const array of ENCHANTMENT_ROW_ARRAYS) {
    const source = Array.isArray(template?.rows?.[array]) ? template.rows[array] : [];
    if (!source.length) continue;
    rows[array] = source.map((row) => ({
      ...structuredClone(row),
      enchantment: ledgerId,
      ...(array === 'asTriggers' && asBreak ? { ruleBreak: true } : {})
    }));
    update[`system.${array}`] = [...keep(itemSystem?.[array]), ...rows[array]];
  }
  const entry = {
    id: ledgerId, label: template?.label ?? '', property: template?.property ?? '', category: template?.category || 'other',
    bonusLevel: template?.bonusLevel ?? 1, method, ruleBreak: ruleBreak === true
  };
  const have = Array.isArray(itemSystem?.tags) ? itemSystem.tags.filter((t) => typeof t === 'string') : [];
  const added = [...new Set((Array.isArray(tags) ? tags : []).filter((t) => typeof t === 'string').map((t) => t.trim()).filter(Boolean))].filter((t) => !have.includes(t));
  entry.tags = added;
  if (added.length) update['system.tags'] = [...have, ...added];
  if (typeof name === 'string' && name.trim()) update.name = name.trim();
  update['system.enchantments'] = [...keep(itemSystem?.enchantments), entry];
  return { id: ledgerId, update, entry, rows };
}

const AS_KEY = 'as';
const OUTCOME = COG_ROLL_OUTCOMES;

const num = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const nonNeg = (v) => Math.max(0, num(v));
const round6 = (n) => Math.round(n * 1e6) / 1e6;
const text = (v) => (typeof v === 'string' ? v.trim() : '');
const asArray = (v) => (Array.isArray(v) ? v : []);
const idOf = (item) => String(item?.id ?? item?._id ?? '');
const qtyOf = (item) => Math.max(0, Math.floor(num(item?.system?.quantity, 1)));

/** A tag query in any accepted form as `{ all, any, none }` arrays of trimmed tag ids. */
function queryParts(query) {
  const clean = (list) => asArray(list).filter((t) => typeof t === 'string' && t.trim()).map((t) => t.trim());
  if (!query) return { all: [], any: [], none: [] };
  if (typeof query === 'string') return { all: clean([query]), any: [], none: [] };
  if (Array.isArray(query)) return { all: clean(query), any: [], none: [] };
  if (typeof query === 'object') return { all: clean(query.all), any: clean(query.any), none: clean(query.none) };
  return { all: [], any: [], none: [] };
}

/** Whether a tag query names nothing. */
function isEmptyQuery(query) {
  const q = queryParts(query);
  return !q.all.length && !q.any.length && !q.none.length;
}

const itemTags = (item) => getItemAllTags(item);

/**
 * The skill query a vehicle upgrade defaults to (3.44i): the `craftSkills` of the upgrade kinds the blueprint makes. For an
 * item-mode blueprint these are the kinds the output item's tags name; for an enchant-mode one, the kinds its `target`
 * query names when every tag it asks for is a vehicle upgrade tag (so it can only go on upgrades). Several kinds give the
 * union of their `any` skills. Null when no kind applies. Never reads a name.
 * @param {{ mode?: string, target?: object }} bp the blueprint block
 * @param {object|null} template the output item of an item-mode blueprint
 * @returns {{ any: string[] }|null}
 */
export function vehicleUpgradeSkillQuery(bp, template = null) {
  let tags;
  if (bp?.mode === 'item') {
    tags = template ? [...itemTags(template)] : [];
  } else {
    const q = queryParts(bp?.target);
    const asked = [...q.all, ...q.any];
    tags = asked.length && asked.every((t) => t.startsWith(VEHICLE_TAGS.upgradePrefix)) ? asked : [];
  }
  const any = [];
  for (const kind of upgradeKindsOf(tags)) {
    const parts = queryParts(kind.craftSkills);
    for (const id of [...parts.any, ...parts.all]) if (!any.includes(id)) any.push(id);
  }
  return any.length ? { any } : null;
}

// ---------------------------------------------------------------------------
// Difficulty, hours, junk
// ---------------------------------------------------------------------------

/**
 * Difficulty of one enchantment check: 10 + bonus level x the category's factor.
 * @param {{ category?: string, bonusLevel?: number }} params
 * @returns {number}
 */
export function enchantmentDifficulty({ category, bonusLevel } = {}) {
  return 10 + nonNeg(bonusLevel) * enchantmentFactor(category);
}

/**
 * Difficulty of one check that covers several enchantments (the explosive case): 10 + the sum of the bonus levels x the
 * largest factor among them.
 * @param {Array<{ category?: string, bonusLevel?: number }>} templates
 * @returns {number}
 */
export function combinedDifficulty(templates) {
  const list = asArray(templates);
  const levels = list.reduce((sum, t) => sum + nonNeg(t?.bonusLevel), 0);
  const factor = list.reduce((max, t) => Math.max(max, enchantmentFactor(t?.category)), 0);
  return 10 + levels * factor;
}

/**
 * The Unopposed Difficulty of a plain item: the blueprint's or GM's number, else 10 + 2 x Floor.
 * @param {{ floor?: number, dc?: number|null }} params
 * @returns {number}
 */
export function mundaneDifficulty({ floor, dc } = {}) {
  if (dc !== null && dc !== undefined && dc !== '' && Number.isFinite(Number(dc))) return Number(dc);
  return 10 + 2 * nonNeg(floor);
}

/**
 * Hours one step takes. A plain item (a `size`) takes the size number squared; an enchantment takes its bonus level.
 * A batch adds `extraUnits x bonus level / 60 x batchMultiplier` hours (one minute per level per extra unit); the whole is
 * times `timeMultiplier`.
 * @param {{ bonusLevel?: number, size?: string, extraUnits?: number, timeMultiplier?: number, batchMultiplier?: number }} params
 * @returns {number}
 */
export function stepHours({ bonusLevel = 0, size = '', extraUnits = 0, timeMultiplier = 1, batchMultiplier = 1 } = {}) {
  const level = nonNeg(bonusLevel);
  let base = level;
  if (sanitizeSizeId(size) !== '') {
    const n = getSizeInfo(size).size;
    base = n * n;
  }
  const batch = (nonNeg(extraUnits) * level / 60) * num(batchMultiplier, 1);
  return round6((base + batch) * num(timeMultiplier, 1));
}

const warnedJunkSizes = new Set();

/**
 * Misc. Junk a plain item of this size costs (Table 43). A size a module registered without a `junk` number costs its size
 * number squared, with one console warning.
 * @param {string} sizeId
 * @returns {number}
 */
export function sizeJunk(sizeId) {
  const info = getSizeInfo(sizeId);
  if (Number.isFinite(Number(info.junk))) return Number(info.junk);
  if (!warnedJunkSizes.has(info.id)) {
    warnedJunkSizes.add(info.id);
    console.warn(`Sprinter RPG | size "${info.id}" has no junk cost; crafting charges ${info.size * info.size}.`);
  }
  return info.size * info.size;
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

/**
 * The tier a crafting table works at now: base + purchased + coupons + one per floor reached since it was installed, capped
 * at 10. A table with no `acquiredAtFloor` (not installed yet) gains nothing from floors.
 * @param {{ baseTier?: number, purchasedTiers?: number, couponTiers?: number, acquiredAtFloor?: number|null }} craftingTable
 * @param {number} floor the floor the crawler has reached
 * @returns {number}
 */
export function effectiveTableTier(craftingTable, floor) {
  const ct = craftingTable ?? {};
  const acquired = ct.acquiredAtFloor;
  const hasAcquired = acquired !== null && acquired !== undefined && acquired !== '' && Number.isFinite(Number(acquired));
  const gained = hasAcquired ? Math.max(0, num(floor) - Number(acquired)) : 0;
  const total = nonNeg(ct.baseTier) + nonNeg(ct.purchasedTiers) + nonNeg(ct.couponTiers) + gained;
  return Math.min(MAX_TABLE_TIER, Math.floor(total));
}

/** A space upgrade the crawler has not bought counts for nothing (the rest of the system skips it the same way). */
const isUnpurchased = (entry) => entry?.system?.purchased === false;

/** The crafting-table block of an item or of a bare block, or null when it is not an enabled table. */
function tableBlock(entry) {
  const block = entry?.system?.craftingTable ?? entry?.craftingTable ?? null;
  return block && block.enabled !== false && text(block.tableTypeTag) ? block : null;
}

/**
 * The table tier a step works at. Per `all` table type the best table of that type counts, then the lowest of those applies
 * (the book: with several tables only the lowest tier applies); an `any` query takes the best matching table; an empty query
 * takes the best table there is. An `all` tag outside `crafting.table.` (an attachment) is satisfied by any listed item that
 * carries it and adds no tier. A tag in `none` removes the items that carry it. No table, or a missing required type, gives
 * tier 0 and the missing types.
 * @param {Array<object>} tables items (space upgrades) or bare `craftingTable` blocks; other items may be listed for attachments
 * @param {object|Array|string|null} query the blueprint's `tables` query
 * @param {number} floor
 * @returns {{ tier: number, used: Array<{ id: string, name: string, type: string, tier: number }>, missing: string[] }}
 */
export function effectiveTableBonus(tables, query, floor) {
  const q = queryParts(query);
  const banned = new Set(q.none);
  const entries = asArray(tables).filter((e) => e && !isUnpurchased(e) && ![...itemTags(e)].some((t) => banned.has(t)));
  const found = entries.map((e) => {
    const block = tableBlock(e);
    return block ? { id: idOf(e), name: String(e.name ?? ''), type: text(block.tableTypeTag), tier: effectiveTableTier(block, floor) } : null;
  }).filter(Boolean);
  const best = (list) => list.reduce((top, t) => (!top || t.tier > top.tier ? t : top), null);
  const isType = (tag) => tag.startsWith(CRAFT_TAGS.tablePrefix);

  const used = [];
  const missing = [];
  const tiers = [];
  for (const tag of q.all) {
    if (isType(tag)) {
      const top = best(found.filter((t) => t.type === tag));
      if (top) { used.push(top); tiers.push(top.tier); } else missing.push(tag);
    } else if (!entries.some((e) => itemTags(e).has(tag))) {
      missing.push(tag);
    }
  }
  if (q.any.length) {
    const anyTypes = q.any.filter(isType);
    const top = best(found.filter((t) => anyTypes.includes(t.type)));
    const attachment = q.any.filter((t) => !isType(t)).some((tag) => entries.some((e) => itemTags(e).has(tag)));
    if (top) { used.push(top); tiers.push(top.tier); } else if (!attachment) missing.push(...q.any);
  }
  if (!q.all.some(isType) && !q.any.some(isType)) {
    const top = best(found);
    if (top) { used.push(top); tiers.push(top.tier); }
  }
  const unique = [...new Map(used.map((t) => [t.id || t.type, t])).values()];
  return { tier: missing.length || !tiers.length ? 0 : Math.min(...tiers), used: unique, missing: [...new Set(missing)] };
}

// ---------------------------------------------------------------------------
// Outcome and salvage
// ---------------------------------------------------------------------------

/**
 * A crafting check against its Difficulty: Table 47's outcome plus the margin and what follows from it.
 * @param {{ total: number, d20: number|null, dc: number }} params
 * @returns {{ outcome: string, margin: number, success: boolean, itemBreaks: boolean }}
 */
export function craftOutcome({ total, d20, dc } = {}) {
  const outcome = evaluateRollOutcome({ total, d20Result: d20, targetDC: dc });
  const margin = num(total) - num(dc);
  const success = isCraftSuccess(outcome);
  return { outcome, margin, success, itemBreaks: outcome === OUTCOME.CRITICAL_FAILURE };
}

const CRAFT_MODE_TAGS = Object.freeze({
  mundane: CRAFT_TAGS.modeMundane,
  enchant: CRAFT_TAGS.modeEnchant,
  item: CRAFT_TAGS.modeItem
});

/** First scalar of a value that may arrive as an array or a comma list (GEMINI 4). */
function scalarText(raw) {
  const v = firstScalar(raw);
  return typeof v === 'string' ? v.trim() : '';
}

/**
 * The craft reference of `rollSkill(skill, { craft })`: the Difficulty, the table tier added to the check, which step
 * is rolled and the tags its context carries (the table type and the output's tags). Anything unusable is dropped; a
 * reference without a finite Difficulty is no reference.
 * @param {unknown} raw `options.craft`
 * @returns {{ dc: number, tableTier: number, tableMultiplier: number, tableBaseTier: number, tableLabel: string, mode: string, modeTag: string, tags: string[], stepLabel: string }|null}
 */
export function sanitizeCraftRef(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const dc = Number(raw.dc);
  if (raw.dc === null || raw.dc === '' || typeof raw.dc === 'boolean' || !Number.isFinite(dc)) return null;
  const mode = scalarText(raw.mode);
  const known = Object.hasOwn(CRAFT_MODE_TAGS, mode);
  const tier = Number(raw.tableTier);
  const tags = Array.isArray(raw.tags) ? raw.tags : [];
  return {
    dc: Math.max(0, Math.trunc(dc)),
    tableTier: Number.isFinite(tier) ? Math.max(0, Math.trunc(tier)) : 0,
    tableLabel: scalarText(raw.tableLabel),
    tableMultiplier: raw.tableMultiplier !== null && raw.tableMultiplier !== '' && Number.isFinite(Number(raw.tableMultiplier)) ? Math.max(0, Number(raw.tableMultiplier)) : 1,
    tableBaseTier: Number.isFinite(Number(raw.tableBaseTier)) ? Math.max(0, Math.trunc(Number(raw.tableBaseTier))) : 0,
    mode: known ? mode : '',
    modeTag: known ? CRAFT_MODE_TAGS[mode] : '',
    tags: [...new Set(tags.filter((t) => typeof t === 'string' && t.trim()).map((t) => t.trim()))],
    stepLabel: scalarText(raw.stepLabel)
  };
}

/** The roll-context tags of a crafting check: `check.crafting`, the mode tag, then the table type and output tags. */
export function craftContextTags(craft) {
  if (!craft) return [];
  return [...new Set([CHECK_TAGS.crafting, craft.modeTag, ...craft.tags].filter(Boolean))];
}

/**
 * The flat breakdown line a table tier adds to the check, or null at tier 0. A `tableTier` row shows its multiplier:
 * "Table tier +0 (tables give no bonus)", or "Table tier +2 (Prop Shop Table, tier 4 x0.5)".
 */
export function craftTierLine(craft) {
  if (!craft) return null;
  const mult = craft.tableMultiplier ?? 1;
  if (mult !== 1 && craft.tableBaseTier > 0) {
    if (!craft.tableTier && mult === 0) return craftText('COG.Craft.TableNoBonus');
    const parts = [craft.tableLabel, craftText('COG.Craft.TableScaled', { base: craft.tableBaseTier, mult })].filter(Boolean);
    return `Table tier +${craft.tableTier} (${parts.join(', ')})`;
  }
  if (!craft.tableTier) return null;
  return `Table tier +${craft.tableTier}${craft.tableLabel ? ` (${craft.tableLabel})` : ''}`;
}

/** The card line of a crafting check: "Difficulty 14: Near Miss (missed by 2)". */
export function craftDifficultyLine(craft, { outcome, margin } = {}) {
  const label = COG_OUTCOME_CONFIG[outcome]?.label ?? String(outcome ?? '');
  const by = margin < 0 ? `missed by ${-margin}` : `beat by ${margin}`;
  return `Difficulty ${craft.dc}: ${label} (${by})`;
}

/** Whether a Table 47 outcome id is a success. */
export function isCraftSuccess(outcome) {
  return outcome === OUTCOME.SUCCESS || outcome === OUTCOME.AMAZING_SUCCESS || outcome === OUTCOME.CRITICAL_SUCCESS;
}

/** The Table 47 salvage fraction tier of a miss: all (1-2 short), half (3-9), none (10 or more). */
function salvageTier(outcome, margin) {
  if (outcome === OUTCOME.NEAR_MISS) return 'all';
  if (outcome === OUTCOME.FAILURE) return 'half';
  if (outcome === OUTCOME.MAJOR_FAILURE) return 'none';
  if (outcome === OUTCOME.CRITICAL_FAILURE) {
    // A Critical Failure keeps the margin's tier; a Natural 1 that still met the Difficulty counts as a near miss.
    if (margin >= -2) return 'all';
    if (margin >= -9) return 'half';
    return 'none';
  }
  return 'none';
}

/**
 * What a failed step gives back. Per material line: `needed`, `kept` (returned) and `consumed`. A Near Miss (1-2 short) keeps
 * all, a Failure (3-9) half rounded down, a Major Failure none; a Critical Failure reads its margin as those three. A
 * success keeps nothing (the materials were used). A line that is not salvageable (`salvageable: false`, `unsalvageable: true`
 * or the `material.unsalvageable` tag) keeps nothing.
 * @param {{ outcome: string, margin?: number, materials: Array<object> }} params lines carry `needed` (or `quantity`)
 * @returns {Array<{ index: number, label: string, identifier: string, needed: number, kept: number, consumed: number }>}
 */
export function evaluateSalvage({ outcome, margin = 0, materials } = {}) {
  const tier = salvageTier(outcome, num(margin));
  return asArray(materials).map((line, index) => {
    const needed = Math.max(0, Math.floor(num(line?.needed ?? line?.quantity)));
    const never = line?.salvageable === false || line?.unsalvageable === true
      || asArray(line?.tags).includes(MATERIAL_UNSALVAGEABLE_TAG);
    let kept = 0;
    if (!never) kept = tier === 'all' ? needed : tier === 'half' ? Math.floor(needed / 2) : 0;
    return { index, label: String(line?.label ?? ''), identifier: String(line?.identifier ?? ''), needed, kept, consumed: needed - kept };
  });
}

// ---------------------------------------------------------------------------
// Properties and counts
// ---------------------------------------------------------------------------

/** The property keys one row contributes (C3), by the array it sits in. */
function rowKeys(array, row) {
  if (!row || typeof row !== 'object') return [];
  const any = (v) => text(v) || 'any';
  switch (array) {
    case 'grants': {
      const kind = row.kind ?? 'stat';
      if (kind === 'stat') return row.mode === 'pool' ? [] : [`stat:${text(row.stat)}`];
      if (kind === 'skill' || kind === 'rank_bonus') return [`skill:${text(row.identifier) || text(row.tag)}`];
      if (kind === 'spell') return [`spell:${text(row.identifier)}`];
      if (kind === 'rank_cap') return [`rank_cap:${text(row.identifier) || text(row.tag)}`];
      return [];
    }
    case 'damageModifiers': return [`damage:${text(row.mode) || 'add'}:${any(row.damageType)}`];
    case 'defenseModifiers': return [`defense:${text(row.kind) || 'resistance'}:${any(row.damageType)}`];
    case 'attackModifiers': return [`attack:${text(row.kind) || 'bonus'}:${text(row.stat)}`];
    case 'checkModifiers': return [`check:${text(row.kind) || 'bonus'}:${text(row.stat)}`];
    case 'asTriggers': return [AS_KEY];
    default: return [];
  }
}

/**
 * The property keys of a set of rows: `stat:<stat>`, `skill:<identifier|tag>`, `spell:<identifier>`,
 * `damage:<mode>:<type|any>`, `defense:<kind>:<type|any>`, `attack|check:<kind>:<stat>`, and `as` for an Amazing Success
 * trigger. Disabled rows have none. A non-blank `property` replaces the derived keys.
 * @param {Object<string, Array<object>>} rowsByArray `{ grants, damageModifiers, ... }`
 * @param {string} [property] an author's override
 * @returns {string[]}
 */
export function propertyKeys(rowsByArray, property = '') {
  const override = text(property);
  if (override) return [override];
  const keys = new Set();
  for (const array of ENCHANTMENT_ROW_ARRAYS) {
    for (const row of asArray(rowsByArray?.[array])) {
      if (row?.disabled === true) continue;
      for (const key of rowKeys(array, row)) keys.add(key);
    }
  }
  return [...keys];
}

/**
 * How many enchantments an item carries: its ledger entries plus every enabled row that has no `enchantment` stamp (a looted
 * item with a skill grant and a damage row counts 2 with no authoring). Base properties are not rows, so they do not count.
 * @param {object} itemSystem `item.system`
 * @returns {number}
 */
export function enchantmentCount(itemSystem) {
  let count = asArray(itemSystem?.enchantments).length;
  for (const array of ENCHANTMENT_ROW_ARRAYS) {
    for (const row of asArray(itemSystem?.[array])) {
      if (row?.disabled === true || text(row?.enchantment)) continue;
      count += 1;
    }
  }
  return count;
}

/**
 * The enchantment on an item that the template would duplicate (two share a property when their key sets intersect), or
 * null. The result is `{ kind: 'ledger', entry, key }` for a ledger entry or `{ kind: 'row', array, row, key }` for an
 * unstamped row. `ignoreAs` skips the Amazing Success key, which has its own one-per-weapon rule.
 * @param {object} itemSystem `item.system`
 * @param {{ property?: string, rows?: object }} template
 * @param {{ ignoreAs?: boolean }} [options]
 * @returns {object|null}
 */
export function sharesProperty(itemSystem, template, { ignoreAs = false } = {}) {
  const wanted = new Set(propertyKeys(template?.rows, template?.property).filter((k) => !(ignoreAs && k === AS_KEY)));
  if (!wanted.size) return null;
  for (const entry of asArray(itemSystem?.enchantments)) {
    const stamped = {};
    for (const array of ENCHANTMENT_ROW_ARRAYS) {
      stamped[array] = asArray(itemSystem?.[array]).filter((r) => text(r?.enchantment) === entry.id && entry.id);
    }
    const key = propertyKeys(stamped, entry.property).find((k) => wanted.has(k));
    if (key) return { kind: 'ledger', entry, key };
  }
  for (const array of ENCHANTMENT_ROW_ARRAYS) {
    for (const row of asArray(itemSystem?.[array])) {
      if (row?.disabled === true || text(row?.enchantment)) continue;
      const key = rowKeys(array, row).find((k) => wanted.has(k));
      if (key) return { kind: 'row', array, row, key };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Misc. Junk and materials
// ---------------------------------------------------------------------------

/**
 * Misc. Junk points: the summed quantity of items tagged `material.misc_junk`.
 * @param {Array<object>} items
 * @returns {number}
 */
export function junkPoints(items) {
  return asArray(items).filter(isJunkItem).reduce((sum, item) => sum + qtyOf(item), 0);
}

/** Spend group of a junk item: plain used junk 0, other junk 1, junk that remembers what it was (restorable) 2. */
function junkGroup(item) {
  const from = item?.system?.usedFrom;
  if (from && (text(from.identifier) || text(from.name) || text(from.spellIdentifier))) return 2;
  return item?.system?.used === true ? 0 : 1;
}

/**
 * Which junk stacks to take `n` points from: plain used junk first, then other junk, restorable junk last; the smallest stack
 * first within each group. Short of `n`, the plan takes what there is and `missing` is the rest.
 * @param {Array<object>} items
 * @param {number} n
 * @param {{ reserved?: Map<string, number> }} [options] units already promised to material lines (item id to units); not counted
 * @returns {{ plan: Array<{ itemId: string, name: string, quantity: number }>, missing: number }}
 */
export function planJunkSpend(items, n, { reserved = new Map() } = {}) {
  let left = Math.max(0, Math.floor(num(n)));
  const free = (i) => qtyOf(i) - (reserved.get(idOf(i)) ?? 0);
  const stacks = asArray(items).filter((i) => isJunkItem(i) && free(i) > 0)
    .map((item, order) => ({ item, order, group: junkGroup(item), qty: free(item) }))
    .sort((a, b) => a.group - b.group || a.qty - b.qty || a.order - b.order);
  const plan = [];
  for (const { item, qty } of stacks) {
    if (left <= 0) break;
    const take = Math.min(qty, left);
    plan.push({ itemId: idOf(item), name: String(item.name ?? ''), quantity: take });
    left -= take;
  }
  return { plan, missing: left };
}

/**
 * Match a blueprint's material lines to item stacks. A line selects loot by `system.identifier`, else by its tag `query`; it
 * needs `quantity x quantityFactor` units, taken stack by stack in the order given (callers list the crawler's items before
 * the space's). `options.reserved` (a Map of item id to units already promised) is read and updated, so lines and steps do
 * not take the same unit twice; `options.sourceOf(item)` labels each stack's origin.
 * @param {Array<object>} items
 * @param {Array<object>} lines `{ label, identifier, query, quantity, salvageable }`
 * @param {number} [quantityFactor=1]
 * @param {{ reserved?: Map<string, number>, sourceOf?: (item: object) => string }} [options]
 * @returns {Array<{ index: number, label: string, identifier: string, query: object|null, needed: number, found: number, missing: number, salvageable: boolean, stacks: Array<{ itemId: string, name: string, quantity: number, source: string }> }>}
 */
export function matchMaterials(items, lines, quantityFactor = 1, { reserved = new Map(), sourceOf = () => '' } = {}) {
  const pool = asArray(items).filter((i) => i && (!i.type || i.type === 'loot'));
  const factor = Math.max(1, Math.floor(num(quantityFactor, 1)));
  return asArray(lines).map((line, index) => {
    const needed = Math.max(0, Math.floor(num(line?.quantity, 1))) * factor;
    const identifier = text(line?.identifier);
    const hasQuery = !isEmptyQuery(line?.query);
    const stacks = [];
    let got = 0;
    let unsalvageable = false;
    if (identifier || hasQuery) {
      for (const item of pool) {
        if (got >= needed) break;
        const matches = identifier ? text(item.system?.identifier) === identifier : matchesTagQuery(itemTags(item), line.query);
        if (!matches) continue;
        const free = qtyOf(item) - (reserved.get(idOf(item)) ?? 0);
        if (free <= 0) continue;
        const take = Math.min(free, needed - got);
        reserved.set(idOf(item), (reserved.get(idOf(item)) ?? 0) + take);
        stacks.push({ itemId: idOf(item), name: String(item.name ?? ''), quantity: take, source: sourceOf(item) });
        if (asArray(item.system?.tags).includes(MATERIAL_UNSALVAGEABLE_TAG)) unsalvageable = true;
        got += take;
      }
    }
    return {
      index,
      label: String(line?.label ?? ''),
      identifier,
      query: line?.query ?? null,
      needed,
      found: got,
      missing: needed - got,
      salvageable: line?.salvageable !== false && !unsalvageable,
      stacks
    };
  });
}

// ---------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------

/** A template's own query when it names tags, else the blueprint's. */
const queryOr = (own, fallback) => (isEmptyQuery(own) ? (fallback ?? null) : own);

/** The ids of the skills in `skills` that match a tag query. */
function skillOptions(skills, query) {
  if (isEmptyQuery(query)) return [];
  return asArray(skills).filter((s) => matchesTagQuery(itemTags(s), query)).map(idOf);
}

/** The grant kinds whose `value` is a number a bonus-value row raises (the rest of the numbers come from the row-kind registry). */
const RAISABLE_GRANT_KINDS = Object.freeze(['stat', 'skill', 'rank_bonus']);

/** A row field's number, or null when it is blank or not a number (dice strings and the like are left alone). */
function wholeNumber(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Raise the numbers an enchantment template writes by `n` (a `bonusValue` craft row, Difficulty and hours untouched):
 * every grant `value` of kind stat, skill or rank_bonus, and every field a registered row kind declares `scaled: 'whole'`
 * (so a module's kind joins by declaring it). Rows with no such number (an Amazing Success trigger, a resistance) and
 * disabled rows stay as they are. Pure: returns a copy.
 * @param {object} template a sanitised enchantment template (`rows` by array)
 * @param {number} n how much to add
 * @returns {{ template: object, raised: number }} `raised` counts the numbers that changed
 */
export function raiseTemplateBonus(template, n) {
  const copy = structuredClone(template ?? {});
  const add = num(n);
  let raised = 0;
  if (!add || !copy.rows || typeof copy.rows !== 'object') return { template: copy, raised };
  for (const array of ENCHANTMENT_ROW_ARRAYS) {
    for (const row of asArray(copy.rows[array])) {
      if (!row || typeof row !== 'object' || row.disabled === true) continue;
      const fields = array === 'grants'
        ? (RAISABLE_GRANT_KINDS.includes(row.kind) ? ['value'] : [])
        : Object.entries(getRowKind(array, kindOf(array, row))?.scaled ?? {}).filter(([, how]) => how === 'whole').map(([field]) => field);
      for (const field of fields) {
        const current = wholeNumber(row[field]);
        if (current === null) continue;
        row[field] = current + add;
        raised += 1;
      }
    }
  }
  return { template: copy, raised };
}

/**
 * Plan a craft without doing it: the steps with their Difficulty, hours, materials and table tier, and the warnings that
 * later steps turn into Rule Break confirms. Nothing is blocked here; a warning is information.
 *
 * `blueprint` is a loot item (`system.blueprint`) or the bare block. `target` is the gear an enchant blueprint goes on.
 * `crawler.items` are listed before `space.items` when matching materials, and the space's items count only when
 * `space.linked`. `modifiers` may carry `timeMultiplier`, `batchMultiplier` and `maxBonus` (the highest bonus level the
 * skill may craft; null = no cap), the same for every step, and `resolve(step, index)`, a function that returns those three
 * for one step (the crafter's rows for the skill that rolls it, read after the step's table and mode are known; its
 * multipliers multiply the fixed ones, a fixed `maxBonus` wins over its cap). `clockHours` is the time left on the floor
 * clock (null = not checked).
 *
 * A `oneRoll` blueprint folds its enchantment steps into one step at the combined Difficulty. With `quantity` above 1 a
 * batchable blueprint adds the batch minutes; one that is not takes the hours once per unit (and warns `notBatchable`).
 * @param {object} input
 * @returns {{ steps: Array<object>, totalHours: number, quantity: number, warnings: Array<{ code: string, message: string, ruleBreak: boolean }>, notices: Array<{ code: string, message: string }> }}
 */
export function planCraft(input = {}) {
  const bp = input.blueprint?.system?.blueprint ?? input.blueprint ?? {};
  const mode = bp.mode === 'item' ? 'item' : 'enchant';
  const target = input.target ?? null;
  const crawler = input.crawler ?? {};
  const space = input.space ?? null;
  const inSpace = !!space && space.linked !== false;
  const floor = num(input.floor ?? crawler.floor);
  const quantity = Math.max(1, Math.floor(num(input.quantity, 1)));
  const mods = input.modifiers ?? {};
  const resolve = typeof mods.resolve === 'function' ? mods.resolve : null;
  const timeMultiplier = num(mods.timeMultiplier, 1);
  const batchMultiplier = num(mods.batchMultiplier, 1);
  /** Per step: how its hours follow from the multipliers (the plan fills `hours` in again once they are resolved). */
  const hoursOf = new Map();
  const batchable = bp.batchable === true;
  const extraUnits = batchable ? quantity - 1 : 0;
  const unitHours = batchable ? 1 : quantity;

  const crawlerItems = asArray(crawler.items);
  const spaceItems = inSpace ? asArray(space.items) : [];
  const sourceByItem = new Map();
  for (const i of crawlerItems) sourceByItem.set(i, 'crawler');
  for (const i of spaceItems) sourceByItem.set(i, 'space');
  const pool = [...crawlerItems, ...spaceItems];
  const reserved = new Map();
  const matchLines = (lines) => matchMaterials(pool, lines, quantity, { reserved, sourceOf: (i) => sourceByItem.get(i) ?? '' });

  const templates = asArray(bp.enchantments);
  const steps = [];
  // A blueprint for a vehicle upgrade that names no skill rolls the upgrade kind's crafting skills (3.44i).
  const upgradeSkills = isEmptyQuery(bp.skills) ? vehicleUpgradeSkillQuery(bp, input.template ?? null) : null;
  const blueprintSkills = upgradeSkills ?? bp.skills ?? null;

  const hasBase = mode === 'item' && sanitizeSizeId(bp.size) !== '';
  if (hasBase) {
    const base = {
      kind: 'mundane',
      mode: 'mundane',
      templateId: '',
      templateIds: [],
      label: text(bp.output?.name) || text(input.blueprint?.name),
      dc: mundaneDifficulty({ floor, dc: bp.dc }),
      category: '',
      bonusLevel: 0,
      hours: round6(stepHours({ size: bp.size, timeMultiplier }) * unitHours),
      materials: matchLines(bp.materials),
      junk: (sizeJunk(bp.size) + nonNeg(bp.junk)) * quantity,
      skillQuery: blueprintSkills,
      tables: bp.tables ?? null
    };
    hoursOf.set(base, (m) => round6(stepHours({ size: bp.size, timeMultiplier: m.timeMultiplier }) * unitHours));
    steps.push(base);
  }

  const enchantStep = (group) => {
    const first = group[0];
    const levels = group.reduce((s, t) => s + nonNeg(t.bonusLevel), 0);
    const factorOf = (t) => enchantmentFactor(t.category);
    const top = group.reduce((a, t) => (factorOf(t) > factorOf(a) ? t : a), first);
    const hoursFor = (m) => round6(group.reduce((s, t) => s + stepHours({ bonusLevel: t.bonusLevel, extraUnits, timeMultiplier: m.timeMultiplier, batchMultiplier: m.batchMultiplier }), 0) * unitHours);
    const step = {
      kind: 'enchant',
      mode,
      templateId: text(first.id),
      templateIds: group.map((t) => text(t.id)),
      label: group.map((t) => text(t.label)).filter(Boolean).join(' + '),
      dc: group.length > 1 ? combinedDifficulty(group) : enchantmentDifficulty(first),
      category: getEnchantmentCategory(top.category).id,
      bonusLevel: levels,
      hours: hoursFor({ timeMultiplier, batchMultiplier }),
      materials: matchLines(group.flatMap((t) => asArray(t.materials))),
      junk: 0,
      skillQuery: queryOr(first.skills, blueprintSkills),
      tables: queryOr(first.tables, bp.tables)
    };
    hoursOf.set(step, hoursFor);
    return step;
  };
  if (bp.oneRoll === true && templates.length > 1) steps.push(enchantStep(templates));
  else for (const t of templates) steps.push(enchantStep([t]));

  steps.forEach((step, index) => {
    step.skillOptions = skillOptions(crawler.skills, step.skillQuery);
    const needsTable = step.kind === 'enchant' || !isEmptyQuery(step.tables);
    step.tableBonus = inSpace
      ? effectiveTableBonus(space.items, step.tables, floor)
      : { tier: 0, used: [], missing: needsTable ? queryParts(step.tables).all : [] };
    step.needsTable = needsTable;

    // The crafter's own limits and speed-ups for this step (S7), read once the table and the mode are known.
    const found = resolve ? (resolve(step, index) ?? {}) : {};
    const fixedCap = mods.maxBonus;
    const hasFixedCap = fixedCap !== null && fixedCap !== undefined && Number.isFinite(Number(fixedCap));
    const foundCap = found.maxBonus;
    // A tableTier row scales the tier; the step still needs its table and space, so only the tier changes.
    const tableMultiplier = Math.max(0, num(found.tableMultiplier, 1));
    if (tableMultiplier !== 1) {
      const baseTier = step.tableBonus.tier;
      step.tableBonus = { ...step.tableBonus, baseTier, tier: Math.floor(baseTier * tableMultiplier) };
    }
    step.modifiers = {
      tableMultiplier,
      bonusValue: num(found.bonusValue, 0),
      timeMultiplier: timeMultiplier * num(found.timeMultiplier, 1),
      batchMultiplier: batchMultiplier * num(found.batchMultiplier, 1),
      maxBonus: hasFixedCap ? Number(fixedCap) : (foundCap !== null && foundCap !== undefined && Number.isFinite(Number(foundCap)) ? Number(foundCap) : null)
    };
    step.hours = hoursOf.get(step)(step.modifiers);
  });

  const totalHours = round6(steps.reduce((s, st) => s + st.hours, 0));
  const warnings = [];
  const notices = [];
  const warn = (code, data, key = code) => warnings.push({ code, message: craftText(`COG.CraftWarn.${key}`, data), ruleBreak: true });
  const enchantSteps = steps.filter((s) => s.kind === 'enchant');
  const tableSteps = steps.filter((s) => s.needsTable);

  if (mode === 'item' && !steps.length) warn('noSteps');

  if (tableSteps.length && !inSpace) warn('notInSpace');
  if (inSpace) {
    const bad = tableSteps.filter((s) => s.tableBonus.missing.length || !s.tableBonus.used.length);
    if (bad.length) {
      const types = [...new Set(bad.flatMap((s) => s.tableBonus.missing))];
      warn('noTable', { types: types.join(', ') }, types.length ? 'noTable' : 'noTableAny');
    }
  }
  if (enchantSteps.length && floor < ENCHANTING_FLOOR) warn('belowFourthFloor', { floor: ENCHANTING_FLOOR });

  if (mode === 'enchant' && enchantSteps.length) {
    const queryOk = !target ? false
      : (isEmptyQuery(bp.target) ? (!target.type || target.type === 'gear') : matchesTagQuery(itemTags(target), bp.target));
    if (!queryOk) warn('targetMismatch', { name: target?.name ?? craftText('COG.CraftWarn.ThatItem') }, target ? 'targetMismatch' : 'needsTarget');
  }

  const clashes = [];
  const seenKeys = new Map();
  for (const t of templates) {
    if (mode === 'enchant' && target) {
      const hit = sharesProperty(target.system, t, { ignoreAs: true });
      if (hit) clashes.push(text(t.label) || hit.key);
    }
    for (const key of propertyKeys(t.rows, t.property)) {
      if (key === AS_KEY) continue;
      if (seenKeys.has(key) && seenKeys.get(key) !== t) clashes.push(text(t.label) || key);
      seenKeys.set(key, t);
    }
  }
  if (clashes.length) warn('sameProperty', { list: [...new Set(clashes)].join(', ') });

  const asTemplates = templates.filter((t) => propertyKeys(t.rows, t.property).includes(AS_KEY));
  const targetHasAs = mode === 'enchant' && !!target && hasAsTrigger(target);
  if (asTemplates.length > 1 || (asTemplates.length && targetHasAs)) warn('secondAsTrigger');

  const lacking = steps.flatMap((s) => s.materials.filter((m) => m.missing > 0));
  if (lacking.length) warn('missingMaterials', { list: lacking.map((m) => `${m.label || m.identifier || craftText('COG.CraftWarn.Material')} (${m.missing})`).join(', ') });

  const junkNeeded = steps.reduce((s, st) => s + st.junk, 0);
  if (junkNeeded > 0) {
    const { missing } = planJunkSpend(pool, junkNeeded, { reserved });
    if (missing > 0) warn('missingJunk', { missing, needed: junkNeeded });
  }
  if (quantity > 1 && !batchable) warn('notBatchable');

  const overCap = enchantSteps.filter((s) => s.modifiers.maxBonus !== null && s.bonusLevel > s.modifiers.maxBonus);
  if (overCap.length) {
    const cap = Math.min(...overCap.map((s) => s.modifiers.maxBonus));
    warn('overSkillCap', { cap });
  }
  const clock = input.clockHours;
  if (clock !== null && clock !== undefined && Number.isFinite(Number(clock)) && totalHours > Number(clock)) {
    warn('clockShort', { hours: totalHours, left: Number(clock) });
  }

  if (mode === 'enchant' && target && enchantmentCount(target.system) >= HAZARD_ENCHANTMENTS) {
    notices.push({ code: 'hazard', message: craftText('COG.CraftWarn.hazard') });
  }

  return { steps, totalHours, quantity, warnings, notices };
}
