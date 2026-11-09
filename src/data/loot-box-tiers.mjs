/**
 * Loot box tiers: the registry behind `CONFIG.COG.lootBoxTiers` (keyed by tier id).
 * Its own registry (not the boss tiers) so homebrew can add box tiers without touching boss tiers.
 *
 * An entry is `{ id, label, rank, color, icon, img, fx, sound, houseTableKey, generator, magicItem }`:
 * - `rank` orders the tiers (ties by registry order); the seeded ranks are spaced by 10 so a homebrew tier fits between.
 * - `color` reaches CSS only as a custom property on the element; `icon` is a Font Awesome class, `img` the box image.
 * - `fx` names the CSS class `cog-lootbox-fx-<fx>` of the opening show (an unknown one reads as `pop`); `sound` is a path ('' = silent).
 * - `houseTableKey` is the table key a GM's house table for an unfilled box of this tier uses (an override only).
 * - `generator` is the `CONFIG.COG.lootGenerators` id an unfilled box rolls ('' = none).
 * - `magicItem` is the generator's numbers for the tier (book mechanics, shipped as plain data): `rolls` property rolls on
 *   the item type's table, `skill` an inclusive `[min, max]` Skill Rank range (null = the tier rolls no property),
 *   `stat` a flat `{ range: [min, max] }` or a `{ percent }` of the opener's stat, `enchantedName` whether the item's name
 *   gets the Enchanted prefix. A bad block reads as Bronze's.
 */

import { firstScalar } from '../utils/first-scalar.mjs';

export const DEFAULT_LOOT_BOX_TIER = 'bronze';
/** The `fx` an unknown or missing one reads as. */
const DEFAULT_LOOT_BOX_FX = 'pop';
/** The `rank` of a tier that names none: after every seeded tier. */
export const DEFAULT_LOOT_BOX_RANK = 100;
/** The box image of a tier that names none. */
export const DEFAULT_LOOT_BOX_IMG = 'icons/svg/chest.svg';
/** The icon of a tier that names none. */
const DEFAULT_LOOT_BOX_ICON = 'fa-solid fa-box-open';
const LOOT_BOX_TIER_ID_PATTERN = /^[a-z][a-z0-9_-]*$/;
const MAGIC_ROLLS_MAX = 10;

const range = (min, max) => Object.freeze([min, max]);
const magic = (rolls, skill, stat, enchantedName) => Object.freeze({ rolls, skill, stat, enchantedName });

const seeded = (id, label, rank, color, icon, fx, magicItem) => Object.freeze({
  id, label, rank, color, icon, fx, sound: 'sounds/drums.wav',
  houseTableKey: `lootbox.default.${id}`, generator: 'magic-item', magicItem
});

export const LOOT_BOX_TIERS = Object.freeze({
  bronze: seeded('bronze', 'Bronze', 10, '#cd7f32', 'fa-solid fa-box-open', 'pop', magic(0, null, null, false)),
  silver: seeded('silver', 'Silver', 20, '#bdc3c7', 'fa-solid fa-box-archive', 'shine', magic(1, range(1, 1), Object.freeze({ range: range(2, 2) }), false)),
  gold: seeded('gold', 'Gold', 30, '#f1c40f', 'fa-solid fa-gem', 'sparkle', magic(2, range(1, 3), Object.freeze({ range: range(3, 5) }), true)),
  platinum: seeded('platinum', 'Platinum', 40, '#00d2d3', 'fa-solid fa-ring', 'beam', magic(3, range(2, 4), Object.freeze({ percent: 5 }), true)),
  legendary: seeded('legendary', 'Legendary', 50, '#e67e22', 'fa-solid fa-dragon', 'flare', magic(4, range(5, 5), Object.freeze({ percent: 10 }), true)),
  celestial: seeded('celestial', 'Celestial', 60, '#9b59b6', 'fa-solid fa-crown', 'nova', magic(5, range(6, 6), Object.freeze({ percent: 20 }), false))
});

/** The live registry (`CONFIG.COG.lootBoxTiers`), falling back to the bundled one. */
export function lootBoxTierRegistry() {
  return globalThis.CONFIG?.COG?.lootBoxTiers || LOOT_BOX_TIERS;
}

/**
 * Resolve a raw tier value to a registered tier id; unknown or missing falls back to bronze.
 * @param {*} raw
 * @returns {string}
 */
export function resolveLootBoxTier(raw) {
  const val = firstScalar(raw);
  const id = String(val).trim().toLowerCase();
  const registry = lootBoxTierRegistry();
  return id && Object.prototype.hasOwnProperty.call(registry, id) ? id : DEFAULT_LOOT_BOX_TIER;
}

const isInt = (v) => Number.isInteger(v);
const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isRange = (v) => Array.isArray(v) && v.length === 2 && v.every(isInt) && v[0] >= 0 && v[0] <= v[1];

/** Bronze's block (no property rolls, no X) as a fresh plain object. */
function bronzeMagicItem() {
  return structuredClone(LOOT_BOX_TIERS.bronze.magicItem);
}

/**
 * Check a `magicItem` block and return the clean copy. A bad block (rolls not an integer 0-10, a range with min above max
 * or a negative, both `range` and `percent`, a non-object) comes back as Bronze's with `problem` saying why.
 * @param {*} raw
 * @returns {{ block: { rolls: number, skill: number[]|null, stat: object|null, enchantedName: boolean }, problem: string }}
 */
export function sanitizeMagicItemBlock(raw) {
  const bad = (problem) => ({ block: bronzeMagicItem(), problem });
  if (!isPlain(raw)) return bad('magicItem is not an object');
  const rolls = raw.rolls ?? 0;
  if (!isInt(rolls) || rolls < 0 || rolls > MAGIC_ROLLS_MAX) return bad(`magicItem.rolls must be an integer from 0 to ${MAGIC_ROLLS_MAX}`);
  let skill = null;
  if (raw.skill !== undefined && raw.skill !== null) {
    if (!isRange(raw.skill)) return bad('magicItem.skill must be [min, max] integers with min at most max');
    skill = [raw.skill[0], raw.skill[1]];
  }
  let stat = null;
  if (raw.stat !== undefined && raw.stat !== null) {
    if (!isPlain(raw.stat)) return bad('magicItem.stat must be { range: [min, max] } or { percent }');
    const hasRange = raw.stat.range !== undefined;
    const hasPercent = raw.stat.percent !== undefined;
    if (hasRange === hasPercent) return bad('magicItem.stat takes exactly one of range or percent');
    if (hasRange) {
      if (!isRange(raw.stat.range)) return bad('magicItem.stat.range must be [min, max] integers with min at most max');
      stat = { range: [raw.stat.range[0], raw.stat.range[1]] };
    } else {
      if (!isInt(raw.stat.percent) || raw.stat.percent < 0) return bad('magicItem.stat.percent must be a whole number of 0 or more');
      stat = { percent: raw.stat.percent };
    }
  }
  if (raw.enchantedName !== undefined && typeof raw.enchantedName !== 'boolean') return bad('magicItem.enchantedName must be true or false');
  return { block: { rolls, skill, stat, enchantedName: raw.enchantedName === true }, problem: '' };
}

/**
 * Why a definition cannot be a loot box tier, or '' when it can. `magicItem` is not judged here: a bad one is dropped
 * (read as Bronze's) with a warning.
 * @param {*} def
 * @returns {string}
 */
export function lootBoxTierDefProblem(def) {
  if (!isPlain(def)) return 'the definition is not an object';
  if (typeof def.id !== 'string' || !LOOT_BOX_TIER_ID_PATTERN.test(def.id)) return 'the id must be lower case letters, digits, _ or -, starting with a letter';
  if (typeof def.label !== 'string' || !def.label.trim()) return 'a label is required';
  if (def.rank !== undefined && !Number.isFinite(def.rank)) return 'rank must be a number';
  for (const key of ['color', 'icon', 'img', 'fx', 'sound', 'houseTableKey', 'generator']) {
    if (def[key] !== undefined && typeof def[key] !== 'string') return `${key} must be text`;
  }
  return '';
}

const warnedBlocks = new Set();

/** Forget which bad blocks were warned about (tests only). */
export function _resetLootBoxTierWarnings() {
  warnedBlocks.clear();
}

/**
 * One registry entry with every default filled. A missing `magicItem` reads as Bronze's; a bad one reads as Bronze's with
 * one console warning per tier.
 * @param {object} entry
 * @param {string} id
 */
function withDefaults(entry, id) {
  const text = (v, fallback) => (typeof v === 'string' && v.trim() ? v.trim() : fallback);
  let magicItem;
  if (entry.magicItem === undefined || entry.magicItem === null) {
    magicItem = bronzeMagicItem();
  } else {
    const result = sanitizeMagicItemBlock(entry.magicItem);
    magicItem = result.block;
    if (result.problem && !warnedBlocks.has(id)) {
      warnedBlocks.add(id);
      console.warn(`Sprinter RPG | loot box tier "${id}": ${result.problem}; it reads as Bronze's.`);
    }
  }
  return {
    id,
    label: text(entry.label, id),
    rank: Number.isFinite(entry.rank) ? entry.rank : DEFAULT_LOOT_BOX_RANK,
    color: text(entry.color, ''),
    icon: text(entry.icon, DEFAULT_LOOT_BOX_ICON),
    img: text(entry.img, DEFAULT_LOOT_BOX_IMG),
    fx: text(entry.fx, DEFAULT_LOOT_BOX_FX),
    sound: typeof entry.sound === 'string' ? entry.sound.trim() : '',
    houseTableKey: text(entry.houseTableKey, `lootbox.default.${id}`),
    generator: text(entry.generator, ''),
    magicItem
  };
}

/**
 * The normalized entry of a tier (an unknown id reads as bronze), every default filled, `magicItem` sanitized.
 * @param {*} raw a tier id (array and comma input are sanitized)
 */
export function lootBoxTierDef(raw) {
  const id = resolveLootBoxTier(raw);
  return withDefaults(lootBoxTierRegistry()[id] ?? LOOT_BOX_TIERS.bronze, id);
}

/** Every registered tier (defaults filled), ordered by `rank` and then by registry order. */
export function lootBoxTiersInOrder() {
  return Object.keys(lootBoxTierRegistry())
    .map((id, index) => ({ def: lootBoxTierDef(id), index }))
    .sort((a, b) => (a.def.rank - b.def.rank) || (a.index - b.index))
    .map((e) => e.def);
}

/**
 * Select options for the registered tiers, in rank order.
 * @param {string} [selected]
 * @returns {{key: string, label: string, selected: boolean}[]}
 */
export function lootBoxTierOptions(selected = DEFAULT_LOOT_BOX_TIER) {
  const current = resolveLootBoxTier(selected);
  return lootBoxTiersInOrder().map((def) => ({ key: def.id, label: def.label || def.id, selected: def.id === current }));
}
