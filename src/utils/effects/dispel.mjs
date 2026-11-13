/**
 * Dispel: a hit with an On Hit dispel block suspends the
 * target's Buffs until the combat ends. Nothing is deleted. A suppression entry lives in the target's flag
 * `flags.sprinter-rpg.dispels[]`, and every place that reads Buffs asks `isBuffSuppressed(actor, buff)`.
 *
 * An entry: `{ id, source, sourceUuid, applicationId, combatId, count, query, buffKeys }`.
 * - `count` 0 is a standing filter: every Buff whose tags match `query` (empty = all), including Buffs gained later.
 * - `count` N took the first N matching Buffs; `buffKeys` names them and only they are suppressed.
 * - It ends when its combat is gone. With no combat (`combatId` empty) it stays until the GM restores it.
 */
import { SYSTEM_ID } from '../../constants.mjs';
import { matchesTagQuery } from '../tag/tag-query.mjs';
import { isEffectPaused, keptByWorkingGear } from './gear-suppression.mjs';
import { transformationBody } from './debuff-force.mjs';
import { worshipWithholds } from '../deity/worship-state.mjs';
import { buffTagSet, suppressedByDebuff } from './debuff-suppresses.mjs';
import { activationClosed } from './activation-window.mjs';

const FLAG = 'dispels';

const asArray = (list) => (Array.isArray(list) ? list : []);

function newId() {
  const id = globalThis.foundry?.utils?.randomID?.();
  if (typeof id === 'string' && id) return id;
  return Math.random().toString(36).slice(2, 12);
}

function cleanEntry(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || !raw.id) return null;
  return {
    id: raw.id,
    source: typeof raw.source === 'string' ? raw.source : '',
    sourceUuid: typeof raw.sourceUuid === 'string' ? raw.sourceUuid : '',
    applicationId: typeof raw.applicationId === 'string' ? raw.applicationId : '',
    combatId: typeof raw.combatId === 'string' ? raw.combatId : '',
    count: Math.max(0, Math.floor(Number(raw.count)) || 0),
    query: raw.query && typeof raw.query === 'object' ? raw.query : {},
    buffKeys: asArray(raw.buffKeys).filter(k => typeof k === 'string' && k)
  };
}

/** True while the entry's combat still exists (or it has none). */
function isLive(entry) {
  if (!entry.combatId) return true;
  const combats = globalThis.game?.combats;
  if (!combats?.get) return true;
  return Boolean(combats.get(entry.combatId));
}

/** Every stored entry of an actor (live or not). */
export function storedDispels(actor) {
  return asArray(actor?.flags?.[SYSTEM_ID]?.[FLAG]).map(cleanEntry).filter(Boolean);
}

/** The entries still in force on an actor. */
export function activeDispels(actor) {
  return storedDispels(actor).filter(isLive);
}

/**
 * The key a dispel names a Buff by: the embedded item's id, else the catalog identifier (external slots and the
 * persistent buffs of equipped gear resolve to plain objects, not items).
 */
export function buffKeyOf(actor, buff) {
  const id = buff?.id ?? buff?._id ?? '';
  if (id && actor?.items?.get(id)) return id;
  return String(buff?.system?.identifier || buff?.identifier || id || '');
}

/** A buff of a changed body (D16). `getActiveBuffs()` entries carry no flags, so the owned item is asked too. */
function bodyBuff(actor, buff) {
  return transformationBody(buff) || transformationBody(actor?.items?.get(buff?.id));
}

/**
 * True when this Buff does not apply: a dispel in force on the actor suspends it, a lapsed or Shunned deity bond withholds
 * it (a tier, standing or boon gift of that god, pp. 163, 312), a debuff in force suppresses it (a smite, p. 313), or the actor is in a zero zone, which pauses every Buff
 * (nothing is deleted; its clock keeps running and it applies again when the zone ends or the bond recovers). An
 * activated buff whose window is closed does not apply either (it applies again when Use opens the window).
 * @param {object} actor
 * @param {object} buff a buff item, or a `getActiveBuffs()` entry
 * @param {{ ignoreWindow?: boolean }} [opts] ignoreWindow: ask only about the other reasons (could a Use take effect?)
 * @returns {boolean}
 */
export function isBuffSuppressed(actor, buff, { ignoreWindow = false } = {}) {
  if (!buff) return false;
  if (isBuffDispelled(actor, buff)) return true;
  if (bodyBuff(actor, buff)) return false;
  if (!ignoreWindow && activationClosed(actor?.items?.get(buff.id) ?? buff)) return true;
  if (worshipWithholds(actor, buff)) return true;
  const paused = isEffectPaused(actor);
  if (suppressedByDebuff(actor, buff, { paused })) return true;
  return paused && !keptByWorkingGear(actor, buff);
}

/**
 * True when a dispel in force on the actor suspends this Buff (the zero-zone pause is not asked). Cheap when there is
 * none (the usual case).
 * @param {object} actor
 * @param {object} buff a buff item, or a `getActiveBuffs()` entry
 * @returns {boolean}
 */
export function isBuffDispelled(actor, buff) {
  const entries = activeDispels(actor);
  if (!entries.length || !buff) return false;
  if (bodyBuff(actor, buff)) return false; // a changed body survives a dispel (D16)
  const key = buffKeyOf(actor, buff);
  for (const entry of entries) {
    if (entry.count > 0 || entry.buffKeys.length) {
      if (key && entry.buffKeys.includes(key)) return true;
    } else if (matchesTagQuery(buffTagSet(buff), entry.query)) {
      return true;
    }
  }
  return false;
}

async function writeEntries(actor, entries) {
  if (entries.length) await actor.setFlag(SYSTEM_ID, FLAG, entries);
  else if (typeof actor.unsetFlag === 'function') await actor.unsetFlag(SYSTEM_ID, FLAG);
  else await actor.setFlag(SYSTEM_ID, FLAG, []);
}

/**
 * Suspend an actor's Buffs.
 * @param {object} actor the target
 * @param {{ source?: string, sourceUuid?: string, applicationId?: string, combatId?: string, count?: number, query?: object }} spec
 * @returns {Promise<object>} the stored entry (`buffKeys` lists the Buffs a counted dispel took)
 */
export async function addDispelEntry(actor, spec = {}) {
  const count = Math.max(0, Math.floor(Number(spec.count)) || 0);
  const query = spec.query && typeof spec.query === 'object' ? spec.query : {};
  const entry = {
    id: newId(),
    source: String(spec.source ?? ''),
    sourceUuid: String(spec.sourceUuid ?? ''),
    applicationId: String(spec.applicationId ?? ''),
    combatId: String(spec.combatId ?? ''),
    count,
    query,
    buffKeys: []
  };
  if (count > 0) {
    // The first N Buffs still working, in `getActiveBuffs` order.
    const working = typeof actor.getActiveBuffs === 'function' ? actor.getActiveBuffs() : [];
    for (const buff of working) {
      if (entry.buffKeys.length >= count) break;
      if (!matchesTagQuery(buffTagSet(buff), query)) continue;
      const key = buffKeyOf(actor, buff);
      if (key && !entry.buffKeys.includes(key)) entry.buffKeys.push(key);
    }
  }
  await writeEntries(actor, [...activeDispels(actor), entry]);
  return entry;
}

/** Remove one entry (the GM's Restore). @returns {Promise<boolean>} true when it was there */
export async function removeDispelEntry(actor, entryId) {
  const entries = storedDispels(actor);
  const next = entries.filter(e => e.id !== entryId);
  if (next.length === entries.length) return false;
  await writeEntries(actor, next);
  return true;
}

/** Remove the entries one damage application made (its undo). @returns {Promise<number>} how many */
export async function removeDispelsByApplication(actor, applicationId) {
  if (!applicationId) return 0;
  const entries = storedDispels(actor);
  const next = entries.filter(e => e.applicationId !== applicationId);
  if (next.length === entries.length) return 0;
  await writeEntries(actor, next);
  return entries.length - next.length;
}

/**
 * The combat ended: drop every entry bound to it.
 * @param {string} combatId
 * @param {Iterable<object>} actors every actor that might carry one
 * @returns {Promise<number>} entries removed
 */
export async function clearDispelsForCombat(combatId, actors) {
  if (!combatId) return 0;
  let removed = 0;
  for (const actor of actors ?? []) {
    const entries = storedDispels(actor);
    const next = entries.filter(e => e.combatId !== combatId);
    if (next.length === entries.length) continue;
    await writeEntries(actor, next);
    removed += entries.length - next.length;
  }
  return removed;
}
