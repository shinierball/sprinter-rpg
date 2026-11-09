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
import { registerRelayAction, dispatchRelay } from '../utils/gm-relay.mjs';
import { resolveActorByUuid } from '../utils/actor-uuid.mjs';
import { itemIdentifier } from '../utils/identifier.mjs';
import { getCurrentFloor } from './actor/actor-environment.mjs';
import { postSecretCard, transformCardText } from './actor/transform-cues.mjs';

export const PENDING_SECRETS_SETTING = 'pendingSecrets';
const HOLD_SECRET_RELAY = 'holdSecret';

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
 * @param {{ source?: string }} [options]
 * @returns {Promise<boolean>} whether the record is held (false when no GM could be reached)
 */
export async function holdSecret(actor, debuffData, { source = '' } = {}) {
  if (!actor?.uuid || !debuffData) return false;
  const payload = {
    actorUuid: actor.uuid,
    debuffData: clone(debuffData),
    source: String(source ?? ''),
    landedAt: Number(globalThis.game?.time?.worldTime) || 0,
    landedFloor: getCurrentFloor()
  };
  return dispatchRelay(HOLD_SECRET_RELAY, payload);
}

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
  if (!globalThis.game?.user?.isGM) { warn(transformCardText('COG.TransformCard.GMOnly')); return null; }
  const record = recordOf(id);
  if (!record) { warn(transformCardText('COG.TransformCard.SecretGone')); return null; }
  const actor = resolveActorByUuid(record.actorUuid);
  if (!actor) { warn(transformCardText('COG.TransformCard.NotFound')); return null; }
  const created = await actor.applyCondition(record.debuffData, { source: record.source, reveal: true, postCue: cue });
  if (!created) return null;
  await save(listPending().filter((r) => r.id !== id));
  return created;
}

/** Drop a held secret without ever creating it (the GM's cure: you cannot cure what the player does not have). */
export async function cure(id) {
  if (!globalThis.game?.user?.isGM) { warn(transformCardText('COG.TransformCard.GMOnly')); return false; }
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
