/**
 * Light sources, movement half. Lights are unlinked marker tokens (see light-source.mjs). Here:
 *  - `carried` lights follow the owner's token by the same delta,
 *    so their offset is kept. A follow runs on the client of the user who moved the token (`moveToken` fires on every client).
 *  - `free` lights are limited to `leash` feet from the owner. Past it the user is asked to confirm a Rule Break
 *    (Rule 2: never a hard block). Confirm records `ruleBreak: true` on the flag; decline puts the light on the leash point.
 *  - Double and Attach toggles for the HUD. An attached light (`flag.attached`) is fixed in place: it neither follows, is
 *    leash-checked, nor travels between scenes. Detach restores the mode it had (`flag.priorMode`).
 *  - Scene travel: the owner's token appearing on another scene brings its carried lights along (active GM).
 */
import { SYSTEM_ID } from '../../constants.mjs';
import { isActiveGM } from '../../utils/gm-relay.mjs';
import { isMarkerActor } from '../../utils/marker.mjs';
import { positionAfterMovement } from '../../utils/movement-position.mjs';
import { pixelsPerUnit } from '../../utils/region-shapes.mjs';
import { confirmRuleBreak } from '../../utils/rule-break.mjs';
import { LIGHT_FLAG, lightFlagOf, findLightTokens, extinguishTokens } from './light-source.mjs';

/** Operation option marking a move this module issued, so its own `moveToken` echo is ignored. */
export const LIGHT_MOVE_OPTION = 'lightFollow';

const isOwnLightMove = (operation) => Boolean(operation?.[SYSTEM_ID]?.[LIGHT_MOVE_OPTION]);

const lightFlagUpdate = (flag, changes) => ({ flags: { [SYSTEM_ID]: { [LIGHT_FLAG]: { ...flag, ...changes } } } });

const sceneTokens = (scene) => {
  const t = scene?.tokens;
  if (!t) return [];
  return Array.isArray(t) ? t : (Array.isArray(t.contents) ? t.contents : Array.from(t.values?.() || t));
};

const gridPx = (scene) => Number(scene?.grid?.size) || Number(globalThis.canvas?.grid?.size) || 50;

/** Centre of a token document in pixels. */
function centreOf(doc, at = doc) {
  const size = gridPx(doc?.parent);
  return {
    x: (Number(at?.x) || 0) + ((Number(doc?.width) || 1) * size) / 2,
    y: (Number(at?.y) || 0) + ((Number(doc?.height) || 1) * size) / 2
  };
}

/** Feet between the centres of two token documents on the same scene; `atA` overrides where `a` is. */
export function feetBetween(a, b, atA = a, atB = b) {
  const ca = centreOf(a, atA);
  const cb = centreOf(b, atB);
  return Math.hypot(ca.x - cb.x, ca.y - cb.y) / pixelsPerUnit(a?.parent ?? b?.parent);
}

/** The owner's own (non-light) token on the light's scene, or null. */
export function ownerTokenOf(lightDoc) {
  const flag = lightFlagOf(lightDoc);
  if (!flag) return null;
  return sceneTokens(lightDoc.parent).find((d) => !lightFlagOf(d) && !isMarkerActor(d) && d.actor?.uuid === flag.ownerUuid) ?? null;
}

/** The `carried`, not attached, lights that follow this token (it is their owner's token). */
export function followersOf(tokenDoc) {
  if (!tokenDoc || lightFlagOf(tokenDoc) || isMarkerActor(tokenDoc)) return [];
  const ownerUuid = tokenDoc.actor?.uuid;
  return sceneTokens(tokenDoc.parent).filter((d) => {
    const flag = lightFlagOf(d);
    return Boolean(flag) && flag.mode === 'carried' && !flag.attached && Boolean(ownerUuid) && flag.ownerUuid === ownerUuid;
  });
}

/** The leashed free lights of this token's actor on its scene. */
function leashedLightsOf(tokenDoc) {
  const ownerUuid = tokenDoc?.actor?.uuid;
  if (!ownerUuid || lightFlagOf(tokenDoc) || isMarkerActor(tokenDoc)) return [];
  return sceneTokens(tokenDoc.parent).filter((d) => {
    const flag = lightFlagOf(d);
    return flag && flag.mode === 'free' && !flag.attached && flag.ownerUuid === ownerUuid && Number(flag.leash) > 0;
  });
}

const canUpdate = (doc) => doc?.isOwner !== false;

const lightOp = { [SYSTEM_ID]: { [LIGHT_MOVE_OPTION]: true } };

/** Move a light token by a delta. */
async function shiftLight(doc, dx, dy) {
  if (!canUpdate(doc)) return null;
  return doc.update({ x: (Number(doc.x) || 0) + dx, y: (Number(doc.y) || 0) + dy }, { ...lightOp, animate: false });
}

/**
 * `moveToken` (every client): the user who moved a token carries its followers along, then free lights are leash-checked.
 * @returns {Promise<void>}
 */
export async function onLightTokenMove(tokenDoc, movement, operation, user) {
  const me = globalThis.game?.user;
  if (!tokenDoc || !me || (user?.id ?? user) !== me.id || isOwnLightMove(operation)) return;
  if (lightFlagOf(tokenDoc)) {
    await checkLeash(tokenDoc, movement?.origin, { lightAt: positionAfterMovement(tokenDoc, movement) });
    return;
  }
  if (isMarkerActor(tokenDoc)) return;
  const dx = (Number(movement?.destination?.x) || 0) - (Number(movement?.origin?.x) || 0);
  const dy = (Number(movement?.destination?.y) || 0) - (Number(movement?.origin?.y) || 0);
  if (dx || dy) for (const light of followersOf(tokenDoc)) await shiftLight(light, dx, dy);
  const ownerAt = positionAfterMovement(tokenDoc, movement);
  for (const light of leashedLightsOf(tokenDoc)) await checkLeash(light, null, { ownerAt });
}

/**
 * A free light that has just moved, or whose owner has: when it is now past its leash, ask for a Rule Break.
 * Confirm keeps it and flags `ruleBreak: true`; decline puts it on the leash point. Back inside clears the flag.
 * A light already past the leash under a confirmed Rule Break is not asked again.
 * @param {object} lightDoc light token document
 * @param {{x:number,y:number}|null} origin where the light was before the move (null: the owner moved)
 * @param {{ lightAt?: {x:number,y:number}, ownerAt?: {x:number,y:number} }} [at] where the light / owner token will be when
 *   its move ends (`moveToken` fires at the start, so the documents still hold the origin); defaults to the documents
 * @returns {Promise<'inside'|'confirmed'|'clamped'|'skipped'>}
 */
export async function checkLeash(lightDoc, origin, { lightAt = lightDoc, ownerAt = null } = {}) {
  const flag = lightFlagOf(lightDoc);
  const leash = Number(flag?.leash) || 0;
  if (!flag || flag.mode !== 'free' || flag.attached || leash <= 0 || !canUpdate(lightDoc)) return 'skipped';
  const owner = ownerTokenOf(lightDoc);
  if (!owner) return 'skipped';
  const ownerPos = ownerAt ?? owner;
  const feet = feetBetween(lightDoc, owner, lightAt, ownerPos);
  if (feet <= leash + 1e-6) {
    if (flag.ruleBreak) await lightDoc.update(lightFlagUpdate(flag, { ruleBreak: false }), { ...lightOp, animate: false });
    return 'inside';
  }
  if (flag.ruleBreak === true && (!origin || feetBetween(lightDoc, owner, origin, ownerPos) > leash)) return 'confirmed';
  const answer = await confirmRuleBreak({
    title: 'Light Beyond Its Leash',
    message: `Light is ${Math.round(feet)} ft from you (leash ${leash} ft). Move anyway as a Rule Break?`,
    reason: `${lightDoc.name || 'Light'} is ${Math.round(feet)} ft from its owner (leash ${leash} ft).`
  });
  if (answer.confirmed) {
    await lightDoc.update(lightFlagUpdate(flag, { ruleBreak: true }), { ...lightOp, animate: false });
    return 'confirmed';
  }
  const oc = centreOf(owner, ownerPos);
  const lc = centreOf(lightDoc, lightAt);
  const scale = (leash * pixelsPerUnit(lightDoc.parent)) / (Math.hypot(lc.x - oc.x, lc.y - oc.y) || 1);
  const half = ((Number(lightDoc.width) || 1) * gridPx(lightDoc.parent)) / 2;
  await lightDoc.update({
    x: Math.round(oc.x + (lc.x - oc.x) * scale - half),
    y: Math.round(oc.y + (lc.y - oc.y) * scale - half)
  }, { ...lightOp, animate: false });
  return 'clamped';
}

// -- Double / Attach ----------------------------------------------------------------------------------------------

/**
 * Toggle a light's doubling: bright and dim both x2 from the base radii (Q126 b), never by halving back.
 * @returns {Promise<boolean|null>} the new `doubled` state, or null when the light cannot double
 */
export async function toggleDouble(lightDoc, force) {
  const flag = lightFlagOf(lightDoc);
  if (!flag?.canDouble || !canUpdate(lightDoc)) return null;
  const doubled = typeof force === 'boolean' ? force : !flag.doubled;
  const factor = doubled ? 2 : 1;
  await lightDoc.update({
    light: { ...(lightDoc.light ?? {}), bright: Number(flag.baseBright) * factor, dim: Number(flag.baseDim) * factor },
    ...lightFlagUpdate(flag, { doubled })
  });
  return doubled;
}

/** The combatant of the light's owner in the running combat, or null. */
function ownerCombatant(combat, ownerUuid, ownerToken) {
  const list = combat?.combatants?.contents ?? Array.from(combat?.combatants ?? []);
  return list.find((c) => (ownerToken?.id && c.tokenId === ownerToken.id) || c.actor?.uuid === ownerUuid) ?? null;
}

/**
 * Attach a light (Q125 a, Q129 a): it stays where it is, no longer following the owner and free of the leash. Records an
 * Action on the owner in combat; with none left the user is asked for a Rule Break first. Out of combat nothing is recorded.
 * @returns {Promise<boolean>} whether the light was attached
 */
export async function attachLight(lightDoc) {
  const flag = lightFlagOf(lightDoc);
  if (!flag?.canAttach || flag.attached || !canUpdate(lightDoc)) return false;
  const combat = globalThis.game?.combat;
  const combatant = combat ? ownerCombatant(combat, flag.ownerUuid, ownerTokenOf(lightDoc)) : null;
  if (combat && combatant) {
    const actions = combat.getCombatantActions?.(combatant) ?? { spent: 0, max: Infinity };
    if (actions.spent >= actions.max) {
      const answer = await confirmRuleBreak({
        title: 'No Action Left',
        message: `${combatant.name} has no Action left (${actions.spent}/${actions.max}). Attach the light anyway as a Rule Break?`
      });
      if (!answer.confirmed) return false;
    }
    const recorded = await combat.recordCombatantAction(combatant, {
      type: 'other', label: 'Attach Light', category: 'utility', note: `Attached ${lightDoc.name || 'light'}`
    });
    if (recorded && recorded.success === false) return false;
  }
  await lightDoc.update(lightFlagUpdate(flag, { attached: true, priorMode: flag.mode, ruleBreak: false }));
  return true;
}

/** Release an attached light: it takes the mode it had before (not an Action). */
export async function detachLight(lightDoc) {
  const flag = lightFlagOf(lightDoc);
  if (!flag?.attached || !canUpdate(lightDoc)) return false;
  await lightDoc.update(lightFlagUpdate(flag, { attached: false, priorMode: '', mode: flag.priorMode === 'carried' ? 'carried' : 'free' }));
  return true;
}

// -- Scene travel -------------------------------------------------------------------------------------------------

/** Create data for a copy of a light token beside `ownerToken` on its scene. */
function travelData(lightDoc, ownerToken) {
  const size = gridPx(ownerToken.parent);
  const flag = lightFlagOf(lightDoc);
  return {
    name: lightDoc.name,
    actorId: lightDoc.actorId,
    actorLink: false,
    x: (Number(ownerToken.x) || 0) + size,
    y: Number(ownerToken.y) || 0,
    width: lightDoc.width,
    height: lightDoc.height,
    texture: structuredClone(lightDoc.texture ?? {}),
    sight: structuredClone(lightDoc.sight ?? { enabled: false }),
    displayBars: lightDoc.displayBars,
    displayName: lightDoc.displayName,
    disposition: lightDoc.disposition,
    light: structuredClone(lightDoc.light ?? {}),
    flags: { [SYSTEM_ID]: { [LIGHT_FLAG]: structuredClone(flag) } }
  };
}

/**
 * `createToken` (active GM): an owner's token appeared on a scene; its carried lights elsewhere move there (created
 * beside it, then deleted from the old scene). Free and attached lights stay.
 * @returns {Promise<number>} lights moved
 */
export async function onLightOwnerTokenCreate(tokenDoc) {
  if (!isActiveGM() || !tokenDoc?.parent || lightFlagOf(tokenDoc) || isMarkerActor(tokenDoc)) return 0;
  const ownerUuid = tokenDoc.actor?.uuid;
  if (!ownerUuid) return 0;
  const lights = findLightTokens((flag, doc) => flag.ownerUuid === ownerUuid && flag.mode === 'carried' && !flag.attached && doc.parent !== tokenDoc.parent);
  if (!lights.length) return 0;
  await tokenDoc.parent.createEmbeddedDocuments('Token', lights.map((d) => travelData(d, tokenDoc)));
  await extinguishTokens(lights);
  return lights.length;
}
