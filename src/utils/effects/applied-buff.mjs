import { actingRank } from '../skill/rank-source.mjs';
import { effectiveDuration } from '../time/durations.mjs';
import { timingAmount, TIME_UNITS } from '../time/timing.mjs';
import { findConditionEntry } from '../../content/catalog-lookup.mjs';
import { carrySourceStamp } from '../content-source.mjs';
import { matchesTagQuery } from '../tag/tag-query.mjs';
import { getTagDefinition } from '../../data/tag-definitions.mjs';
import { readFlag, withFlags } from '../flags.mjs';
import { tagCatalog } from '../tag/tag-list.mjs';

/**
 * A buff a Skill or spell applies to people (`system.appliedBuffs`): which rows are in force at a Rank, the Rank and
 * duration a copy carries, the data of the copy, and who is a doubtful recipient. Pure: nothing here reads a scene,
 * writes a document or asks anyone; the card and the landing (`documents/actor/item-buffs.mjs`) build on it.
 */

/** The element of a use card that holds one block's "Applied to" notice and Remove button (`data-row` is the block's row). */
export const ITEM_BUFF_SLOT = 'cog-item-buff-slot';

/** How a target tag's recipients are found. Each is code (gathering from the scene), so the list is closed. */
const BUFF_GATHERS = Object.freeze(['self', 'chosen', 'party', 'allies', 'everyone']);

const SELF_SPEC = Object.freeze({ gather: 'self', where: null, label: 'Self Only' });

/**
 * A target tag's recipients block. An unknown tag, one with no block, or one naming a gather that does not exist
 * behaves as `target.self`.
 * @param {string} targetTagId a `target.*` tag id
 * @returns {{ gather: string, where: object|Array|string|null, label: string }}
 */
function recipientSpecOf(targetTagId) {
  const def = getTagDefinition(targetTagId);
  const block = def?.recipients;
  if (!block || typeof block !== 'object' || !BUFF_GATHERS.includes(block.gather)) return { ...SELF_SPEC };
  return { gather: block.gather, where: block.where ?? null, label: def.label || targetTagId };
}

/** Whether a tag id has a valid recipients block: the tags a row may name as its target. */
export function hasRecipientsBlock(targetTagId) {
  const block = getTagDefinition(targetTagId)?.recipients;
  return Boolean(block) && typeof block === 'object' && BUFF_GATHERS.includes(block.gather);
}

/**
 * The tags a row's Target may name: every registered `target.*` tag with a recipients block, core and custom, in
 * registration order.
 * @returns {Array<{ id: string, label: string }>}
 */
export function buffTargetTags() {
  return tagCatalog().filter((tag) => tag.id.startsWith('target.') && hasRecipientsBlock(tag.id)).map(({ id, label }) => ({ id, label }));
}

/**
 * Who a row reaches and how far: the target tag's recipients block and the reach in feet. A reach of 0 is the item's
 * own Range for one chosen creature (`itemReach`, worked out by the caller with the rank-break bonus) and no limit
 * for any other target.
 * @param {object} row an `appliedBuffs` row
 * @param {number} [itemReach] the item's own Range in feet
 * @returns {{ spec: { gather: string, where: *, label: string }, reach: number }}
 */
export function rowRecipients(row, itemReach = 0) {
  const spec = recipientSpecOf(row?.target);
  const own = Math.max(0, Number(row?.range) || 0);
  return { spec, reach: own > 0 ? own : (spec.gather === 'chosen' ? Math.max(0, Number(itemReach) || 0) : 0) };
}


/**
 * The rows of an item's `appliedBuffs` in force at a Rank: a buff named, and the Rank between `minRank` and `maxRank`
 * (a blank `maxRank` has no ceiling). Rank 0 gives none.
 * @param {object} item a skill or spell
 * @param {number} rank the Rank the item is used at
 * @returns {Array<{ index: number, row: object }>} each row with its place in the array
 */
export function appliedBuffRowsAt(item, rank) {
  const at = Number(rank) || 0;
  if (at <= 0) return [];
  const rows = item?.system?.appliedBuffs;
  if (!Array.isArray(rows)) return [];
  const out = [];
  rows.forEach((row, index) => {
    if (!row || typeof row !== 'object' || !String(row.buff ?? '').trim()) return;
    if (at < (Number(row.minRank) || 0)) return;
    const max = row.maxRank;
    if (max !== null && max !== undefined && max !== '' && Number.isFinite(Number(max)) && at > Number(max)) return;
    out.push({ index, row });
  });
  return out;
}

/**
 * The Rank a copy carries: the row's own `rank` when above 0; else the holder's Rank in the skill `rankSkill` names (0
 * when the holder has none); else the Rank the item was used at.
 * @param {Actor} holder the caster
 * @param {object} row an `appliedBuffs` row
 * @param {number} rank the Rank the item was used at
 * @returns {number}
 */
function appliedBuffRank(holder, row, rank) {
  const fixed = Number(row?.rank) || 0;
  if (fixed > 0) return fixed;
  const skillId = String(row?.rankSkill ?? '').trim();
  if (skillId) {
    const skill = typeof holder?.getSkillByIdentifier === 'function' ? holder.getSkillByIdentifier(skillId) : null;
    return skill ? actingRank(skill) : 0;
  }
  return Number(rank) || 0;
}

/**
 * The duration a copy carries: the item's own duration at that Rank, worked out on the caster (a rank-tier override
 * and bonus included, `scaleBy` resolved against the caster and the Rank) and written as a plain amount. Null when
 * the item has no duration of its own: the buff keeps the one it has.
 * @param {Actor} holder the caster
 * @param {object} item the skill or spell
 * @param {number} rank the Rank the item was used at
 * @returns {{ type: string, value: number, scaleBy: null, endsWithCombat: boolean }|null}
 */
function appliedBuffDuration(holder, item, rank) {
  const eff = effectiveDuration(item, { rank });
  if (!eff.type || eff.type === 'instant' || !TIME_UNITS[eff.type]) return null;
  // The Rank an amount scales by is the one the item is used at, not the one it happens to have stored.
  const source = { type: item?.type, system: item?.system, effectiveRank: Number(rank) || 0 };
  const amount = timingAmount({ value: eff.value, unit: eff.type, scaleBy: eff.scaleBy }, { actor: holder ?? null, source }) + eff.bonus;
  return { type: eff.type, value: amount, scaleBy: null, endsWithCombat: eff.endsWithCombat };
}

/**
 * The most copies of a buff a stack may hold: the copy's own Rank when its `repeat.maxFromRank` is set and the Rank is above
 * 0, else `repeat.max`; null when neither names a cap. Pure.
 * @param {object} buffData item data of a buff (a copy about to land)
 * @returns {number|null}
 */
export function stackCapOf(buffData) {
  const repeat = buffData?.system?.repeat ?? {};
  const rank = Math.floor(Number(buffData?.system?.rank));
  if (repeat.maxFromRank === true && rank > 0) return rank;
  const max = Math.floor(Number(repeat.max));
  return max > 0 ? max : null;
}

/**
 * Item data of a catalog buff, in force. By identifier, never by name; an identifier the catalog does not have makes
 * a plain buff named `fallbackName`.
 * @param {string} identifier
 * @param {{ fallbackName?: string, description?: string }} [opts]
 * @returns {object} item creation data
 */
export function buffCopyData(identifier, { fallbackName = 'Buff', description = '' } = {}) {
  const match = findConditionEntry('buffs', identifier);
  if (!match) return { name: fallbackName, type: 'buff', img: 'icons/svg/aura.svg', system: { description, active: true } };
  return carrySourceStamp({
    name: match.name,
    type: 'buff',
    img: match.img || 'icons/svg/aura.svg',
    // An item applied to someone is in force: a buff model defaults to inactive, which would skip its modifiers and its duration stamp
    system: { ...structuredClone(match.system || {}), active: true }
  }, match);
}

/**
 * The stamp a buff copy carries about who applied it (`appliedBy`), or null when the buff is the holder's own. The one
 * reader: the card's Remove button, the duration engine and the minion rules all ask here.
 * @param {object} item the buff
 * @returns {{ messageId?: string, row?: number, sourceUuid?: string, sourceName?: string, casterUuid?: string }|null}
 */
export function appliedByOf(item) {
  return readFlag(item, 'appliedBy') ?? null;
}

/**
 * The copy one row lands on a recipient: the catalog buff, the Rank and duration it carries, and the stamp that says
 * who applied it (`appliedBy`: the card, the row, the item and the caster).
 * @param {Actor} holder the caster
 * @param {object} item the skill or spell
 * @param {{ index: number, row: object }} entry a row from `appliedBuffRowsAt`
 * @param {{ rank: number, messageId?: string }} use the Rank the item was used at and the card's message id
 * @returns {object} item creation data
 */
export function buildAppliedBuff(holder, item, { index, row }, { rank, messageId = '' }) {
  const data = buffCopyData(row.buff);
  const duration = appliedBuffDuration(holder, item, rank);
  data.system = {
    ...data.system,
    rank: appliedBuffRank(holder, row, rank),
    ...(duration ? { durationConfig: { ...(data.system.durationConfig ?? {}), ...duration } } : {})
  };
  return withFlags(data, {
    appliedBy: { messageId, row: index, sourceUuid: item?.uuid ?? '', sourceName: item?.name ?? '', casterUuid: holder?.uuid ?? '' }
  });
}

/**
 * Why a recipient is doubtful: the buff still lands if the caster confirms. Distance, side and immunity come in with
 * the candidate, already worked out.
 * @param {{ tags: Set<string>|string[], distance: number|null, onScene: boolean, side: 'ally'|'enemy'|'self', immune: boolean }} candidate
 * @param {{ spec: { gather: string, where: * }, reach: number, measured: boolean }} ctx `measured` is false when the caster has no token on the scene
 * @returns {Array<'out-of-reach'|'not-on-scene'|'wrong-kind'|'other-side'|'immune'>}
 */
export function recipientReasons(candidate, { spec, reach, measured }) {
  const reasons = [];
  if (measured) {
    if (!candidate.onScene) reasons.push('not-on-scene');
    else if ((Number(reach) || 0) > 0 && candidate.distance !== null && candidate.distance > reach) reasons.push('out-of-reach');
  }
  if (spec?.where && !matchesTagQuery(candidate.tags ?? [], spec.where)) reasons.push('wrong-kind');
  if (spec?.gather === 'chosen' && candidate.side === 'enemy') reasons.push('other-side');
  if (candidate.immune) reasons.push('immune');
  return reasons;
}
