/**
 * Shared pieces of the item describer: the line shape, the badge/kind list,
 * the group order and the text lookup. Block files import from here, never from `index.mjs` (which imports them).
 *
 * Strings live in `lang/en.json` under `COG.ItemSummary`. Each block file owns one sub-object (`SpellSkill`,
 * `GearLoot`, `Effects`) and registers identical fallback defaults with `defineItemSummaryTemplates` so headless
 * tests read the same text as the language file.
 */

import { conditionLabel } from '../../documents/actor/condition-data.mjs';
import { findCatalogEntry } from '../../content/catalog-lookup.mjs';
import { resolveGrantName } from '../../data/race-class-grants.mjs';
import { firstScalar } from '../first-scalar.mjs';
import { slugifyIdentifier, debuffIdentifier } from '../identifier.mjs';
import { tempBarBaseSlots } from '../damage/temp-bars.mjs';

/** @typedef {import('../feature-describer.mjs').FeatureLine} FeatureLine */

/**
 * Every line `kind` with its badge. The CSS class is `cog-feature-badge-<kind>`. The first five are the race/class
 * kinds from `feature-describer.mjs`; the rest are the item-summary badges (plan D3) plus `attack` for to-hit/range.
 */
export const ITEM_SUMMARY_BADGES = Object.freeze({
  stat: 'STAT',
  skill: 'SKILL',
  spell: 'SPELL',
  mod: 'MOD',
  tag: 'TAG',
  attack: 'ATTACK',
  cost: 'COST',
  damage: 'DAMAGE',
  heal: 'HEAL',
  area: 'AREA',
  'on-hit': 'ON HIT',
  save: 'SAVE',
  timing: 'TIMING',
  use: 'USE',
  wield: 'WIELD',
  interrupt: 'INTERRUPT',
  light: 'LIGHT',
  reward: 'REWARD',
  buff: 'BUFF',
  debuff: 'DEBUFF'
});

/** The line kinds (CSS suffixes), in badge-list order. */
export const ITEM_SUMMARY_KINDS = Object.freeze(Object.keys(ITEM_SUMMARY_BADGES));

/**
 * Display order of block groups. Race/class use only `stat`, `skill`, `defense`, `other`, `descriptive`, in that
 * (rulebook) order, so the new groups sit around them without changing it. Groups an item does not use are skipped.
 *  cast        what it costs and how it is cast or used
 *  effect      what it does: to-hit, damage, healing, area, save, on-hit riders
 *  timing      duration, cooldown, charges
 *  wield       slot, hands, weapon traits
 *  stat, skill, defense, other   the race/class groups (grants, rows, senses ...)
 *  interrupt   interrupts, auras, light
 *  reward      achievement rewards, space upgrade costs and bonuses
 *  descriptive descriptive tags (always last)
 */
export const ITEM_SUMMARY_GROUPS = Object.freeze([
  'cast', 'effect', 'timing', 'wield', 'stat', 'skill', 'defense', 'other', 'interrupt', 'reward', 'descriptive'
]);

const templates = new Map();

/** Register default templates (identical to the entries in lang/en.json). Same key twice is last-wins. */
export function defineItemSummaryTemplates(table) {
  for (const [key, value] of Object.entries(table ?? {})) templates.set(key, String(value));
}

/** Every registered default template, for the lang drift test. */
export function itemSummaryTemplates() {
  return Object.fromEntries(templates);
}

defineItemSummaryTemplates({
  'COG.ItemSummary.Heading': 'What this does',
  'COG.ItemSummary.HeadingGrants': 'What this grants',
  'COG.ItemSummary.Empty': 'No structured effects. See the description.',
  'COG.ItemSummary.HealBarsOne': '1 Health Bar',
  'COG.ItemSummary.HealBarsMany': '{n} Health Bars',
  'COG.ItemSummary.TempBarsOne': 'Grants 1 temporary Health Bar of {hp} HP',
  'COG.ItemSummary.TempBarsMany': 'Grants {slots} temporary Health Bars of {hp} HP'
});

/** Localize a key with `{name}` data: Foundry's i18n when it has the key, else the bundled template. */
export function t(key, data = {}) {
  const i18n = globalThis.game?.i18n;
  if (i18n?.has?.(key) && typeof i18n.format === 'function') return i18n.format(key, data);
  return String(templates.get(key) ?? key).replace(/\{(\w+)\}/g, (_, k) => String(data[k] ?? ''));
}

/**
 * Build a FeatureLine. Item-block lines are never labelled (row labels are applied by `feature-describer.mjs`); `kind` must be in `ITEM_SUMMARY_KINDS`.
 * @param {string} kind
 * @param {string} text generated text
 * @param {string} [rowPath] document path of the source field
 * @param {string} [ruleText]
 * @returns {FeatureLine}
 */
export function itemLine(kind, text, rowPath = '', ruleText = '') {
  return { text, generated: text, kind, badge: ITEM_SUMMARY_BADGES[kind] ?? String(kind).toUpperCase(), rowPath, ruleText };
}

/**
 * A block describes one aspect of an item. `ctx` is `{ actor, rank }`.
 * @typedef {object} ItemSummaryBlock
 * @property {string} id Unique block id (the coverage fixture names it)
 * @property {string} group One of `ITEM_SUMMARY_GROUPS`
 * @property {(item: object, ctx: object) => boolean} applies
 * @property {(item: object, ctx: object) => FeatureLine[]|Promise<FeatureLine[]>} describe
 */

/**
 * The name for a referenced debuff or condition (`stage-fright`, `condition.poisoned`, an `id.debuff.*` identifier):
 * the catalog or tag name when one is known, else the id made readable. Never the raw id.
 * @param {string} ref
 * @returns {string}
 */
export function conditionRefName(ref) {
  const raw = typeof ref === 'string' ? ref.trim() : '';
  if (!raw) return '';
  const label = String(conditionLabel(raw) ?? '').trim();
  if (label && label !== raw) return label;
  return humanizeId(raw);
}

/**
 * Name of a buff or debuff reference: an owned item with that identifier, else the catalog entry, else the condition
 * name, else the identifier made readable. Never the raw id.
 * @param {'buffs'|'debuffs'} kind
 * @param {string} ref
 * @param {{ actor?: object|null }} [ctx]
 */
export function conditionName(kind, ref, ctx) {
  const raw = typeof ref === 'string' ? ref.trim() : '';
  if (!raw) return '';
  const identifier = kind === 'debuffs' ? debuffIdentifier(raw) : slugifyIdentifier(raw);
  const type = kind === 'debuffs' ? 'debuff' : 'buff';
  const items = ctx?.actor && typeof ctx.actor === 'object' ? ctx.actor.items : null;
  const owned = items ? Array.from(items).find((i) => i?.type === type && i.system?.identifier === identifier) : null;
  return owned?.name || findCatalogEntry(kind, identifier)?.name || (kind === 'debuffs' ? conditionRefName(raw) : humanizeId(raw));
}

/** Name of a skill or spell reference: the resolved document's name, else the identifier made readable. */
export async function documentName(ref, type) {
  let val = ref ?? '';
  if (Array.isArray(val)) val = val[0] ?? '';
  const identifier = (typeof val === 'string' ? val.trim() : '').replace(/^id\.(skill|spell)\./, '');
  if (!identifier) return '';
  return (await resolveGrantName({ identifier }, type)) || humanizeId(identifier);
}

// ---- small, defensive readers (CONTRIBUTING §4), the one copy every describer file uses -------------------------

/** A trimmed string from text, a number, or the first entry of an array; '' for anything else. */
export function str(v) {
  let val = v ?? '';
  if (Array.isArray(val)) val = val[0] ?? '';
  if (typeof val === 'number') return Number.isFinite(val) ? String(val) : '';
  return typeof val === 'string' ? val.trim() : '';
}

/**
 * Like {@link str} for a single-token field (a stat, a damage type, a slot): a comma string "int,dex" reads as its first
 * entry. Free text (names, dice, notes) uses `str`, which keeps its commas.
 */
export function token(v) {
  return firstScalar(str(v));
}

/** A finite number; 0 for anything else. */
export function num(v) {
  return Number.isFinite(Number(v)) ? Number(v) : 0;
}

/** A whole number (rounded down) at or above `min`; `min` for anything else. */
export function whole(v, min = 0) {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.max(min, n) : min;
}

/** A whole number, truncated toward zero, negatives kept; 0 for anything else. */
export function integer(v) {
  return Math.trunc(num(v));
}

/** A number with its sign: "+2", "0" reads "+0", "-1". */
export function signed(n) {
  return n >= 0 ? `+${n}` : String(n);
}

/** An identifier made readable ("studio-audience-approval" becomes "Studio Audience Approval"); the last-resort name. */
export function humanizeId(ref) {
  return str(ref).replace(/^(condition|id\.debuff|id\.buff|id\.spell|id\.skill|actor:)\.?/, '').replace(/[-_.:]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ---- wording shared by the spell, gear and loot blocks -----------------------------------------------------------

/** "1 Health Bar" or "3 Health Bars"; a formula such as "CHA + 1" reads as many. */
export function healBarsText(bars) {
  const n = typeof bars === 'string' ? bars.trim() : bars;
  return Number(n) === 1 && n !== '' ? t('COG.ItemSummary.HealBarsOne') : t('COG.ItemSummary.HealBarsMany', { n });
}

/**
 * "Grants 3 temporary Health Bars of 2 HP": the slot count is the owner's (the formula's ability mod, at least 1, plus
 * `extra`), else the formula itself ("CHA", "CHA + 1") when no owner is known.
 * @param {{ slotsFormula?: string }} tempBars
 * @param {number} hp HP per slot
 * @param {{ actor?: object|null, extra?: number }} [opts]
 */
export function tempBarsText(tempBars, hp, { actor = null, extra = 0 } = {}) {
  let slots;
  if (actor) slots = String(Math.max(1, tempBarBaseSlots(tempBars?.slotsFormula, actor.system?.abilities)) + extra);
  else {
    const formula = str(tempBars?.slotsFormula).toUpperCase() || '1';
    slots = extra ? `${formula} ${extra > 0 ? '+' : '-'} ${Math.abs(extra)}` : formula;
  }
  return slots === '1' ? t('COG.ItemSummary.TempBarsOne', { hp }) : t('COG.ItemSummary.TempBarsMany', { slots, hp });
}
