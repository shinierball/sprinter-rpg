/**
 * Sprinter RPG - The GM-side pending store for secret debuffs (7.1f, D10).
 *
 * A debuff with `system.secret` never reaches the carrier when it lands: `applyCondition` hands its creation data to
 * `holdSecret`, which sends a record to the active GM over the socketlib relay (a player's client cannot write a world
 * setting). The GM gets a card (Reveal / Keep secret). Revealing creates the debuff as a normal landing; Change now
 * creates it and fires the change; Cure drops the record (a secret nobody knows of cannot be cured by an item).
 * The store is the world setting `pendingSecrets`, written only by a GM client.
 */
import { SYSTEM_ID } from '../constants.mjs';
import { registerRelayAction, dispatchRelay, getActiveGM, isActiveGM } from '../utils/gm-relay.mjs';
import { readFlag, writeFlag, clearFlag } from '../utils/flags.mjs';
import { resolveActorByUuid } from '../utils/actor-uuid.mjs';
import { itemIdentifier } from '../utils/identifier.mjs';
import { getCurrentFloor } from '../utils/floor/current-floor.mjs';
import { postSecretCard } from './actor/transform-cues.mjs';
import { transformText } from '../utils/character/transform-text.mjs';
import { registerStoredCopy } from '../utils/migrations/stored-copies.mjs';

export const PENDING_SECRETS_SETTING = 'pendingSecrets';
// Each held record keeps the debuff's creation data (`debuffData`).
registerStoredCopy({ of: 'Item.debuff', at: 'setting:pendingSecrets' });
const HOLD_SECRET_RELAY = 'holdSecret';
const DROP_HELD_RELAY = 'dropHeldSecrets';
// A secret landed with no GM connected waits in this flag on its carrier (the payload without `actorUuid`) until the
// GM's client moves it to the store. It holds debuff creation data too.
registerStoredCopy({ of: 'Item.debuff', at: 'flag:heldSecrets' });
const WAITING_FLAG = 'heldSecrets';

const clone = (value) => {
  try { return structuredClone(value); } catch { return JSON.parse(JSON.stringify(value)); }
};

/** Every held record, oldest first. A copy: edit through the functions below. */
export function listPending() {
  let raw;
  try { raw = globalThis.game?.settings?.get(SYSTEM_ID, PENDING_SECRETS_SETTING); } catch { raw = null; }
  return Array.isArray(raw) ? raw.filter((r) => r && typeof r === 'object' && r.id).map(clone) : [];
}

async function save(records) {
  await globalThis.game.settings.set(SYSTEM_ID, PENDING_SECRETS_SETTING, records);
  globalThis.Hooks?.callAll?.('cogSecretsUpdated');
}

const recordOf = (id) => listPending().find((r) => r.id === id) ?? null;

const newId = () => globalThis.foundry?.utils?.randomID?.() ?? `secret-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** What a record is matched on for "already held": the debuff's identifier, else its name. */
const keyOf = (debuffData) => itemIdentifier(debuffData) || debuffData?.name || '';

/**
 * Hold a secret debuff GM-side instead of creating it on the carrier. Runs on whichever client landed the debuff: the
 * GM's own client writes the store; a player's client asks the active GM.
 * @param {Actor} actor the carrier
 * @param {object} debuffData the debuff's creation data
 * @param {{ source?: string, appId?: string, landedAt?: number, landedFloor?: number }} [options] `appId`: the damage
 *   application a rider landed with (an undo finds the record by it); `landedAt` / `landedFloor`: the landing it keeps
 *   (default: now, this floor)
 * @returns {Promise<boolean>} whether the record is held (false when no GM could be reached)
 */
export async function holdSecret(actor, debuffData, { source = '', appId = '', landedAt, landedFloor } = {}) {
  if (!actor?.uuid || !debuffData) return false;
  const payload = {
    actorUuid: actor.uuid,
    debuffData: clone(debuffData),
    source: String(source ?? ''),
    appId: String(appId ?? ''),
    landedAt: Number.isFinite(landedAt) ? landedAt : (Number(globalThis.game?.time?.worldTime) || 0),
    landedFloor: Number.isFinite(landedFloor) ? landedFloor : getCurrentFloor()
  };
  // A GM's client stores the record; a player's client asks the active GM, and when there is none (or the request fails)
  // the record waits on the carrier, silently.
  if (globalThis.game?.user?.isGM) return dispatchRelay(HOLD_SECRET_RELAY, payload);
  if (getActiveGM()) {
    try {
      if (await dispatchRelay(HOLD_SECRET_RELAY, payload)) return true;
    } catch (err) {
      console.warn('Sprinter RPG | Could not hand the secret to the GM:', err);
    }
  }
  return waitOnCarrier(actor, payload);
}

/** The records waiting on a carrier, oldest first (a copy). */
function waitingOn(actor) {
  const raw = readFlag(actor, WAITING_FLAG);
  return Array.isArray(raw) ? raw.filter((r) => r && typeof r === 'object' && r.debuffData).map(clone) : [];
}

/** Append the payload to the carrier's waiting list (once per debuff). False when this client cannot write the carrier. */
async function waitOnCarrier(actor, payload) {
  const { actorUuid, ...record } = payload;
  const waiting = waitingOn(actor);
  if (waiting.some((r) => keyOf(r.debuffData) === keyOf(record.debuffData))) return true;
  try {
    await writeFlag(actor, WAITING_FLAG, [...waiting, record]);
    return true;
  } catch (err) {
    console.warn('Sprinter RPG | Could not keep the secret on its carrier:', err);
    return false;
  }
}

/** Actors that can carry an affliction: world actors, then the actors of unlinked placed tokens (each once). */
export function carriers() {
  const seen = new Map();
  for (const actor of Array.from(globalThis.game?.actors ?? [])) if (actor?.uuid) seen.set(actor.uuid, actor);
  for (const scene of Array.from(globalThis.game?.scenes ?? [])) {
    for (const token of Array.from(scene.tokens ?? [])) {
      if (token?.actorLink) continue;
      const actor = token.actor;
      if (actor?.uuid && !seen.has(actor.uuid)) seen.set(actor.uuid, actor);
    }
  }
  return [...seen.values()];
}

/**
 * Move the secrets that waited on their carriers into the store: the active GM's client only. Each record keeps the
 * landing it was held with; the store's own dedupe makes a second move a no-op.
 * @param {Actor[]} [actors]
 * @returns {Promise<number>} how many records were moved
 */
export async function moveWaitingSecrets(actors = carriers()) {
  if (!isActiveGM()) return 0;
  let moved = 0;
  for (const actor of actors) {
    const waiting = waitingOn(actor);
    if (!waiting.length) continue;
    for (const record of waiting) {
      await storeSecret({ ...record, actorUuid: actor.uuid });
      moved += 1;
    }
    await clearFlag(actor, WAITING_FLAG);
  }
  return moved;
}

/**
 * An undone damage application takes back the secrets it held: the carrier's waiting records, and the store's. A
 * player's client asks the GM for the store's (quietly); with no GM the store keeps it and the GM's Cure removes it.
 * @param {Actor} actor the carrier
 * @param {string} applicationId
 * @returns {Promise<number>} how many records this client removed
 */
export async function dropHeldFor(actor, applicationId) {
  const appId = String(applicationId ?? '');
  if (!appId || !actor?.uuid) return 0;
  let removed = 0;
  const waiting = waitingOn(actor);
  const kept = waiting.filter((r) => String(r.appId ?? '') !== appId);
  if (kept.length !== waiting.length) {
    removed += waiting.length - kept.length;
    try {
      await (kept.length ? writeFlag(actor, WAITING_FLAG, kept) : clearFlag(actor, WAITING_FLAG));
    } catch (err) {
      console.warn('Sprinter RPG | Could not drop the waiting secret:', err);
    }
  }
  if (globalThis.game?.user?.isGM) removed += await dropStoredFor({ actorUuid: actor.uuid, appId });
  else if (getActiveGM()) {
    try { await dispatchRelay(DROP_HELD_RELAY, { actorUuid: actor.uuid, appId }); } catch { /* quiet: the GM's Cure removes it */ }
  }
  return removed;
}

/** The store's records of one carrier and damage application, dropped. */
async function dropStoredFor({ actorUuid, appId }) {
  const records = listPending();
  const kept = records.filter((r) => !(r.actorUuid === actorUuid && appId && r.appId === appId));
  if (kept.length === records.length) return 0;
  await save(kept);
  return records.length - kept.length;
}

registerRelayAction(DROP_HELD_RELAY, {
  authorize: (payload, user) => {
    if (user?.isGM) return true;
    return Boolean(resolveActorByUuid(payload?.actorUuid)?.testUserPermission?.(user, 'OWNER'));
  },
  apply: async (payload) => { await dropStoredFor(payload ?? {}); return true; }
});

/** The relay's apply, on a GM client: add the record (once per carrier and debuff) and tell the GMs. */
async function storeSecret(payload) {
  const actor = resolveActorByUuid(payload?.actorUuid);
  const debuffData = payload?.debuffData;
  if (!actor || !debuffData) return false;
  const records = listPending();
  const key = keyOf(debuffData);
  if (records.some((r) => r.actorUuid === actor.uuid && keyOf(r.debuffData) === key)) return true;
  const record = {
    id: newId(),
    actorUuid: actor.uuid,
    actorName: actor.name,
    name: debuffData.name ?? '',
    debuffData,
    source: String(payload.source ?? ''),
    appId: String(payload.appId ?? ''),
    landedAt: Number(payload.landedAt) || 0,
    landedFloor: Number(payload.landedFloor) || 1,
    note: ''
  };
  await save([...records, record]);
  await postSecretCard(actor, record, record.id);
  return true;
}

registerRelayAction(HOLD_SECRET_RELAY, {
  authorize: (payload, user) => {
    if (user?.isGM) return true;
    const actor = resolveActorByUuid(payload?.actorUuid);
    return Boolean(actor?.testUserPermission?.(user, 'OWNER'));
  },
  apply: (payload) => storeSecret(payload)
});

const warn = (message) => globalThis.ui?.notifications?.warn?.(message);

/**
 * Reveal a held secret: create the debuff on its carrier as a normal landing (pending, with the landing card), and drop
 * the record. GM only. Returns the created debuff, or null (record kept) when the carrier is gone.
 * @param {string} id
 * @param {{ cue?: boolean }} [options] `cue: false` skips the landing card (Change now fires it at once)
 * @returns {Promise<Item|null>}
 */
export async function reveal(id, { cue = true } = {}) {
  if (!globalThis.game?.user?.isGM) { warn(transformText('COG.TransformCard.GMOnly')); return null; }
  const record = recordOf(id);
  if (!record) { warn(transformText('COG.TransformCard.SecretGone')); return null; }
  const actor = resolveActorByUuid(record.actorUuid);
  if (!actor) { warn(transformText('COG.TransformCard.NotFound')); return null; }
  const created = await actor.applyCondition(record.debuffData, {
    source: record.source, reveal: true, postCue: cue, landedAt: record.landedAt, landedFloor: record.landedFloor
  });
  if (!created) return null;
  await save(listPending().filter((r) => r.id !== id));
  return created;
}

/** Drop a held secret without ever creating it (the GM's cure: you cannot cure what the player does not have). */
export async function cure(id) {
  if (!globalThis.game?.user?.isGM) { warn(transformText('COG.TransformCard.GMOnly')); return false; }
  if (!recordOf(id)) return false;
  await save(listPending().filter((r) => r.id !== id));
  return true;
}

/** Edit a held record's GM note. */
export async function setNote(id, note) {
  if (!globalThis.game?.user?.isGM || !recordOf(id)) return false;
  await save(listPending().map((r) => (r.id === id ? { ...r, note: String(note ?? '') } : r)));
  return true;
}
