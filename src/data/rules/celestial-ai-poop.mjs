/**
 * Celestial AI Poop: the do-nothing loot item that stands in for a document a turned-off theme took away. One poop per
 * replaced document; it records the document whole (`flags['sprinter-rpg'].replaced`) so the GM can restore it. It is made
 * by `buildPayload` like any user loot, belongs to no theme (no source stamp) and is never used up. The flavor text is
 * the human's own and is used verbatim.
 */
import { SYSTEM_ID } from '../../constants.mjs';
import { buildPayload } from '../builders/item-payload.mjs';
import { USAGE_KINDS } from '../../utils/tag/tag-mechanics.mjs';

export const CELESTIAL_AI_POOP_IDENTIFIER = 'celestial-ai-poop';
const CELESTIAL_AI_POOP_NAME = 'Celestial AI Poop';
export const CELESTIAL_AI_POOP_FLAVOR = "You got arbitrarily screwed by an AI action. I'm sorry ... wait no I'm not. Fuck you! Toast is delicious!";
/** The key under `flags['sprinter-rpg']` that holds the record of what the poop replaced. */
export const REPLACED_FLAG = 'replaced';

const isPlain = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const ID = /^[a-z0-9._-]{1,40}$/;
const text = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** A deep copy of document data that survives structuredClone failing on odd values. */
function copyData(data) {
  const plain = typeof data?.toObject === 'function' ? data.toObject() : data;
  try { return structuredClone(plain); } catch { return JSON.parse(JSON.stringify(plain)); }
}

/**
 * The record a poop keeps of the document it replaced.
 * @param {object} data the creation data (or document) that was replaced
 * @param {{ replacedAt?: number }} [options]
 * @returns {{ source: { theme: string, set: string }, name: string, type: string, identifier: string, replacedAt: number, data: object }}
 */
export function replacedRecordOf(data, { replacedAt = Date.now() } = {}) {
  const copy = copyData(data);
  const stamp = copy?.flags?.[SYSTEM_ID]?.source;
  return {
    source: { theme: text(stamp?.theme, 40), set: text(stamp?.set, 40) },
    name: text(copy?.name),
    type: text(copy?.type, 40),
    identifier: text(copy?.system?.identifier, 80),
    replacedAt: Number.isFinite(Number(replacedAt)) ? Number(replacedAt) : Date.now(),
    data: copy
  };
}

/**
 * The creation payload of one poop, compiled by `buildPayload`. `replaced` is a record from {@link replacedRecordOf}; the
 * poop takes the replaced document's `_id` when it has one, so a path that tracks its ids (loot box reveals, a race's
 * applied record) still finds a document there.
 * @param {object|null} [replaced]
 * @returns {object}
 */
export function celestialAiPoopPayload(replaced = null) {
  const payload = buildPayload('loot', {
    name: CELESTIAL_AI_POOP_NAME,
    img: 'icons/svg/acid.svg',
    system: {
      identifier: CELESTIAL_AI_POOP_IDENTIFIER,
      description: `<p>${CELESTIAL_AI_POOP_FLAVOR}</p>`,
      value: 0,
      quantity: 1,
      lootType: 'consumable',
      usedInto: 'none',
      outcomes: [],
      tags: [USAGE_KINDS.reusable]
    }
  }, { warnings: [] });
  if (isPlain(replaced)) {
    payload.flags = { ...(payload.flags ?? {}), [SYSTEM_ID]: { ...(payload.flags?.[SYSTEM_ID] ?? {}), [REPLACED_FLAG]: replaced } };
    const id = replaced.data?._id;
    if (typeof id === 'string' && /^[A-Za-z0-9]{16}$/.test(id)) payload._id = id;
  }
  return payload;
}

/**
 * The sanitised record on a poop (or any item): null when there is no `replaced` flag or it is unusable (not an object,
 * no `data` object, no item type to recreate). A usable record always has strings for the display fields.
 * @param {object|null} item an Item document or its data
 * @returns {{ source: { theme: string, set: string }, name: string, type: string, identifier: string, replacedAt: number, data: object }|null}
 */
export function readReplacedRecord(item) {
  let raw;
  try {
    raw = typeof item?.getFlag === 'function' ? item.getFlag(SYSTEM_ID, REPLACED_FLAG) : undefined;
  } catch { raw = undefined; }
  raw ??= item?.flags?.[SYSTEM_ID]?.[REPLACED_FLAG];
  if (!isPlain(raw) || !isPlain(raw.data)) return null;
  const type = text(raw.data.type, 40);
  if (!type) return null;
  const theme = text(raw.source?.theme, 40);
  const set = text(raw.source?.set, 40);
  return {
    source: { theme: ID.test(theme) ? theme : '', set: ID.test(set) ? set : '' },
    name: text(raw.name) || text(raw.data.name),
    type,
    identifier: text(raw.identifier, 80),
    replacedAt: Number.isFinite(Number(raw.replacedAt)) ? Number(raw.replacedAt) : 0,
    data: raw.data
  };
}

/** Whether an item carries a `replaced` flag at all (usable or not). */
export function isPoop(item) {
  let raw;
  try {
    raw = typeof item?.getFlag === 'function' ? item.getFlag(SYSTEM_ID, REPLACED_FLAG) : undefined;
  } catch { raw = undefined; }
  raw ??= item?.flags?.[SYSTEM_ID]?.[REPLACED_FLAG];
  return raw !== undefined && raw !== null;
}
