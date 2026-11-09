/**
 * Called Plays. A Called Play waits on the ally's combatant under `flags.sprinter-rpg.calledPlays.<id>` until the
 * ally's next skill or attack roll this round uses it. The stored `round` is the truth (readers filter by it);
 * `resetRoundActions` also deletes the flag (housekeeping). Combat documents are GM-writable, so players go through
 * the `calledPlay` relay.
 */

import { SYSTEM_ID } from '../../constants.mjs';
import { registerRelayAction, dispatchRelay, requestRelay } from '../../utils/gm-relay.mjs';
import { messageAuthorId } from '../../chat/chat-relay.mjs';
import { readCheckRecord, getAssistSpec } from '../../utils/roll/check-assists.mjs';
import { resolveActorByUuid } from '../../utils/actor-uuid.mjs';
import { findCombatById, findCombatant, isCombatWriter } from './combatants.mjs';

/** Relay action for every Called Play write; `payload.op` names the write (`store`, `consume`, `discard`). */
export const CALLED_PLAY_RELAY = 'calledPlay';
export const CALLED_PLAYS_FLAG = 'calledPlays';
const MAX_CALLED_PLAYS = 20;
/** Entry ids are flag keys; anything else (dots, empty) could address another flag path. */
const CALLED_PLAY_ID = /^[A-Za-z0-9_-]{1,64}$/;

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const strField = (v) => (typeof v === 'string' ? v : '');
const strOrNullField = (v) => (typeof v === 'string' && v ? v : null);
const tagList = (v) => (Array.isArray(v) ? v.filter((t) => typeof t === 'string' && t.trim()).map((t) => t.trim()) : []);

function isCalledPlayId(id) {
  return typeof id === 'string' && CALLED_PLAY_ID.test(id);
}

/**
 * One stored Called Play, or null when unusable (bad id, no round, no finite amount). The amount was rolled on the
 * caller's client when the play was called; `formula` is kept for display.
 * @returns {{ id: string, at: number, round: number, formula: string, amount: number, rollMessageId: string|null, messageId: string|null, fromUuid: string, fromName: string, skillName: string, proposal: string, when: { all: string[], any: string[], none: string[] } }|null}
 */
function sanitizeCalledPlay(raw, fallbackId = '') {
  if (!isPlainObject(raw)) return null;
  const id = strField(raw.id) || fallbackId;
  if (!isCalledPlayId(id)) return null;
  const round = Number(raw.round);
  const amount = typeof raw.amount === 'number' ? raw.amount : Number(raw.amount);
  if (raw.round === null || raw.round === '' || !Number.isInteger(round) || raw.amount === null || raw.amount === '' || !Number.isFinite(amount)) return null;
  const when = isPlainObject(raw.when) ? raw.when : {};
  return {
    id,
    at: Number.isFinite(raw.at) ? raw.at : 0,
    round,
    formula: strField(raw.formula),
    amount,
    rollMessageId: strOrNullField(raw.rollMessageId),
    messageId: strOrNullField(raw.messageId),
    fromUuid: strField(raw.fromUuid),
    fromName: strField(raw.fromName),
    skillName: strField(raw.skillName),
    proposal: strField(raw.proposal),
    when: { all: tagList(when.all), any: tagList(when.any), none: tagList(when.none) }
  };
}

/**
 * The Called Plays waiting on a combatant, sanitised and sorted by `at`. Only entries of `round` (default: the
 * combatant's combat's current round); `round: null` returns every stored entry.
 * @param {object} combatant
 * @param {{ round?: number|null }} [opts]
 */
export function getCalledPlays(combatant, { round = combatant?.combat?.round ?? combatant?.parent?.round ?? globalThis.game?.combat?.round ?? null } = {}) {
  const raw = combatant?.getFlag?.(SYSTEM_ID, CALLED_PLAYS_FLAG) ?? combatant?.flags?.[SYSTEM_ID]?.[CALLED_PLAYS_FLAG];
  if (!isPlainObject(raw)) return [];
  const wanted = round === null ? null : Number(round);
  const out = [];
  for (const [key, entry] of Object.entries(raw)) {
    const clean = sanitizeCalledPlay(entry, key);
    // The key is the id the writes address; an entry claiming another id is not trusted.
    if (!clean || clean.id !== key) continue;
    if (wanted !== null && clean.round !== wanted) continue;
    out.push(clean);
  }
  out.sort((a, b) => (a.at - b.at) || a.id.localeCompare(b.id));
  return out.slice(0, MAX_CALLED_PLAYS);
}

/**
 * Whether `user` may discard a Called Play: the GM, an owner of the caller (`fromUuid`) or an owner of the ally.
 * @param {object|null} entry a sanitised entry
 * @param {object|null} combatant the ally's combatant
 * @param {object|null} [user]
 */
export function mayDiscardCalledPlay(entry, combatant, user = globalThis.game?.user) {
  if (!entry || !user) return false;
  if (user.isGM) return true;
  if (combatant?.actor?.testUserPermission?.(user, 'OWNER')) return true;
  return Boolean(resolveActorByUuid(entry.fromUuid)?.testUserPermission?.(user, 'OWNER'));
}

/** The stored entry with this id (any round), sanitised, or null. */
function storedCalledPlay(combatant, calledPlayId) {
  if (!combatant || !isCalledPlayId(calledPlayId)) return null;
  return getCalledPlays(combatant, { round: null }).find(e => e.id === calledPlayId) || null;
}

function messageById(id) {
  return typeof id === 'string' && id ? (globalThis.game?.messages?.get?.(id) ?? null) : null;
}

function userById(id) {
  if (!id) return null;
  const users = globalThis.game?.users;
  return users?.get(id) ?? null;
}

/** True when `user` is the GM or an owner of `actor`. */
function userMayActFor(user, actor) {
  return Boolean(user && actor && (user.isGM || actor.testUserPermission?.(user, 'OWNER')));
}

/**
 * Check a `store` request and build the entry it would write. Everything comes from the call message (which the calling player's
 * client rolled and posted: the trust source) and the world; the payload gives only the message id.
 * @returns {{ ok: true, combat: object, combatant: object, entry: object } | { ok: false, reason: string }}
 */
function checkStoreCalledPlay(payload, user) {
  const message = messageById(payload?.callMessageId);
  const flags = message?.flags?.[SYSTEM_ID];
  if (!message || !flags || flags.isCalledPlay !== true) return { ok: false, reason: 'not-called-play' };
  if (!isCalledPlayId(message.id)) return { ok: false, reason: 'bad-id' };
  const authorId = messageAuthorId(message);
  if (!user?.isGM && authorId !== user?.id) return { ok: false, reason: 'not-author' };
  const caller = resolveActorByUuid(flags.fromUuid);
  if (!caller || !userMayActFor(userById(authorId), caller)) return { ok: false, reason: 'untrusted' };
  const combat = findCombatById(flags.combatId);
  if (!combat || Number(flags.round) !== Number(combat.round)) return { ok: false, reason: 'stale' };
  const combatant = findCombatant(combat, flags.allyCombatantId);
  if (!combatant) return { ok: false, reason: 'no-ally' };
  const roll = Array.isArray(message.rolls) ? message.rolls[0] : null;
  const amount = Number(roll?.total);
  if (!roll || !Number.isFinite(amount)) return { ok: false, reason: 'no-roll' };
  const stored = getCalledPlays(combatant, { round: null });
  if (stored.some(e => e.id === message.id)) return { ok: false, reason: 'duplicate' };
  if (stored.length >= MAX_CALLED_PLAYS) return { ok: false, reason: 'full' };
  // The query comes from the caller's own skill when it is still there, else from the card's flags.
  const skill = caller.items?.get(flags.itemId) ?? null;
  const entry = sanitizeCalledPlay({
    id: message.id,
    at: Date.now(),
    round: combat.round,
    formula: strField(roll.formula),
    amount,
    rollMessageId: message.id,
    messageId: message.id,
    fromUuid: caller.uuid,
    fromName: caller.name,
    skillName: strField(skill?.name) || strField(flags.skillName),
    proposal: '',
    when: skill ? getAssistSpec(skill).when : flags.when
  });
  return entry ? { ok: true, combat, combatant, entry } : { ok: false, reason: 'bad-entry' };
}

/**
 * Check a `consume` request: the check card exists, its author owns the ally and its record names this Called Play.
 * An entry that is already gone is a no-op (`gone`), not a refusal.
 */
function checkConsumeCalledPlay(payload, user) {
  const combat = findCombatById(payload?.combatId);
  const combatant = findCombatant(combat, payload?.combatantId);
  if (!combatant || !isCalledPlayId(payload?.calledPlayId)) return { ok: false, reason: 'bad-request' };
  const message = messageById(payload?.checkMessageId);
  const record = message ? readCheckRecord(message) : null;
  if (!record) return { ok: false, reason: 'no-record' };
  const authorId = messageAuthorId(message);
  if (!user?.isGM && authorId !== user?.id) return { ok: false, reason: 'not-author' };
  if (!userMayActFor(userById(authorId), combatant.actor)) return { ok: false, reason: 'untrusted' };
  if (!record.assists.some(a => a.source === 'called_play' && a.calledPlayId === payload.calledPlayId)) return { ok: false, reason: 'not-used' };
  return { ok: true, combatant, gone: !storedCalledPlay(combatant, payload.calledPlayId) };
}

const CALLED_PLAY_OPS = {
  store: {
    authorize: (payload, user) => checkStoreCalledPlay(payload, user).ok,
    async apply(payload, user) {
      const res = checkStoreCalledPlay(payload, user);
      if (!res.ok) return { ok: false, reason: res.reason };
      await res.combatant.update({ [`flags.${SYSTEM_ID}.${CALLED_PLAYS_FLAG}.${res.entry.id}`]: res.entry });
      return { ok: true, entry: res.entry };
    }
  },
  consume: {
    authorize: (payload, user) => checkConsumeCalledPlay(payload, user).ok,
    async apply(payload, user) {
      const res = checkConsumeCalledPlay(payload, user);
      if (!res.ok) return { ok: false, reason: res.reason };
      if (!res.gone) await res.combatant.unsetFlag(SYSTEM_ID, `${CALLED_PLAYS_FLAG}.${payload.calledPlayId}`);
      return { ok: true };
    }
  },
  discard: {
    authorize(payload, user) {
      const c = findCombatant(findCombatById(payload?.combatId), payload?.combatantId);
      return mayDiscardCalledPlay(storedCalledPlay(c, payload?.calledPlayId), c, user);
    },
    async apply(payload) {
      const combat = findCombatById(payload.combatId);
      if (!combat) throw new Error(`Combat ${payload.combatId} not found.`);
      return combat.discardCalledPlay(payload.combatantId, payload.calledPlayId);
    }
  }
};

function calledPlayOp(payload) {
  const op = payload?.op;
  return typeof op === 'string' && Object.hasOwn(CALLED_PLAY_OPS, op) ? CALLED_PLAY_OPS[op] : null;
}

registerRelayAction(CALLED_PLAY_RELAY, {
  authorize: (payload, user) => Boolean(calledPlayOp(payload)?.authorize(payload, user)),
  async apply(payload, user) {
    const op = calledPlayOp(payload);
    if (!op) throw new Error(`Unknown Called Play op "${payload?.op}".`);
    return op.apply(payload, user);
  }
});

/**
 * Remove one Called Play from a combatant (the tracker's ×, B5). The GM writes; a player asks the GM through the
 * `calledPlay` relay, which allows the GM, the caller's owners and the ally's owners.
 * @param {object} combat
 * @param {Combatant|string} combatantOrId the ally's combatant
 * @param {string} calledPlayId
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
export async function discardCalledPlay(combat, combatantOrId, calledPlayId) {
  const c = findCombatant(combat, combatantOrId);
  if (!c) return { success: false, error: 'Combatant not found.' };
  if (!isCalledPlayId(calledPlayId)) return { success: false, error: 'Not a Called Play id.' };
  if (isCombatWriter()) {
    if (!storedCalledPlay(c, calledPlayId)) return { success: false, error: 'No such Called Play.' };
    await c.unsetFlag(SYSTEM_ID, `${CALLED_PLAYS_FLAG}.${calledPlayId}`);
    return { success: true };
  }
  const sent = await dispatchRelay(CALLED_PLAY_RELAY, {
    op: 'discard',
    combatId: combat.id,
    combatantId: c.id,
    calledPlayId
  }, { direct: false });
  return sent ? { success: true } : { success: false, error: 'No GM is connected to discard this Called Play.' };
}

/**
 * Bank a called Play on the ally's combatant (E7.9 §3.7). The caller's client has already posted the call message
 * (its roll is the amount); only its id is sent, and whoever writes re-reads the message (D5 trust rule).
 * @param {object} combat
 * @param {{ callMessageId: string }} payload anything else is dropped
 * @returns {Promise<{ ok: boolean, reason?: string, entry?: object }>}
 */
export async function storeCalledPlay(combat, { callMessageId } = {}) {
  return requestCalledPlayOp(combat, { op: 'store', callMessageId: strField(callMessageId) });
}

/**
 * Remove a Called Play the ally's roll used. The ally's client sends the check message id; the writer confirms the
 * message's record names this Called Play and that its author owns the ally.
 * @param {object} combat
 * @param {{ combatantId: string, calledPlayId: string, checkMessageId: string }} payload
 * @returns {Promise<{ ok: boolean, reason?: string }>}
 */
export async function consumeCalledPlay(combat, { combatantId, calledPlayId, checkMessageId } = {}) {
  return requestCalledPlayOp(combat, { op: 'consume', combatantId: strField(combatantId), calledPlayId: strField(calledPlayId), checkMessageId: strField(checkMessageId) });
}

/** Run a Called Play op here when this client is the GM, else through the GM; a refusal comes back as `{ ok: false }`. */
async function requestCalledPlayOp(combat, payload) {
  const full = { ...payload, combatId: combat.id };
  const res = await requestRelay(CALLED_PLAY_RELAY, full);
  if (!res.ok) return { ok: false, reason: res.reason ?? 'error' };
  const r = res.result;
  return r && typeof r === 'object' && typeof r.ok === 'boolean' ? r : { ok: false, reason: 'error' };
}
