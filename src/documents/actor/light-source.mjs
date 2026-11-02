/**
 * Light sources: the pure part. An item is a light source when it carries a tag whose behaviour lists the
 * `emits-light` rule flag (the core `rule.emits-light` tag, derived from radii, or a module tag carrying the flag).
 * This module resolves the light such an item emits at its current Rank; igniting and extinguishing tokens (3.16c) is the second half of this file; following and the leash are 3.16d.
 */
import { getItemRank } from '../../data/tags.mjs';
import { hasRuleFlag, RULE_FLAGS } from '../../utils/tag-behaviour.mjs';
import { resolveReachedRankBreaks } from '../../utils/rank-breaks.mjs';
import { SYSTEM_ID } from '../../constants.mjs';
import { registerRelayAction, requestRelay, isNoGmReason } from '../../utils/gm-relay.mjs';
import { resolveActorByUuid } from '../../utils/actor-uuid.mjs';
import { findActorToken } from '../../utils/interrupts.mjs';
import { getOrCreateLightMarker } from './light-marker.mjs';
import { userOwnsActor } from './personal-space-links.mjs';
import { TIME_UNITS, timingAmount } from '../../utils/timing.mjs';
import { expiryStamp } from '../../utils/durations.mjs';
import { currentTimeContext } from './dungeon-time.mjs';
import { registerExpirySource } from './duration-expiry.mjs';
import { leaveUsedFormById, resolveUsedFormId } from './used-items.mjs';

/** Radii and behaviour of a light source that names none (a bare `rule.emits-light` tag). `CONFIG.COG.lightDefaults` is a copy modules may edit. */
export const DEFAULT_LIGHT = Object.freeze({ bright: 20, dim: 40, mode: 'carried', leash: 0, img: 'icons/svg/light.svg' });

const positive = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/**
 * Whether the item is a light source.
 * @param {object} item
 * @returns {boolean}
 */
export function emitsLight(item) {
  return hasRuleFlag(item, RULE_FLAGS.emitsLight);
}

/**
 * The light an item emits at its current Rank, or null when it is not a light source.
 * Radii come from `system.light`, or the defaults when it names none; reached rank-break bonuses add to both radii.
 * `mode` and `leash` take the highest reached break that sets one. `canDouble` / `canAttach` report the unlocked HUD
 * toggles; `doubled: true` (honoured only when `canDouble`) multiplies bright and dim by 2 from the base values, never
 * by halving them back.
 * @param {object} item
 * @param {{ doubled?: boolean, defaults?: object }} [opts] `defaults` overrides `CONFIG.COG.lightDefaults`
 * @returns {{ bright: number, dim: number, baseBright: number, baseDim: number, color: string|null, animation: string|null,
 *   mode: 'carried'|'free', leash: number, img: string, canDouble: boolean, canAttach: boolean, doubled: boolean }|null}
 */
export function resolveEffectiveLight(item, { doubled = false, defaults } = {}) {
  if (!item || !emitsLight(item)) return null;
  const base = { ...DEFAULT_LIGHT, ...(defaults ?? globalThis.CONFIG?.COG?.lightDefaults ?? {}) };
  const own = item.system?.light ?? {};
  const named = positive(own.bright) > 0 || positive(own.dim) > 0;
  const reached = resolveReachedRankBreaks(item, getItemRank(item)).light;

  const baseBright = (named ? positive(own.bright) : positive(base.bright)) + reached.brightBonus;
  const baseDim = (named ? positive(own.dim) : positive(base.dim)) + reached.dimBonus;
  const canDouble = reached.canDouble;
  const isDoubled = canDouble && doubled === true;
  const factor = isDoubled ? 2 : 1;
  const ownMode = own.mode === 'free' || own.mode === 'carried' ? own.mode : base.mode;

  return {
    bright: baseBright * factor,
    dim: baseDim * factor,
    baseBright,
    baseDim,
    color: String(own.color ?? '').trim() || null,
    animation: String(own.animation ?? '').trim() || null,
    mode: reached.mode || (ownMode === 'free' ? 'free' : 'carried'),
    leash: reached.leash ?? (positive(own.leash) || positive(base.leash)),
    img: String(own.img ?? '').trim() || base.img,
    canDouble,
    canAttach: reached.canAttach,
    doubled: isDoubled
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Ignite / extinguish. A lit light is an unlinked token of the owner's marker actor carrying a Foundry
// `light`; its flag `flags.sprinter-rpg.lightSource` is the only runtime state (nothing is stored on the item).
// Players lack TOKEN_CREATE/TOKEN_DELETE by default, so both go through GM relays when the user cannot write directly.
// ---------------------------------------------------------------------------------------------------------------

export const LIGHT_FLAG = 'lightSource';
export const RELAY_ACTION_CREATE_LIGHT_TOKEN = 'createLightToken';
export const RELAY_ACTION_DELETE_LIGHT_TOKENS = 'deleteLightTokens';

const sceneList = () => {
  const s = globalThis.game?.scenes;
  if (!s) return [];
  return Array.isArray(s) ? s : (Array.isArray(s.contents) ? s.contents : Array.from(s.values?.() || s));
};

const tokenList = (scene) => {
  const t = scene?.tokens;
  if (!t) return [];
  return Array.isArray(t) ? t : (Array.isArray(t.contents) ? t.contents : Array.from(t.values?.() || t));
};

/** The `lightSource` flag of a token document, or null when it is not a light token. */
export function lightFlagOf(tokenDoc) {
  const flag = tokenDoc?.flags?.[SYSTEM_ID]?.[LIGHT_FLAG] ?? tokenDoc?.getFlag?.(SYSTEM_ID, LIGHT_FLAG);
  return flag && typeof flag === 'object' ? flag : null;
}

/**
 * Every light token on every scene whose flag matches.
 * @param {(flag: object, tokenDoc: object) => boolean} [predicate]
 * @returns {object[]} token documents
 */
export function findLightTokens(predicate = () => true) {
  const out = [];
  for (const scene of sceneList()) {
    for (const doc of tokenList(scene)) {
      const flag = lightFlagOf(doc);
      if (flag && predicate(flag, doc)) out.push(doc);
    }
  }
  return out;
}

/** Light tokens an item lit (a consumed torch's stack item may be gone, but its tokens keep its uuid). */
export function litTokensForItem(item) {
  const uuid = item?.uuid;
  return uuid ? findLightTokens((flag) => flag.sourceItemUuid === uuid) : [];
}

/** Whether the item currently has a lit light token. */
export function isLit(item) {
  return litTokensForItem(item).length > 0;
}

const canWriteTokens = (permission) => {
  const user = globalThis.game?.user;
  return Boolean(user?.isGM || user?.hasPermission?.(permission));
};

/**
 * The world time a freshly lit token burns out (3.12e): `light.duration` (a time unit) from `now`, scaled at the holder's
 * rank. Null for an untimed light (no duration, a non-time unit, or an amount of 0).
 * @param {object} item the light source
 * @param {{ actor?: object|null, now?: number }} [opts] `now` defaults to the world time
 * @returns {number|null}
 */
export function lightExpiryStamp(item, { actor = null, now } = {}) {
  const spec = item?.system?.light?.duration;
  if (!spec || typeof spec !== 'object') return null;
  if (TIME_UNITS[spec.type]?.kind !== 'time') return null;
  const amount = timingAmount({ value: spec.value, unit: spec.type, scaleBy: spec.scaleBy }, { actor, source: item });
  if (!(amount > 0)) return null;
  const start = Number.isFinite(now) ? now : currentTimeContext(actor).time;
  return expiryStamp(spec, start, { amount });
}

/** Pure: the create data for a light token. `light` is a `resolveEffectiveLight` result; `ownerToken` the owner's token document. */
export function buildLightTokenData({ marker, item, light, ownerUuid, ownerToken, consumed = false, actor = null, now }) {
  const grid = Number(ownerToken?.parent?.grid?.size) || Number(globalThis.canvas?.grid?.size) || 100;
  const modes = globalThis.CONST?.TOKEN_DISPLAY_MODES;
  const expiresAt = lightExpiryStamp(item, { actor, now });
  const disposition = Number.isFinite(Number(ownerToken?.disposition)) ? Number(ownerToken.disposition) : (globalThis.CONST?.TOKEN_DISPOSITIONS?.FRIENDLY ?? 1);
  return {
    name: item?.name || 'Light',
    actorId: marker.id,
    actorLink: false,
    x: (Number(ownerToken?.x) || 0) + grid,
    y: Number(ownerToken?.y) || 0,
    width: 0.5,
    height: 0.5,
    texture: { src: light.img },
    sight: { enabled: false },
    displayBars: modes?.NONE ?? 0,
    displayName: modes?.OWNER_HOVER ?? 30,
    disposition,
    light: {
      bright: light.bright,
      dim: light.dim,
      color: light.color || null,
      animation: { type: light.animation || null }
    },
    flags: {
      [SYSTEM_ID]: {
        [LIGHT_FLAG]: {
          ownerUuid,
          sourceItemUuid: item?.uuid ?? '',
          mode: light.mode,
          leash: light.leash,
          canDouble: light.canDouble,
          canAttach: light.canAttach,
          doubled: light.doubled,
          baseBright: light.baseBright,
          baseDim: light.baseDim,
          consumed: Boolean(consumed),
          // What the owner gets when this independent light ends (3.76 B3): a used-form id, resolved while the item still exists.
          ...(consumed ? { usedInto: resolveUsedFormId(item, { light: true }) } : {}),
          ...(expiresAt === null ? {} : { expiresAt })
        }
      }
    }
  };
}

/** Create the token on the scene the owner's token is on. Runs on whoever may write tokens (the user or the GM). */
async function createLightTokenOn(scene, actor, item, ownerToken, consumed) {
  const light = resolveEffectiveLight(item);
  if (!light) return null;
  const marker = await getOrCreateLightMarker(actor);
  if (!marker) return null;
  const data = buildLightTokenData({ marker, item, light, ownerUuid: actor.uuid, ownerToken, consumed, actor });
  const [doc] = await scene.createEmbeddedDocuments('Token', [data]);
  return doc ?? null;
}

/** May `requester` make or remove this actor's lights? Mob lights are GM-only (Q130). */
function mayLightFor(actor, requester) {
  if (!actor || !requester?.id) return false;
  if (requester.isGM) return true;
  if (actor.type === 'mob') return false;
  return userOwnsActor(actor, requester);
}

/**
 * Light `item` for `actor`: an unlinked marker token beside the actor's token. An item already lit (and not `consumed`)
 * keeps its token and nothing is created. Each `consumed` ignite (a used torch) makes an independent torch (Q128 a).
 * @param {Actor} actor the item's owner
 * @param {Item} item a light source (`rule.emits-light`)
 * @param {{ consumed?: boolean }} [opts]
 * @returns {Promise<object|null>} the token document (null: not a light, no token on the canvas, or no GM)
 */
export async function igniteLight(actor, item, { consumed = false } = {}) {
  if (!actor || !item || !emitsLight(item)) return null;
  if (!consumed) {
    const [existing] = litTokensForItem(item);
    if (existing) return existing;
  }
  const ownerToken = findActorToken(actor)?.document;
  const scene = ownerToken?.parent ?? globalThis.canvas?.scene;
  if (!ownerToken || !scene) {
    globalThis.ui?.notifications?.warn?.(`Sprinter RPG | ${actor.name} has no token on this scene, so ${item.name} gives no light.`);
    return null;
  }
  if (canWriteTokens('TOKEN_CREATE')) {
    // The direct branch gets the same owner / GM-only check the relay applies (L4).
    if (!mayLightFor(actor, globalThis.game?.user)) {
      globalThis.ui?.notifications?.warn?.(`Sprinter RPG | You do not own ${actor.name}, so you cannot light ${item.name}.`);
      return null;
    }
    return createLightTokenOn(scene, actor, item, ownerToken, consumed);
  }
  const reply = await requestRelay(RELAY_ACTION_CREATE_LIGHT_TOKEN, {
    actorUuid: actor.uuid, itemId: item.id, sceneId: scene.id, ownerTokenId: ownerToken.id, consumed: Boolean(consumed)
  });
  if (!reply.ok) {
    if (!isNoGmReason(reply.reason)) globalThis.ui?.notifications?.warn?.(`Sprinter RPG | The GM did not allow ${item.name} to light.`);
    return null;
  }
  return scene.tokens?.get?.(reply.result?.tokenId) ?? null;
}

function tokenByUuid(uuid) {
  const [kind, sceneId, tokenKind, tokenId] = String(uuid ?? '').split('.');
  if (kind !== 'Scene' || tokenKind !== 'Token') return null;
  return globalThis.game?.scenes?.get?.(sceneId)?.tokens?.get?.(tokenId) ?? null;
}

async function deleteTokensOnScenes(docs) {
  const byScene = new Map();
  for (const doc of docs) {
    const scene = doc.parent;
    if (!scene) continue;
    byScene.set(scene, [...(byScene.get(scene) ?? []), doc.id]);
  }
  for (const [scene, ids] of byScene) await scene.deleteEmbeddedDocuments('Token', ids);
  return docs.length;
}

/**
 * What a set of light tokens owes their owners when the lights end (3.76 B3): one used form for each consumed torch.
 * Read before the tokens are deleted. A light that is not consumed (a lantern, an equipped light) owes nothing.
 */
function endedLightsOwed(docs) {
  return docs.flatMap((doc) => {
    const flag = lightFlagOf(doc);
    return flag?.consumed && flag.usedInto && flag.ownerUuid ? [{ ownerUuid: flag.ownerUuid, usedInto: flag.usedInto }] : [];
  });
}

/** Give each owner the junk their ended lights left. An owner who no longer exists gets nothing and causes no error. */
async function giveEndedLights(owed) {
  for (const { ownerUuid, usedInto } of owed) {
    try {
      await leaveUsedFormById(resolveActorByUuid(ownerUuid), usedInto);
    } catch (err) {
      console.warn('Sprinter RPG | Could not leave the used form of an ended light:', err);
    }
  }
}

/**
 * Delete light tokens (any scene). Directly when the user may delete tokens, else through `deleteLightTokens`.
 * `ended: true` says the light ran its course (it burned out, or the owner put it out): a consumed torch then leaves its
 * used form with its owner. Scene travel deletes and recreates a token and passes nothing, so it leaves none.
 * @param {object[]} tokenDocs
 * @param {{ ended?: boolean }} [opts]
 */
export async function extinguishTokens(tokenDocs, { ended = false } = {}) {
  const docs = (tokenDocs ?? []).filter((d) => lightFlagOf(d));
  if (!docs.length) return 0;
  if (canWriteTokens('TOKEN_DELETE')) {
    const owed = ended ? endedLightsOwed(docs) : [];
    const removed = await deleteTokensOnScenes(docs);
    await giveEndedLights(owed);
    return removed;
  }
  const reply = await requestRelay(RELAY_ACTION_DELETE_LIGHT_TOKENS, { tokenUuids: docs.map((d) => d.uuid), ended: Boolean(ended) });
  if (!reply.ok && !isNoGmReason(reply.reason)) globalThis.ui?.notifications?.warn?.('Sprinter RPG | The GM did not allow the light to be put out.');
  return reply.ok ? docs.length : 0;
}

/** Put out every light the item lit. Returns how many tokens were removed. */
export function extinguish(item) {
  return extinguishTokens(litTokensForItem(item));
}

/** Put out every light an actor owns (the owner's token HUD button). */
export function extinguishOwnerLights(actor) {
  return extinguishTokens(findLightTokens((flag) => flag.ownerUuid === actor?.uuid));
}

registerRelayAction(RELAY_ACTION_CREATE_LIGHT_TOKEN, {
  authorize: (payload, requester) => {
    const actor = resolveActorByUuid(payload?.actorUuid);
    return mayLightFor(actor, requester) && Boolean(actor.items?.get(payload?.itemId));
  },
  apply: async (payload) => {
    const actor = resolveActorByUuid(payload?.actorUuid);
    const item = actor?.items?.get(payload?.itemId);
    const scene = globalThis.game?.scenes?.get?.(payload?.sceneId);
    const ownerToken = scene?.tokens?.get?.(payload?.ownerTokenId);
    // Everything but the ids is derived here from the documents.
    if (!item || !emitsLight(item) || !scene || !ownerToken) return null;
    const doc = await createLightTokenOn(scene, actor, item, ownerToken, payload.consumed === true);
    return doc ? { tokenId: doc.id, uuid: doc.uuid } : null;
  }
});

registerRelayAction(RELAY_ACTION_DELETE_LIGHT_TOKENS, {
  authorize: (payload, requester) => {
    const uuids = Array.isArray(payload?.tokenUuids) ? payload.tokenUuids : [];
    if (!uuids.length) return false;
    return uuids.every((uuid) => {
      const doc = tokenByUuid(uuid);
      return Boolean(doc && lightFlagOf(doc)) && (requester?.isGM || userOwnsActor(doc.actor, requester));
    });
  },
  apply: async (payload) => {
    const docs = (payload.tokenUuids ?? []).map(tokenByUuid).filter(Boolean);
    const owed = payload.ended === true ? endedLightsOwed(docs) : [];
    const removed = await deleteTokensOnScenes(docs);
    await giveEndedLights(owed);
    return { removed };
  }
});

// -- Triggers ---------------------------------------------------------------------------------------------------

/** A spell cast on its caster that is not an aura: the Torch case. Auras light through activateAura. */
export function isSelfLightSpell(item) {
  return item?.type === 'spell' && item.system?.delivery === 'self' && emitsLight(item);
}

const ownUserChange = (userId) => {
  const me = globalThis.game?.user?.id;
  return !(userId && me && userId !== me);
};

/** `createItem`: a buff applied, or gear created already equipped, lights. */
export async function onLightItemCreate(item, _options, userId) {
  const actor = item?.parent;
  if (actor?.documentName !== 'Actor' || !ownUserChange(userId)) return null;
  const lights = item.type === 'buff' || (item.type === 'gear' && item.system?.equipped === true);
  return lights && emitsLight(item) ? igniteLight(actor, item) : null;
}

/** `updateItem`: gear equipped lights, unequipped puts out. */
export async function onLightItemUpdate(item, changes, _options, userId) {
  const actor = item?.parent;
  if (actor?.documentName !== 'Actor' || item.type !== 'gear' || !ownUserChange(userId)) return null;
  const equipped = changes?.system?.equipped ?? changes?.['system.equipped'];
  if (typeof equipped !== 'boolean' || !emitsLight(item)) return null;
  return equipped ? igniteLight(actor, item) : extinguish(item);
}

/** `deleteItem`: puts out the item's lights, except torches already burning independently of their stack (`consumed`). */
export async function onLightItemDelete(item, _options, userId) {
  if (item?.parent?.documentName !== 'Actor' || !ownUserChange(userId)) return 0;
  const uuid = item.uuid;
  return extinguishTokens(findLightTokens((flag) => flag.sourceItemUuid === uuid && !flag.consumed));
}

// -- Burning out (3.12e) -----------------------------------------------------------------------------------------

/** The `'lights'` expiry source: every light token whose stamped `expiresAt` has been reached, on any scene. */
export const lightExpirySource = {
  collect: (now) => findLightTokens((flag) => Number.isFinite(flag.expiresAt) && flag.expiresAt <= (Number(now) || 0)).map((doc) => ({
    label: doc.name || 'Light',
    actorName: resolveActorByUuid(lightFlagOf(doc)?.ownerUuid)?.name ?? '',
    expire: () => extinguishTokens([doc], { ended: true })
  }))
};

/** Hook the torch burn into the world-time sweep. Once, from the ready hook. */
export function registerLightExpiry() {
  registerExpirySource('lights', lightExpirySource);
}
