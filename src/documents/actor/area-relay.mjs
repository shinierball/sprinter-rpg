/**
 * Placed-area Region writes for users who may not make them.
 *
 * A player usually holds the Region create right (`ensurePlayerRolePermissions` restores it for the Player role at each
 * GM login), so a placed area is created directly. A user without it, and a user deleting a Region they do not own (an
 * old aura region, someone else's zone), ask the active GM through the GM relay. Authorization is by the requesting user (identified by socketlib, never by the
 * payload): a GM, or an owner of the actor holding the source item. Nothing about a region's size or flags comes from
 * the payload. A create request names only the source item, the scene and a placement; the GM rebuilds the regions
 * from the item and sets the requester as their owner.
 */
import { SYSTEM_ID } from '../../constants.mjs';
import { registerRelayAction, requestRelay, isNoGmReason } from '../../utils/gm-relay.mjs';
import { resolveAreaGeometry } from '../../utils/area-geometry.mjs';
import { buildAreaRegions, findAreaRegions, findAuraRegions, sceneRegions, deleteRegions } from '../../utils/region-shapes.mjs';
import { hasRuleFlag, RULE_FLAGS } from '../../utils/tag-behaviour.mjs';
import { auraRank } from './aura-effects.mjs';
import { ownsAuraSource } from './aura-relay.mjs';

export const AREA_CREATE_REGIONS = 'areaCreateRegions';
export const AREA_DELETE_REGIONS = 'areaDeleteRegions';

const finite = (v) => Number.isFinite(Number(v));

function warn(message) {
  globalThis.ui?.notifications?.warn?.(`Sprinter RPG | ${message}`);
}

/**
 * Centre of a token (placeable or document) in pixels.
 * @param {object} token
 * @param {object} [scene] used for the grid size when the token has no centre of its own
 * @returns {{ x: number, y: number }}
 */
export function tokenCenterOf(token, scene) {
  const own = token?.object?.center ?? token?.center;
  if (own && finite(own.x) && finite(own.y)) return { x: own.x, y: own.y };
  const size = Number(scene?.grid?.size) || Number(globalThis.canvas?.grid?.size) || 50;
  const doc = token?.document ?? token;
  return {
    x: (Number(doc?.x) || 0) + ((Number(doc?.width) || 1) * size) / 2,
    y: (Number(doc?.y) || 0) + ((Number(doc?.height) || 1) * size) / 2
  };
}

/** The scene's token document whose actor is this one (by uuid, never by id: unlinked tokens share ids). */
export function findHolderToken(scene, holder) {
  if (!holder?.uuid) return null;
  const tokens = scene?.tokens;
  return Array.from(tokens?.contents ?? tokens ?? []).find(t => (t.actor?.uuid ?? '') === holder.uuid) ?? null;
}

/**
 * Region data for a placed item area, built from the item alone plus a placement. Caster-anchored shapes (burst,
 * cone, line) start at the holder's token centre on the scene when it has one; point-anchored shapes (blast, wall,
 * rect) start at `origin`.
 * A lingering area (the `zone` rule flag, derived as `rule.hazard`, and a non-instant duration) becomes a `zone`
 * region with its round count; anything else is a one-shot `marker`.
 * @param {Item} item the spell, skill or gear item holding the area
 * @param {{ scene: object, origin?: { x: number, y: number }, rotation?: number, userId?: string, messageId?: string|null,
 *   groupId?: string, casterToken?: object, kind?: 'zone'|'marker' }} p
 * @returns {object[]|null} region data, or null when the item has no area
 */
export function planAreaRegions(item, { scene, origin, rotation = 0, userId, messageId = null, groupId, casterToken, kind } = {}) {
  const holder = item?.parent ?? null;
  const geometry = resolveAreaGeometry(item, { rank: auraRank(holder, item) });
  if (!geometry) return null;
  const token = casterToken ?? findHolderToken(scene, holder);
  const start = geometry.anchor === 'caster' && token ? tokenCenterOf(token, scene) : origin;
  if (!start || !finite(start.x) || !finite(start.y)) return null;
  const isZone = kind ? kind === 'zone' : !geometry.isInstant && hasRuleFlag(item, RULE_FLAGS.zone);
  return buildAreaRegions(geometry, {
    scene,
    origin: start,
    rotation,
    casterToken: token,
    userId,
    name: item.name,
    groupId,
    kind: isZone ? 'zone' : 'marker',
    remainingRounds: isZone && geometry.durationRounds > 0 ? geometry.durationRounds : null,
    sourceItemUuid: item.uuid || '',
    casterUuid: holder?.uuid || '',
    messageId
  });
}

/**
 * Create the regions for a placed item area on a scene: directly when the user may, else through the GM.
 * @param {Item} item
 * @param {{ scene: object, origin?: { x: number, y: number }, rotation?: number, messageId?: string|null, casterToken?: object }} p
 * @returns {Promise<object[]>} the created RegionDocuments (empty when nothing was created)
 */
export async function createAreaRegions(item, { scene, origin, rotation = 0, messageId = null, casterToken } = {}) {
  const user = globalThis.game?.user;
  if (user?.isGM || user?.hasPermission?.('REGION_CREATE')) {
    const data = planAreaRegions(item, { scene, origin, rotation, userId: user?.id, messageId, casterToken });
    if (!data?.length) return [];
    return (await scene.createEmbeddedDocuments('Region', data)) ?? [];
  }
  const reply = await requestRelay(AREA_CREATE_REGIONS, {
    sourceItemUuid: item.uuid || '',
    sceneUuid: scene.uuid || '',
    origin: { x: Number(origin?.x) || 0, y: Number(origin?.y) || 0 },
    rotation: Number(rotation) || 0,
    messageId
  }, { direct: false });
  if (!reply.ok) {
    if (!isNoGmReason(reply.reason)) warn('The GM could not place this area.');
    return [];
  }
  const ids = Array.isArray(reply.result?.ids) ? reply.result.ids : [];
  const regions = sceneRegions(scene);
  return ids.map(id => regions.find(r => r.id === id)).filter(Boolean);
}

/** The item a region was placed from, by uuid (an area or an aura). */
function regionSourceUuid(region) {
  const f = region?.flags?.[SYSTEM_ID];
  return f?.area?.sourceItemUuid || f?.auraSourceUuid || '';
}

/** A GM, or an owner of the actor holding the region's source item. */
function mayDelete(region, user) {
  if (user?.isGM) return true;
  return ownsAuraSource(regionSourceUuid(region), user);
}

/** The regions a delete payload names: one placed group, or one aura's regions. */
function regionsOfPayload(scene, p) {
  if (!scene) return [];
  if (typeof p?.groupId === 'string' && p.groupId) return findAreaRegions(scene, { groupId: p.groupId });
  if (typeof p?.auraSourceUuid === 'string' && p.auraSourceUuid) return findAuraRegions(scene, p.auraSourceUuid);
  return [];
}

const sceneOfPayload = (p) => (typeof p?.sceneUuid === 'string' && p.sceneUuid ? globalThis.fromUuidSync?.(p.sceneUuid) : null);

registerRelayAction(AREA_CREATE_REGIONS, {
  authorize(p, user) {
    const scene = sceneOfPayload(p);
    if (scene?.documentName !== 'Scene') return false;
    const item = typeof p?.sourceItemUuid === 'string' && p.sourceItemUuid ? globalThis.fromUuidSync?.(p.sourceItemUuid) : null;
    if (!item?.parent || !ownsAuraSource(p.sourceItemUuid, user)) return false;
    if (!resolveAreaGeometry(item, { rank: auraRank(item.parent, item) })) return false;
    return finite(p?.origin?.x) && finite(p?.origin?.y) && (p?.rotation === undefined || finite(p.rotation));
  },
  async apply(p, user) {
    const scene = sceneOfPayload(p);
    const item = globalThis.fromUuidSync?.(p.sourceItemUuid);
    const data = planAreaRegions(item, {
      scene,
      origin: { x: Number(p.origin.x), y: Number(p.origin.y) },
      rotation: Number(p.rotation) || 0,
      userId: user?.id,
      messageId: typeof p.messageId === 'string' ? p.messageId : null
    });
    if (!data?.length) return { ids: [] };
    const created = (await scene.createEmbeddedDocuments('Region', data)) ?? [];
    return { ids: created.map(r => r.id) };
  }
});

registerRelayAction(AREA_DELETE_REGIONS, {
  authorize(p, user) {
    const regions = regionsOfPayload(sceneOfPayload(p), p);
    return regions.length > 0 && regions.every(r => mayDelete(r, user));
  },
  async apply(p) {
    const scene = sceneOfPayload(p);
    await deleteRegions(scene, regionsOfPayload(scene, p));
  }
});

/**
 * Delete regions from a scene: the ones the user owns directly, the rest through the GM (`areaDeleteRegions`, by
 * placed group or by aura).
 * @param {object} scene
 * @param {object[]} regions
 * @returns {Promise<boolean>} false when a request to the GM was refused or could not be delivered
 */
export async function deleteAreaRegions(scene, regions) {
  if (!scene || !regions?.length) return true;
  const user = globalThis.game?.user;
  const own = regions.filter(r => user?.isGM || r.isOwner);
  const rest = regions.filter(r => !own.includes(r));
  if (own.length) await deleteRegions(scene, own);

  const requests = new Map();
  for (const region of rest) {
    const f = region.flags?.[SYSTEM_ID];
    const key = f?.area?.groupId ? { groupId: f.area.groupId } : { auraSourceUuid: f?.auraSourceUuid || '' };
    if (!key.groupId && !key.auraSourceUuid) continue;
    requests.set(`${key.groupId ?? ''}|${key.auraSourceUuid ?? ''}`, key);
  }
  let ok = true;
  for (const key of requests.values()) {
    const reply = await requestRelay(AREA_DELETE_REGIONS, { sceneUuid: scene.uuid || '', ...key }, { direct: false });
    if (!reply.ok) {
      ok = false;
      if (!isNoGmReason(reply.reason)) warn('The GM could not remove this area.');
    }
  }
  return ok;
}

/** Delete one placed group (its core and splash regions) from a scene. @returns {Promise<boolean>} */
export function deleteAreaGroup(scene, groupId) {
  return deleteAreaRegions(scene, groupId ? findAreaRegions(scene, { groupId }) : []);
}

/**
 * Delete an aura's regions from every scene the client knows, not only the viewed one (a caster may dismiss the aura
 * while viewing another scene). Regions the user may not delete go through the GM.
 * @param {string} auraUuid the aura item's UUID
 * @returns {Promise<boolean>}
 */
export async function deleteAuraRegionsEverywhere(auraUuid) {
  if (!auraUuid) return true;
  const scenes = new Set();
  if (globalThis.canvas?.scene) scenes.add(globalThis.canvas.scene);
  for (const scene of Array.from(globalThis.game?.scenes ?? [])) scenes.add(scene);
  let ok = true;
  for (const scene of scenes) {
    if (!(await deleteAreaRegions(scene, findAuraRegions(scene, auraUuid)))) ok = false;
  }
  return ok;
}
