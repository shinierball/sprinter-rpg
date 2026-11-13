/**
 * Locking percent Stat bonuses. In `fixed` mode (the book, Core Rulebook p.222) a `grants[kind: stat]`
 * row with a `percent` is worked out once, when the item lands on an actor, and the number is kept on the row as
 * `locked`. Buff and debuff rows never lock: they are always live.
 */
import { SYSTEM_ID } from '../../constants.mjs';
import { resolveBaseScore } from '../../models/actors/actor-derivation.mjs';
import { PERCENT_STAT_MODES, percentStatMode, roundPercent } from '../../utils/character/stat-percent.mjs';
import { EFFECT_ITEM_TYPES } from '../../utils/document-types.mjs';

/** Item types whose percent is always live and so never locks. */
const ALWAYS_LIVE_TYPES = new Set(EFFECT_ITEM_TYPES);

const isPercentRow = (g) => g?.kind === 'stat' && (!g.mode || g.mode === 'fixed') && Number(g.percent) !== 0 && Number.isFinite(Number(g.percent));
const isEmptyLock = (g) => g?.locked === null || g.locked === undefined || g.locked === '';

/** The item flag naming the actor its lock was worked out for (an item flag, so no schema field). */
export const PERCENT_LOCK_OWNER_FLAG = 'percentLockOwner';
const OWNER_FLAG_PATH = `flags.${SYSTEM_ID}.${PERCENT_LOCK_OWNER_FLAG}`;

/** The uuid an actor's locks are filed under; '' while it has no id yet. */
function lockOwnerKey(actor) {
  if (!actor) return '';
  const uuid = typeof actor.uuid === 'string' ? actor.uuid : '';
  if (uuid) return uuid;
  const id = actor.id ?? actor._source?._id;
  return typeof id === 'string' && id ? `Actor.${id}` : '';
}

/** The owner recorded on an item or item source; anything but a non-empty string reads as no owner. */
function readLockOwner(item) {
  const flags = item?.flags ?? item?._source?.flags;
  const val = flags?.[SYSTEM_ID]?.[PERCENT_LOCK_OWNER_FLAG];
  return typeof val === 'string' ? val.trim() : '';
}

/** Whether an actor has Stats at all (a personal space or other Stat-less actor does not). */
const hasStats = (actor) => !!actor?.system?.abilities && typeof actor.system.abilities === 'object';

/** Whether an item source has any percent row that locks. */
const hasPercentRows = (item) => Array.from(item?.system?.grants ?? []).some(isPercentRow);

/** Whether an item type takes a lock. */
const itemTypeLocks = (type) => !ALWAYS_LIVE_TYPES.has(type);

/**
 * The base score a percent is taken from (`unenhanced`, D2).
 * @param {object} abilities an actor's `system.abilities`
 * @param {string} stat
 */
function unenhancedOf(abilities, stat) {
  return resolveBaseScore(abilities?.[String(stat ?? '').toLowerCase().trim()]);
}

/**
 * A copy of `grants` with every percent stat row locked against `abilities`. With `onlyEmpty` a row that already
 * has a `locked` number keeps it (the setting's one-time pass); otherwise every row is re-worked (create and trade).
 * @param {object[]} grants
 * @param {object} abilities
 * @param {{ onlyEmpty?: boolean }} [opts]
 * @returns {{ grants: object[], changed: boolean }}
 */
export function lockStatRows(grants, abilities, { onlyEmpty = false } = {}) {
  let changed = false;
  const out = (Array.isArray(grants) ? grants : []).map((g) => {
    if (!isPercentRow(g) || (onlyEmpty && !isEmptyLock(g))) return g;
    const locked = roundPercent(unenhancedOf(abilities, g.stat), g.percent);
    if (g.locked === locked) return g;
    changed = true;
    return { ...(typeof g.toObject === 'function' ? g.toObject() : g), locked };
  });
  return { grants: out, changed };
}

/**
 * `COGItem#_preCreate`: an item created on an actor locks its percent rows against that actor's unenhanced scores.
 * It always re-works the numbers, so a trade (create on the new owner) locks for the new owner. In live mode the
 * rows are left unlocked (`null`) so a later switch to fixed locks them against the Stats of that moment.
 * @param {object} item the item being created (a document with `updateSource`)
 * @returns {boolean} whether a write happened
 */
export function lockItemOnCreate(item) {
  const actor = item?.parent;
  if (!actor || !itemTypeLocks(item.type)) return false;
  const rows = Array.from(item.system?.grants ?? []);
  if (!rows.some(isPercentRow)) return false;
  if (percentStatMode() === PERCENT_STAT_MODES.LIVE) {
    if (rows.every(isEmptyLock)) return false;
    item.updateSource({ 'system.grants': rows.map((g) => ({ ...(g.toObject?.() ?? g), locked: null })) });
    return true;
  }
  // The number is set when you get the item. A move into a Stat-less actor (a vault) or back to the actor it was
  // worked out for keeps it; any other actor re-locks and takes the flag.
  if (!hasStats(actor)) return false;
  const key = lockOwnerKey(actor);
  if (key && readLockOwner(item) === key) return false;
  const { grants: next, changed } = lockStatRows(rows, actor.system?.abilities);
  const flagChanged = !!key && readLockOwner(item) !== key;
  if (!changed && !flagChanged) return false;
  const update = {};
  if (changed) update['system.grants'] = next;
  if (flagChanged) update[OWNER_FLAG_PATH] = key;
  item.updateSource(update);
  return true;
}

/**
 * `COGActor#_preCreate`: Foundry runs `_preCreate` for top-level documents only, so items that arrive inside
 * `Actor.create({ items })` (the creator, a duplicate) are locked here against the new actor's scores.
 * @param {object} actor the actor being created (a document with `updateSource`)
 * @returns {boolean} whether a write happened
 */
export function lockEmbeddedOnActorCreate(actor) {
  if (percentStatMode() === PERCENT_STAT_MODES.LIVE) return false;
  const source = Array.from(actor?._source?.items ?? []);
  const updates = [];
  const key = lockOwnerKey(actor);
  for (const item of source) {
    if (!item || !itemTypeLocks(item.type)) continue;
    const { grants, changed } = lockStatRows(item.system?.grants, actor.system?.abilities);
    const flagChanged = !!key && hasPercentRows(item) && readLockOwner(item) !== key;
    if (!changed && !flagChanged) continue;
    const update = { _id: item._id };
    if (changed) update.system = { grants };
    if (flagChanged) update.flags = { [SYSTEM_ID]: { [PERCENT_LOCK_OWNER_FLAG]: key } };
    updates.push(update);
  }
  if (!updates.length) return false;
  actor.updateSource({ items: updates });
  return true;
}

/**
 * `COGActor#_onCreate` (the creating client): when the actor's id was not known in `_preCreate`, the embedded items
 * could not be filed under it there, so they are stamped now. Items already filed under this actor are left alone.
 * @param {object} actor the created actor
 * @returns {Promise<number>} items updated
 */
export async function stampLockOwnerOnActorCreated(actor) {
  if (percentStatMode() === PERCENT_STAT_MODES.LIVE) return 0;
  const key = lockOwnerKey(actor);
  if (!key) return 0;
  const updates = [];
  for (const item of Array.from(actor.items ?? [])) {
    if (!itemTypeLocks(item.type) || !hasPercentRows(item) || readLockOwner(item) === key) continue;
    updates.push({ _id: item.id ?? item._id, [OWNER_FLAG_PATH]: key });
  }
  if (!updates.length) return 0;
  await actor.updateEmbeddedDocuments('Item', updates);
  return updates.length;
}

/**
 * The setting's `onChange` (GM client only): on a switch to `fixed`, every owned percent row that is still `null`
 * is locked once. A switch to `live` ignores `locked` and leaves it in place.
 * @param {string} mode the new setting value
 * @param {Iterable<object>} [actors] defaults to `game.actors`
 * @returns {Promise<number>} items updated
 */
export async function lockOwnedPercentRows(mode, actors = globalThis.game?.actors) {
  if (mode !== PERCENT_STAT_MODES.FIXED || !globalThis.game?.user?.isGM) return 0;
  let count = 0;
  for (const actor of (actors ?? [])) {
    const updates = [];
    const key = lockOwnerKey(actor);
    for (const item of (actor.items ?? [])) {
      if (!itemTypeLocks(item.type)) continue;
      const { grants, changed } = lockStatRows(Array.from(item.system?.grants ?? []), actor.system?.abilities, { onlyEmpty: true });
      const flagChanged = !!key && hasStats(actor) && hasPercentRows(item) && readLockOwner(item) !== key;
      if (!changed && !flagChanged) continue;
      const update = { _id: item.id ?? item._id };
      if (changed) update['system.grants'] = grants;
      if (flagChanged) update[OWNER_FLAG_PATH] = key;
      updates.push(update);
    }
    if (updates.length) {
      await actor.updateEmbeddedDocuments('Item', updates);
      count += updates.filter((u) => 'system.grants' in u).length;
    }
  }
  return count;
}
