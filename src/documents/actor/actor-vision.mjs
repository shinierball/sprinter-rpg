/**
 * Token vision from senses.
 *
 * `syncTokenVision(actor)` derives the actor's combined senses (race, class, equipped gear, active buffs)
 * and writes Foundry's built-in token sight fields (`enabled`, `range`, `visionMode`) on the prototype
 * token and on the actor's placed tokens. The sight the actor had before any sense applied is stored in
 * the `visionBackup` flag, so removing the sense restores it exactly.
 *
 * A user who cannot write the actor asks the active GM through the socketlib relay; the GM recomputes
 * everything from the documents, so the request carries only the actor's UUID.
 */
import { SYSTEM_ID } from '../../constants.mjs';
import { registerRelayAction, requestRelay } from '../../utils/gm-relay.mjs';
import { resolveActorByUuid } from '../../utils/actor-uuid.mjs';
import { collectSenses, hasSenseOverride } from '../../utils/senses.mjs';

export const SYNC_TOKEN_VISION = 'syncTokenVision';

/** Item types whose senses feed the actor (the same sources as the typed modifier rows). */
export const SENSE_ITEM_TYPES = ['race', 'class', 'gear', 'buff'];

const SIGHT_KEYS = ['enabled', 'range', 'visionMode'];

function plain(sight) {
  const source = typeof sight?.toObject === 'function' ? sight.toObject() : sight;
  return source && typeof source === 'object' ? { ...source } : {};
}

function pickSight(sight) {
  const s = plain(sight);
  return Object.fromEntries(SIGHT_KEYS.map(k => [k, s[k] ?? null]));
}

/**
 * The sight an actor should have for its senses, given the sight it has without them.
 * Unlimited darkvision is `range: null` (no limit); a finite darkvision uses its range; a multiplier alone
 * scales the base range.
 * @param {{darkvision:number, darkvisionUnlimited:boolean, rangeMultiplier:number}} senses
 * @param {{enabled:*, range:*, visionMode:*}} base
 * @returns {{enabled:*, range:*, visionMode:*}}
 */
export function deriveSight(senses, base) {
  const mult = senses.rangeMultiplier;
  if (senses.darkvisionUnlimited) return { enabled: true, range: null, visionMode: 'darkvision' };
  if (senses.darkvision > 0) return { enabled: true, range: senses.darkvision * mult, visionMode: 'darkvision' };
  const baseRange = Number(base.range);
  return {
    enabled: base.enabled,
    range: base.range !== null && Number.isFinite(baseRange) ? baseRange * mult : base.range,
    visionMode: base.visionMode
  };
}

const sameSight = (a, b) => SIGHT_KEYS.every(k => (a[k] ?? null) === (b[k] ?? null));

/** The actor's linked tokens on every scene (not only the viewed one), plus any the canvas reports. */
function activeTokenDocuments(actor) {
  const found = new Set();
  const scenes = globalThis.game?.scenes;
  const sceneList = !scenes ? [] : (Array.isArray(scenes.contents) ? scenes.contents : Array.from(scenes.values?.() ?? scenes));
  for (const scene of sceneList) {
    const tokens = scene?.tokens;
    const list = !tokens ? [] : (Array.isArray(tokens.contents) ? tokens.contents : Array.from(tokens.values?.() ?? tokens));
    for (const t of list) if (t && t.actorId === actor.id && t.actorLink !== false) found.add(t);
  }
  let viewed;
  try { viewed = actor.getActiveTokens?.(false, true) ?? []; } catch { viewed = []; }
  for (const t of viewed) found.add(t?.document ?? t);
  return [...found].filter(t => t && typeof t.update === 'function');
}

/**
 * Write the derived sight on the actor's prototype token and placed tokens. Idempotent: it writes only
 * what differs, so item hooks may call it freely. Needs write access to the actor.
 * @param {object} actor
 * @returns {Promise<boolean>} true when something was written
 */
export async function applyTokenVision(actor) {
  if (!actor || typeof actor.update !== 'function') return false;
  const senses = collectSenses(actor);
  const backup = actor.getFlag?.(SYSTEM_ID, 'visionBackup') ?? null;
  const current = pickSight(actor.prototypeToken?.sight);

  let target;
  if (hasSenseOverride(senses)) {
    const base = backup ?? current;
    target = deriveSight(senses, base);
    if (!backup) await actor.setFlag?.(SYSTEM_ID, 'visionBackup', base);
  } else if (backup) {
    target = pickSight(backup);
    await actor.unsetFlag?.(SYSTEM_ID, 'visionBackup');
  } else {
    return false;
  }

  let wrote = false;
  if (!sameSight(current, target)) {
    await actor.update({ 'prototypeToken.sight': { ...plain(actor.prototypeToken?.sight), ...target } });
    wrote = true;
  }
  for (const token of activeTokenDocuments(actor)) {
    if (sameSight(pickSight(token.sight), target)) continue;
    await token.update({ sight: { ...plain(token.sight), ...target } });
    wrote = true;
  }
  return wrote;
}

/**
 * Bring token vision in line with the actor's senses. Writes directly when the user may write the actor,
 * otherwise through the GM relay.
 * @param {object} actor
 * @returns {Promise<boolean>} false when nothing could be written (no GM reachable)
 */
export async function syncTokenVision(actor) {
  if (!actor) return false;
  const user = globalThis.game?.user;
  const canWrite = Boolean(user?.isGM || actor.isOwner);
  if (canWrite) {
    await applyTokenVision(actor);
    return true;
  }
  const reply = await requestRelay(SYNC_TOKEN_VISION, { actorUuid: actor.uuid });
  return reply.ok === true;
}

registerRelayAction(SYNC_TOKEN_VISION, {
  authorize: (payload, requester) => {
    const actor = resolveActorByUuid(payload?.actorUuid);
    if (!actor || !requester) return false;
    if (requester.isGM) return true;
    const observer = globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS?.OBSERVER ?? 2;
    return Boolean(actor.testUserPermission?.(requester, observer));
  },
  apply: async (payload) => {
    const actor = resolveActorByUuid(payload?.actorUuid);
    if (!actor) throw new Error(`Token vision relay: actor ${payload?.actorUuid} not found.`);
    return applyTokenVision(actor);
  }
});

/**
 * `createItem` / `deleteItem` hook handler (`(item, options, userId)`); `updateItem` has its own wrapper below. Runs only on the client that made the change,
 * and only for item types that carry senses on an actor.
 */
export async function onItemChangeSyncVision(item, _options, userId) {
  const parent = item?.parent;
  if (parent?.documentName !== 'Actor' || !SENSE_ITEM_TYPES.includes(item.type)) return false;
  const me = globalThis.game?.user?.id;
  if (userId && me && userId !== me) return false;
  try {
    return await syncTokenVision(parent);
  } catch (err) {
    console.warn('Sprinter RPG | Could not sync token vision:', err);
    return false;
  }
}

/** `updateItem` passes `(item, changes, options, userId)`; the other two item hooks have no `changes`. */
export function onItemUpdateSyncVision(item, _changes, _options, userId) {
  return onItemChangeSyncVision(item, _options, userId);
}
