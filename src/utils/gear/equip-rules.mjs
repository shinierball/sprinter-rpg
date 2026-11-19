/**
 * Equip rules: what an equip asks a Rule Break about. Body fit (body-fit.mjs) and the gear slot limits (core pp.98-99: one
 * item per slot, ten accessories, and one belt among them). Pure: item data in, problems out; nothing blocks.
 *
 * Only equipped gear documents count, each once whatever its quantity. A held item (one that takes a hand) is judged by the
 * hands the body has, never by its slot, so it is left out of every slot count.
 */
import { GEAR_SLOTS } from './gear-slots.mjs';
import { bodyFitProblem, handsWhenEquipped, isEquipped } from './body-fit.mjs';

/**
 * @typedef {object} SlotLimitProblem
 * @property {'slot-full'|'pool-full'} reason
 * @property {string} slot the slot whose limit is passed
 * @property {string} label human text for the prompt
 * @property {number} count items in the slot with the new one
 * @property {number} limit
 * @property {string[]} names the other equipped items in the slot
 */

const ENGLISH = Object.freeze({
  'COG.SlotLimit.SlotFull': 'The {slot} slot takes {limit}; it already holds {names}.',
  'COG.SlotLimit.PoolFull': 'The {slot} slot takes {limit} items; this would be item {count}.'
});

/** A localized string; the key's English when no catalogue is loaded (or it has no entry). */
function text(key, data) {
  const out = globalThis.game?.i18n?.format?.(key, data);
  if (typeof out === 'string' && out && out !== key) return out;
  return Object.entries(data).reduce((out, [name, value]) => out.replaceAll(`{${name}}`, String(value)), ENGLISH[key]);
}

const slotOf = (item) => (typeof item?.system?.slot === 'string' ? item.system.slot.trim().toLowerCase() : '');
const idOf = (item) => String(item?.id ?? item?._id ?? '');
const isPool = (slot) => Object.values(GEAR_SLOTS).some((def) => def.pool === slot);

/** Whether the item counts toward slot counts when equipped: gear that takes no hands. */
const countsInSlots = (item) => item?.type === 'gear' && handsWhenEquipped(item) === 0;

/** The equipped gear that counts toward slot counts, each document once, without `except`. */
function counted(items, except) {
  const seen = new Set();
  const out = [];
  for (const other of Array.from(items ?? [])) {
    if (!other || other === except || other.type !== 'gear' || !isEquipped(other)) continue;
    const id = idOf(other);
    if (id && (id === idOf(except) || seen.has(id))) continue;
    if (id) seen.add(id);
    if (countsInSlots(other)) out.push(other);
  }
  return out;
}

const inSlot = (item, slot) => slotOf(item) === slot || GEAR_SLOTS[slotOf(item)]?.pool === slot;

/**
 * Slot-limit problems the item would cause if equipped: its own slot, then its slot's pool.
 * @param {object} item the item about to be equipped
 * @param {{ items?: object[] }} ctx the actor's items
 * @returns {SlotLimitProblem[]} [] for a held item, an attack, a slot with no limit or one the registry does not know
 */
function slotLimitProblems(item, { items = [] } = {}) {
  const own = slotOf(item);
  if (!item || !GEAR_SLOTS[own] || !countsInSlots(item)) return [];
  const others = counted(items, item);
  const problems = [];
  for (const slot of [own, GEAR_SLOTS[own].pool]) {
    const def = GEAR_SLOTS[slot];
    if (!def || def.limit === null || def.limit === undefined) continue;
    const there = others.filter((other) => inSlot(other, slot));
    const count = there.length + 1;
    if (count <= def.limit) continue;
    const names = there.map((other) => String(other.name ?? ''));
    const reason = slot === own && !isPool(slot) ? 'slot-full' : 'pool-full';
    const data = { slot: def.label, limit: def.limit, count, names: names.join(', ') };
    problems.push({ reason, slot, label: text(reason === 'slot-full' ? 'COG.SlotLimit.SlotFull' : 'COG.SlotLimit.PoolFull', data), count, limit: def.limit, names });
  }
  return problems;
}

/** Whether a problem from `equipProblems` is a slot limit (not a body-fit one). */
export const isSlotLimitProblem = (problem) => problem?.reason === 'slot-full' || problem?.reason === 'pool-full';

/**
 * Every problem an equip asks about, in prompt order: body fit, then slot limits.
 * @param {object} item
 * @param {{ items?: object[], limbs?: object|null }} ctx `limbs` null is an actor with no body: nothing is asked
 * @returns {Array<{ reason: string, label: string }>}
 */
export function equipProblems(item, { items = [], limbs } = {}) {
  if (limbs === null) return [];
  const fit = bodyFitProblem(item, { items, limbs: limbs ?? null });
  return [...(fit ? [fit] : []), ...slotLimitProblems(item, { items })];
}

/**
 * For the sheet readout: every registered slot with a limit and how full it is.
 * @param {object[]} items the actor's items
 * @returns {Record<string, { count: number, limit: number, over: boolean, names: string[] }>}
 */
export function slotUse(items) {
  const equipped = counted(items, null);
  const use = {};
  for (const [slot, def] of Object.entries(GEAR_SLOTS)) {
    if (def.limit === null || def.limit === undefined) continue;
    const there = equipped.filter((item) => inSlot(item, slot));
    use[slot] = { count: there.length, limit: def.limit, over: there.length > def.limit, names: there.map((item) => String(item.name ?? '')) };
  }
  return use;
}
