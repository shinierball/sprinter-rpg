/**
 * Defensive sanitizing of the two loot box arrays a builder, an import or a sheet may hand over (7.3a): a loot item's
 * `system.box` and an achievement's `system.rewardBoxes`. Tier input arrives as an array or a comma string (CONTRIBUTING
 * §4), quantities as text, rows as non-objects. A row of an unregistered kind is kept (never lose content) with a warning;
 * the open engine skips it later. Pure of Foundry globals; reads the tier and row-kind registries only.
 */

import { firstScalar } from '../utils/first-scalar.mjs';
import { getRowKind } from '../utils/row-kinds.mjs';
import { cleanTagQuery } from '../utils/tag/tag-query.mjs';
import { resolveLootBoxTier } from './loot-box-tiers.mjs';

/** What a `table` row's rolled rows may become: a skill potion of a custom Skill, or a placeholder loot item ('' = as printed). */
export const BOX_TABLE_AS = Object.freeze(['skillPotion', 'item']);

const isPlain =(v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Text: an array gives its first entry, trimmed. Commas stay (names may contain them). */
function text(raw) {
  let val = raw ?? '';
  if (Array.isArray(val)) val = val[0] ?? '';
  return typeof val === 'string' ? val.trim() : (typeof val === 'number' ? String(val) : '');
}

/** A whole number from a number, a numeric string or the first entry of an array; null when it is none of those. */
function whole(raw) {
  const val = Array.isArray(raw) ? raw[0] : raw;
  if (val === null || val === undefined || val === '') return null;
  const n = Number(firstScalar(val));
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

/** A tier id: the first scalar, lower-cased and resolved to a registered id (unknown reads as bronze). */
const tierOf = (raw) => resolveLootBoxTier(raw);

/**
 * One prize row, every field present and typed.
 * @param {*} raw
 * @param {(path: string, message: string) => void} [warn]
 * @param {string} [path]
 * @returns {object|null} null when the row is not an object
 */
export function sanitizeBoxRow(raw, warn = () => {}, path = 'row') {
  if (!isPlain(raw)) {
    warn(path, 'a box row must be an object; skipped');
    return null;
  }
  const kind = text(firstScalar(raw.kind)) || 'item';
  if (!getRowKind('boxContents', kind)) warn(`${path}.kind`, `unknown box row kind "${kind}"; kept, but opening skips it`);
  const quantity = whole(raw.quantity);
  const rank = whole(raw.rank);
  let tier = '';
  if (text(firstScalar(raw.tier))) {
    tier = tierOf(raw.tier);
    if (tier !== text(firstScalar(raw.tier)).toLowerCase()) warn(`${path}.tier`, `unknown tier "${text(firstScalar(raw.tier))}"; read as ${tier}`);
  }
  const query = cleanTagQuery(raw.query);
  if (kind === 'choice' && !query.all.length && !query.any.length) warn(`${path}.query`, 'a choice row needs at least one tag to pick from; kept, but it offers nothing');
  return {
    kind,
    uuid: text(raw.uuid),
    identifier: text(raw.identifier),
    itemType: text(raw.itemType),
    name: text(raw.name),
    img: text(raw.img),
    quantity: quantity === null ? 1 : Math.max(1, quantity),
    formula: text(raw.formula),
    tableKey: text(raw.tableKey),
    rank: rank === null ? null : Math.max(1, rank),
    generator: text(firstScalar(raw.generator)),
    tier,
    query,
    as: BOX_TABLE_AS.includes(text(firstScalar(raw.as))) ? text(firstScalar(raw.as)) : '',
    times: text(raw.times),
    label: text(raw.label)
  };
}

/**
 * The prize rows of a box. Not an array reads as empty (with a warning); a row that is not an object is dropped.
 * @param {*} raw
 * @param {(path: string, message: string) => void} [warn]
 * @param {string} [path]
 */
function sanitizeBoxContents(raw, warn = () => {}, path = 'contents') {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    warn(path, 'contents must be an array; treated as empty');
    return [];
  }
  return raw.map((row, i) => sanitizeBoxRow(row, warn, `${path}[${i}]`)).filter(Boolean);
}

/**
 * A loot item's `system.box`: tier resolved, contents sanitized, `whenEmpty` '' or 'keep'.
 * @param {*} raw
 * @param {(path: string, message: string) => void} [warn]
 * @param {string} [path]
 */
export function sanitizeLootBox(raw, warn = () => {}, path = 'box') {
  const box = isPlain(raw) ? raw : {};
  const whenEmpty = text(box.whenEmpty);
  if (whenEmpty && whenEmpty !== 'keep') warn(`${path}.whenEmpty`, `whenEmpty "${whenEmpty}" is not "keep"; read as the tier's default contents`);
  return {
    tier: tierOf(box.tier),
    contents: sanitizeBoxContents(box.contents, warn, `${path}.contents`),
    whenEmpty: whenEmpty === 'keep' ? 'keep' : ''
  };
}

/**
 * An achievement's `system.rewardBoxes[]`: tier resolved, quantity at least 1, template pointers kept as text.
 * @param {*} raw
 * @param {(path: string, message: string) => void} [warn]
 * @param {string} [path]
 */
export function sanitizeRewardBoxes(raw, warn = () => {}, path = 'rewardBoxes') {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    warn(path, 'rewardBoxes must be an array; treated as empty');
    return [];
  }
  const out = [];
  raw.forEach((row, i) => {
    if (!isPlain(row)) {
      warn(`${path}[${i}]`, 'a reward box must be an object; skipped');
      return;
    }
    const quantity = whole(row.quantity);
    out.push({
      tier: tierOf(row.tier),
      quantity: quantity === null ? 1 : Math.max(1, quantity),
      uuid: text(row.uuid),
      identifier: text(row.identifier),
      name: text(row.name)
    });
  });
  return out;
}
