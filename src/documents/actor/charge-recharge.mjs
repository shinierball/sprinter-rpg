import { isActiveGM } from '../../utils/gm-relay.mjs';
import { TIME_UNITS, amountSeconds, timingAmount } from '../../utils/time/timing.mjs';
import { normalizeRecharge, rechargeOnRest, rechargeTick } from '../../utils/time/recharge.mjs';
import { chargesAfterRecharge } from '../../utils/loot/outcome-defaults.mjs';
import { readChanged, sweepActors } from './duration-expiry.mjs';

/**
 * The charges timeline in play (`system.charges.recharge`; the shape and the pure rules are in
 * `utils/time/recharge.mjs`). Rest units refill in `rest()` beside the cooldown resets; time units refill on the world
 * clock (the active GM's sweep, with a stamp `nextAt` kept on the item); scene and floor units refill when a scene
 * boundary or a floor change is announced. A refill posts no chat card.
 *
 * Stamping is a rule, not only a follow-up to a spend: after any create or update of an item with a time-unit timeline, charges
 * below max and no `nextAt`, `nextAt` is `now + length`; at max it is null. The sweep stamps any item it finds unstamped
 * (an item imported below max, or one a migration write left unstamped).
 */

const asArray = (list) => (Array.isArray(list) ? list : Array.from(list?.values?.() ?? list ?? []));
const NEXT_AT = 'system.charges.recharge.nextAt';

const worldNow = () => Number(globalThis.game?.time?.worldTime) || 0;

/** The timeline of an item, or null when it has none. */
function timelineOf(item) {
  const raw = item?.system?.charges?.recharge;
  return raw && typeof raw === 'object' ? normalizeRecharge(raw) : null;
}

/** Whether the timeline's unit is of `kind` (time, period or rest). */
function hasUnitOfKind(rc, kind) {
  return Boolean(rc) && TIME_UNITS[rc.unit]?.kind === kind;
}

/** One timeline length in seconds (after `scaleBy`), 0 when the unit is not a time unit or the scaling reads 0. */
function lengthOf(item, rc) {
  if (!hasUnitOfKind(rc, 'time')) return 0;
  const owner = item.actor ?? item.parent ?? null;
  const amount = timingAmount(rc, { actor: owner, source: item, carrier: item, row: rc, context: { phase: 'use', item } });
  return amountSeconds(rc.unit, amount) ?? 0;
}

/**
 * Item updates merged by `_id` (a later list's keys win), in first-seen order.
 * @param {...object[]} lists `updateEmbeddedDocuments('Item', ...)` payloads
 * @returns {object[]}
 */
export function mergeItemUpdates(...lists) {
  const byId = new Map();
  for (const update of lists.flat()) {
    if (!update) continue;
    byId.set(update._id, { ...(byId.get(update._id) ?? {}), ...update });
  }
  return [...byId.values()];
}

/**
 * The stamp for an item's state after a write: `nextAt = now + length` when a time-unit timeline has charges below max
 * and no stamp; null (cleared) when the item is full or the timeline is not a time unit and a stale stamp remains.
 * @param {object} item the owned item (for the scaling's actor)
 * @param {{ value: *, max: *, recharge: object|null }} state charges and timeline after the write
 * @returns {{ nextAt: number|null }|null} what to write, or null when nothing changes
 */
function stampFor(item, state) {
  const rc = state.recharge ? normalizeRecharge(state.recharge) : null;
  if (!rc) return null;
  const max = Math.floor(Number(state.max)) || 0;
  const value = Math.max(0, Math.floor(Number(state.value)) || 0);
  if (!hasUnitOfKind(rc, 'time') || value >= max) return rc.nextAt === null ? null : { nextAt: null };
  if (rc.nextAt !== null) return null;
  const length = lengthOf(item, rc);
  return length > 0 ? { nextAt: worldNow() + length } : null;
}

/** `COGItem#_preCreate`: an item created below max with a time-unit timeline gets its first `nextAt`. No return value. */
export function stampRechargeOnCreate(item) {
  const owner = item?.actor ?? item?.parent ?? null;
  if (!owner?.items) return;
  const charges = item.system?.charges;
  const patch = charges ? stampFor(item, { value: charges.value, max: charges.max, recharge: charges.recharge }) : null;
  if (patch) item.updateSource({ [NEXT_AT]: patch.nextAt });
}

/**
 * `COGItem#_preUpdate`: the stamp after the update lands. Writes into `changed`, never over a `nextAt` the update sets
 * itself (the sweep and the rest write theirs). No return value (a pre-hook that returns false cancels the write).
 */
export function stampRechargeOnUpdate(item, changed) {
  const owner = item?.actor ?? item?.parent ?? null;
  const charges = item?.system?.charges;
  if (!owner?.items || !charges || readChanged(changed, NEXT_AT) !== undefined) return;
  const after = (key) => readChanged(changed, `system.charges.${key}`) ?? charges[key];
  const recharge = { ...(charges.recharge ?? {}) };
  for (const key of ['value', 'unit', 'scaleBy', 'amount', 'nextAt']) {
    const next = readChanged(changed, `system.charges.recharge.${key}`);
    if (next !== undefined) recharge[key] = next;
  }
  const patch = stampFor(item, { value: after('value'), max: after('max'), recharge });
  if (!patch) return;
  if (changed.system && typeof changed.system === 'object') globalThis.foundry.utils.setProperty(changed, NEXT_AT, patch.nextAt);
  else changed[NEXT_AT] = patch.nextAt;
}

/** The items of `actor` whose timeline has a unit of `kind`. */
const timelineItems = (actor, kind) => asArray(actor?.items).filter((item) => hasUnitOfKind(timelineOf(item), kind));
const chargesOf = (item) => ({ value: item.system.charges.value, max: item.system.charges.max });

/**
 * What a rest of `level` gives the rest-unit timelines: `{ _id, 'system.charges.value' }` entries, merged by the
 * caller with the cooldown resets into the rest's one item update.
 * @param {object} actor
 * @param {number} level 0 (the 1-hour rest) | 1 | 2 | 3
 * @returns {object[]}
 */
export function restRechargeUpdates(actor, level) {
  if (!(level > 0)) return [];
  const updates = [];
  for (const item of timelineItems(actor, 'rest')) {
    const refilled = rechargeOnRest(chargesOf(item), timelineOf(item), level);
    const have = Math.max(0, Math.floor(Number(item.system.charges.value)) || 0);
    if (refilled !== null && refilled > have) updates.push({ _id: item.id ?? item._id, 'system.charges.value': refilled });
  }
  return updates;
}

/**
 * The world-clock sweep (the active GM's `updateWorldTime` handler): every time-unit timeline gets one clock step; an
 * unstamped item below max is stamped (self-heal). One update per actor.
 * @param {number} [now] world time
 * @returns {Promise<number>} the number of items written
 */
async function sweepRecharges(now = globalThis.game?.time?.worldTime) {
  const time = Number(now) || 0;
  let written = 0;
  for (const actor of sweepActors()) {
    const updates = [];
    for (const item of timelineItems(actor, 'time')) {
      const rc = timelineOf(item);
      const tick = rechargeTick(chargesOf(item), rc, time, lengthOf(item, rc));
      if (tick.gained === 0 && tick.nextAt === rc.nextAt) continue;
      const update = { _id: item.id ?? item._id, [NEXT_AT]: tick.nextAt };
      if (tick.gained > 0) update['system.charges.value'] = tick.value;
      updates.push(update);
    }
    if (!updates.length) continue;
    await actor.updateEmbeddedDocuments('Item', updates);
    written += updates.length;
  }
  return written;
}

/**
 * A scene boundary or a floor change refills the items whose timeline runs on that period.
 * @param {'scene'|'floor'} token the period token a unit compares
 * @returns {Promise<number>} the number of items written
 */
async function refillPeriod(token) {
  let written = 0;
  for (const actor of sweepActors()) {
    const updates = [];
    for (const item of timelineItems(actor, 'period')) {
      const rc = timelineOf(item);
      if (TIME_UNITS[rc.unit].token !== token) continue;
      const after = chargesAfterRecharge(chargesOf(item), { full: rc.amount === null, amount: rc.amount });
      if (after.gained > 0) updates.push({ _id: item.id ?? item._id, 'system.charges.value': after.value });
    }
    if (!updates.length) continue;
    await actor.updateEmbeddedDocuments('Item', updates);
    written += updates.length;
  }
  return written;
}

let hooks = null;
/** Register the sweep and the period refills (the active GM only at run time). Once, from the ready hook. */
export function registerRechargeHooks() {
  if (hooks) return;
  hooks = [
    ['updateWorldTime', (worldTime) => { if (isActiveGM()) return sweepRecharges(worldTime); }],
    ['cogSceneBoundary', () => { if (isActiveGM()) return refillPeriod('scene'); }],
    ['cogFloorChanged', () => { if (isActiveGM()) return refillPeriod('floor'); }]
  ];
  for (const [name, fn] of hooks) globalThis.Hooks?.on?.(name, fn);
}
