/**
 * Damage-undo records. Each damage application leaves a record on the
 * target actor holding the HP and temp-bar state before and after. Undo gives back what the application
 * took, capped at the before-state, so later damage or healing from other sources is kept.
 *
 * Imports only SYSTEM_ID: combat-metrics.mjs imports this module, so it must not import documents or apps.
 */
import { SYSTEM_ID } from '../constants.mjs';

export const DAMAGE_UNDO_FLAG = 'damageUndo';
export const MAX_DAMAGE_UNDO_RECORDS = 20;
export const MAX_APPLICATION_ID_LENGTH = 64;

const ID_CHARS = '0123456789abcdefghijklmnopqrstuvwxyz';

/** A new application id: foundry.utils.randomID() when present, else 16 chars from [0-9a-z]. */
export function newApplicationId() {
  const id = globalThis.foundry?.utils?.randomID?.();
  if (isApplicationId(id)) return id;
  let out = '';
  for (let i = 0; i < 16; i++) out += ID_CHARS[Math.floor(Math.random() * ID_CHARS.length)];
  return out;
}

/**
 * A non-empty string of at most 64 ASCII letters/digits. Checked char by char (no regex): the id is used as
 * a key in a dotted flag path and must not contain '.', '-' or '='.
 */
export function isApplicationId(id) {
  if (typeof id !== 'string' || !id || id.length > MAX_APPLICATION_ID_LENGTH) return false;
  for (let i = 0; i < id.length; i++) {
    const c = id.charCodeAt(i);
    const ok = (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
    if (!ok) return false;
  }
  return true;
}

const num = (x) => Number(x) || 0;

/** Total temp-bar HP (same formula as COGDamage.applyDamageToTarget). */
export function tempBarsPool(tb) {
  const count = num(tb?.count);
  const hpPerSlot = num(tb?.hpPerSlot);
  if (!(count > 0 && hpPerSlot > 0)) return 0;
  return (count - 1) * hpPerSlot + (num(tb?.currentSlotHp) || hpPerSlot);
}

/** HpSnap of an actor: { hp, temp, tempBars|null }. */
export function snapshotHpPools(actor) {
  const hp = actor?.system?.attributes?.hp;
  const tb = hp?.tempBars;
  return {
    hp: num(hp?.value),
    temp: num(hp?.temp),
    tempBars: tb && typeof tb === 'object'
      ? {
        count: num(tb.count),
        currentSlotHp: num(tb.currentSlotHp),
        hpPerSlot: num(tb.hpPerSlot),
        source: String(tb.source ?? ''),
        sourceUuid: String(tb.sourceUuid ?? ''),
        element: String(tb.element ?? '')
      }
      : null
  };
}

/** The actor's valid records (flag value is an array of objects with a valid applicationId). */
export function getDamageUndoRecords(actor) {
  const raw = actor?.getFlag?.(SYSTEM_ID, DAMAGE_UNDO_FLAG) ?? actor?.flags?.[SYSTEM_ID]?.[DAMAGE_UNDO_FLAG];
  if (!Array.isArray(raw)) return [];
  return raw.filter(r => r && typeof r === 'object' && isApplicationId(r.applicationId));
}

export function findDamageUndoRecord(actor, applicationId) {
  return getDamageUndoRecords(actor).find(r => r.applicationId === applicationId) ?? null;
}

/** Append (replacing any record with the same id), keep the newest MAX by `at`, setFlag. */
export async function appendDamageUndoRecord(actor, record) {
  const kept = getDamageUndoRecords(actor).filter(r => r.applicationId !== record.applicationId);
  kept.push(record);
  kept.sort((a, b) => num(a.at) - num(b.at));
  const pruned = kept.slice(-MAX_DAMAGE_UNDO_RECORDS);
  await actor.setFlag(SYSTEM_ID, DAMAGE_UNDO_FLAG, pruned);
}

/** Set undoneAt/undoneBy on one record and setFlag. Returns false if the record is absent. */
export async function markDamageUndoRecord(actor, applicationId, { undoneAt, undoneBy }) {
  const records = getDamageUndoRecords(actor);
  const rec = records.find(r => r.applicationId === applicationId);
  if (!rec) return false;
  const next = records.map(r => (r === rec ? { ...r, undoneAt, undoneBy } : r));
  await actor.setFlag(SYSTEM_ID, DAMAGE_UNDO_FLAG, next);
  return true;
}

/** Mark (or, with `used` false, unmark) one earned reflection (by index) on a record and setFlag. Returns false if the record is absent or has none. */
export async function markDamageUndoReflected(actor, applicationId, index, used = true) {
  const records = getDamageUndoRecords(actor);
  const rec = records.find(r => r.applicationId === applicationId);
  if (!rec?.reflect || typeof rec.reflect !== 'object') return false;
  const list = (Array.isArray(rec.reflect.used) ? rec.reflect.used : []).filter(i => Number.isInteger(i) && i !== index);
  if (used) list.push(index);
  const next = records.map(r => (r === rec ? { ...r, reflect: { ...r.reflect, used: list } } : r));
  await actor.setFlag(SYSTEM_ID, DAMAGE_UNDO_FLAG, next);
  return true;
}

/** Mark one record's kill award as paid (3.56e) and setFlag. Returns false if the record is absent. */
export async function markDamageUndoKillAwarded(actor, applicationId) {
  const records = getDamageUndoRecords(actor);
  const rec = records.find(r => r.applicationId === applicationId);
  if (!rec) return false;
  const next = records.map(r => (r === rec ? { ...r, killAwarded: true } : r));
  await actor.setFlag(SYSTEM_ID, DAMAGE_UNDO_FLAG, next);
  return true;
}

/** Store inflictedItemIds on one record and setFlag. Returns false if the record is absent. */
export async function setDamageUndoInflictedItems(actor, applicationId, inflictedItemIds) {
  const records = getDamageUndoRecords(actor);
  const rec = records.find(r => r.applicationId === applicationId);
  if (!rec) return false;
  const ids = Array.isArray(inflictedItemIds) ? inflictedItemIds.filter(id => typeof id === 'string' && Boolean(id)) : [];
  const next = records.map(r => (r === rec ? { ...r, inflictedItemIds: ids } : r));
  await actor.setFlag(SYSTEM_ID, DAMAGE_UNDO_FLAG, next);
  return true;
}

const HP_PATH = 'system.attributes.hp';
const barsActive = (tb) => Boolean(tb) && num(tb.count) > 0 && num(tb.hpPerSlot) > 0;

/**
 * Update data that gives back what `record` took from `actor`'s current pools, capped at record.before.
 * @returns {{ updates: object, hpRestored: number, tempRestored: number, tempBarsSkipped: boolean }}
 */
export function computeUndoUpdates(record, actor) {
  const updates = {};
  let hpRestored = 0;
  let tempRestored = 0;
  let tempBarsSkipped = false;
  const cur = snapshotHpPools(actor);
  const b = record?.before ?? {};
  const a = record?.after ?? {};

  const hpLost = Math.max(0, num(b.hp) - num(a.hp));
  if (hpLost > 0) {
    const max = Number(actor?.system?.attributes?.hp?.max);
    const cap = Number.isFinite(max) && max > 0 ? Math.max(max, num(b.hp)) : Infinity;
    const newHp = Math.min(cur.hp + hpLost, Math.max(cap, cur.hp));
    if (newHp > cur.hp) {
      updates[`${HP_PATH}.value`] = newHp;
      hpRestored = newHp - cur.hp;
    }
  }

  if (barsActive(b.tempBars)) {
    const lost = tempBarsPool(b.tempBars) - tempBarsPool(a.tempBars);
    const curActive = barsActive(cur.tempBars);
    if (lost > 0) {
      if (curActive && cur.tempBars.sourceUuid !== b.tempBars.sourceUuid) {
        tempBarsSkipped = true;
      } else {
        const hps = curActive ? cur.tempBars.hpPerSlot : num(b.tempBars.hpPerSlot);
        const curPool = curActive ? tempBarsPool(cur.tempBars) : 0;
        const newPool = Math.min(curPool + lost, Math.max(curPool, tempBarsPool(b.tempBars)));
        if (newPool > curPool) {
          const rem = newPool % hps;
          updates[`${HP_PATH}.tempBars.count`] = Math.ceil(newPool / hps);
          updates[`${HP_PATH}.tempBars.currentSlotHp`] = rem === 0 ? hps : rem;
          updates[`${HP_PATH}.temp`] = newPool;
          if (!curActive) {
            updates[`${HP_PATH}.tempBars.hpPerSlot`] = hps;
            updates[`${HP_PATH}.tempBars.source`] = b.tempBars.source ?? '';
            updates[`${HP_PATH}.tempBars.sourceUuid`] = b.tempBars.sourceUuid ?? '';
            updates[`${HP_PATH}.tempBars.element`] = b.tempBars.element ?? '';
          }
          tempRestored = newPool - curPool;
        }
      }
    }
  } else {
    const lost = Math.max(0, num(b.temp) - num(a.temp));
    const newTemp = Math.min(cur.temp + lost, Math.max(cur.temp, num(b.temp)));
    if (newTemp > cur.temp) {
      updates[`${HP_PATH}.temp`] = newTemp;
      tempRestored = newTemp - cur.temp;
    }
  }

  return { updates, hpRestored, tempRestored, tempBarsSkipped };
}

const inFlight = new Set();

/** In-flight guard on the writing client: returns false if the key is already claimed. */
export function claimUndo(key) {
  if (inFlight.has(key)) return false;
  inFlight.add(key);
  return true;
}

export function releaseUndo(key) {
  inFlight.delete(key);
}
