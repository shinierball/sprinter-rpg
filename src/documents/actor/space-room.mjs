import { spaceRules, tableSpacesFor } from '../../data/rules/space-rank-rules.mjs';
import { getTagDefinition } from '../../data/tag-definitions.mjs';
import { confirmRuleBreak, withRuleBreak } from '../../utils/rule-break.mjs';
import { isCraftingTable, isStudio } from './crafting-tables.mjs';
import { spaceGroup, spaceGroupFurniture } from './space-group.mjs';

/** A `COG.SpaceRoom` string (the English fallback serves a Node run with no catalogue). */
const roomText = (key, data, fallback) => {
  const i18n = globalThis.game?.i18n;
  if (i18n?.has?.(`COG.SpaceRoom.${key}`) && typeof i18n.format === 'function') return i18n.format(`COG.SpaceRoom.${key}`, data);
  return fallback;
};
const roomMessage = (data) => roomText('Message', data, `${data.space} has ${data.used} of ${data.spaces} table spaces taken. Add ${data.names} anyway as a Rule Break?`);

/** Crafting tables among `items` (item data or documents) that count for room: enabled and not `purchased: false`. */
const countedTables = (items) => Array.from(items ?? []).filter(item => isCraftingTable(item) && item.system?.purchased !== false);

/** How many of `items` (item data or documents) are crafting tables (enabled, `purchased !== false`). */
export function tablesIn(items) {
  return countedTables(items).length;
}

/**
 * The table room of a space's group.
 * @param {Actor} space
 * @returns {{ spaces: number, used: number, left: number, rank: number, members: Actor[] }} `left` may be negative
 */
export function roomOf(space) {
  const group = spaceGroup(space);
  const spaces = tableSpacesFor(group.rank);
  const used = tablesIn(spaceGroupFurniture(space));
  return { spaces, used, left: spaces - used, rank: group.rank, members: group.members };
}

/**
 * Ask a Rule Break when `items` would take more table spaces than the group has left. Never blocks:
 * a confirmed (or auto-allowed) break returns `{ ok: true, ruleBreak: true }`; the caller stamps the flag.
 * @param {Actor} space
 * @param {Array<object>} items item data or documents about to land in the space
 * @param {{ ruleBreak?: boolean, interactive?: boolean }} [options] as `confirmRuleBreak`'s
 * @returns {Promise<{ ok: true, ruleBreak: boolean } | { ok: false, reason: 'noRoom' }>}
 */
export async function confirmRoomFor(space, items, options = {}) {
  const tables = countedTables(items);
  const room = roomOf(space);
  if (!tables.length || tables.length <= room.left) return { ok: true, ruleBreak: false };
  const names = tables.map(t => t.name).join(', ');
  const confirm = await confirmRuleBreak({
    title: 'Table Room',
    message: roomMessage({ space: space.name, used: room.used, spaces: room.spaces, names }),
    reason: `${space.name}: ${room.used} of ${room.spaces} table spaces taken.`,
    options
  });
  return confirm.confirmed ? { ok: true, ruleBreak: true } : { ok: false, reason: 'noRoom' };
}

/** Stamp `flags.<system>.ruleBreak` on the crafting tables in item data `list`, as deposits record a break. */
export function stampTableRuleBreaks(list) {
  for (const data of countedTables(list)) {
    data.flags = withRuleBreak(data).flags;
  }
  return list;
}

/** Studios among `items` (item data or documents) that count: enabled and not `purchased: false`. */
const countedStudios = (items) => Array.from(items ?? []).filter(item => isStudio(item) && item.system?.purchased !== false);

const studioTypeOf = (studio) => String(studio.system?.studio?.tableTypeTag ?? '').trim();

/**
 * What stops `items` from being studios without a Rule Break: the group's rank is below the studio minimum, and a studio
 * for a table type the group (or an earlier item in `items`) already has a studio for.
 * @param {Actor} space
 * @param {Array<object>} items item data or documents about to land in the space
 * @returns {{ studios: Array<object>, rank: number, minRank: number, tooSmall: boolean, duplicates: string[] }} `duplicates` are table type tags
 */
export function studioProblems(space, items) {
  const studios = countedStudios(items);
  const rank = roomOf(space).rank;
  const minRank = spaceRules().studioMinRank;
  const seen = new Set(countedStudios(spaceGroupFurniture(space)).map(studioTypeOf).filter(Boolean));
  const duplicates = [];
  for (const studio of studios) {
    const type = studioTypeOf(studio);
    if (!type) continue;
    if (seen.has(type) && !duplicates.includes(type)) duplicates.push(type);
    seen.add(type);
  }
  return { studios, rank, minRank, tooSmall: studios.length > 0 && rank < minRank, duplicates };
}

/**
 * Ask a Rule Break when `items` hold a studio the space cannot take as the rules stand: the group is below rank
 * `studioMinRank`, or it already has a studio for that table type. One question covers both. Never blocks.
 * @param {Actor} space
 * @param {Array<object>} items item data or documents about to land in the space
 * @param {{ ruleBreak?: boolean, interactive?: boolean }} [options] as `confirmRuleBreak`'s
 * @returns {Promise<{ ok: true, ruleBreak: boolean } | { ok: false, reason: 'noStudio' }>}
 */
export async function confirmStudioFor(space, items, options = {}) {
  const found = studioProblems(space, items);
  if (!found.tooSmall && !found.duplicates.length) return { ok: true, ruleBreak: false };
  const names = found.studios.map(s => s.name).join(', ');
  const sentences = [];
  if (found.tooSmall) {
    sentences.push(roomText('StudioRank', { space: space.name, rank: found.rank, min: found.minRank },
      `${space.name} is rank ${found.rank}; a studio needs rank ${found.minRank} or more.`));
  }
  for (const type of found.duplicates) {
    const label = getTagDefinition(type)?.label || type;
    sentences.push(roomText('StudioDuplicate', { space: space.name, type: label }, `${space.name} already has a studio for ${label}.`));
  }
  const problem = sentences.join(' ');
  const confirm = await confirmRuleBreak({
    title: 'Studio',
    message: `${problem} ${roomText('StudioAsk', { names }, `Add ${names} anyway as a Rule Break?`)}`,
    reason: `${space.name}: ${problem}`,
    options
  });
  return confirm.confirmed ? { ok: true, ruleBreak: true } : { ok: false, reason: 'noStudio' };
}

/** Stamp `flags.<system>.ruleBreak` on the studios in item data `list`, as deposits record a break. */
export function stampStudioRuleBreaks(list) {
  for (const data of countedStudios(list)) {
    data.flags = withRuleBreak(data).flags;
  }
  return list;
}
