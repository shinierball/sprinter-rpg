/**
 * "Place Area of Effect" chat button on a spell or skill card.
 *
 * The area comes from the item the button names (`data-item-uuid`), never from the button's size attributes: shape,
 * size and rank-break bonuses are resolved by `resolveAreaGeometry`. A burst is dropped at the caster. A cone or line
 * starts at the caster and is aimed with the pointer. A blast, wall or rectangle is moved and rotated into place.
 * The user then targets the tokens inside the placed area.
 */
import { findTokenByActorUuid } from '../../utils/actor-uuid.mjs';
import { resolveAreaGeometry } from '../../utils/area/area-geometry.mjs';
import { buildAreaShape, tokensInRegion } from '../../utils/area/region-shapes.mjs';
import { auraRank } from '../../documents/actor/aura-effects.mjs';
import { createAreaRegions, tokenCenterOf } from '../../documents/actor/area-relay.mjs';
import { postAreaPlacedCard } from '../area-placed-card.mjs';

const toDegrees = (rad) => ((rad * 180) / Math.PI + 360) % 360;
const aim = (from, to) => toDegrees(Math.atan2(to.y - from.y, to.x - from.x));

/** The caster's token placeable on the viewed scene: by actor uuid, else the controlled token. */
function findCasterToken(actorUuid) {
  const tokens = globalThis.canvas?.tokens;
  let token = actorUuid && tokens?.placeables ? findTokenByActorUuid(tokens.placeables, actorUuid) : null;
  if (!token && tokens?.controlled?.length) token = tokens.controlled[0];
  return token ?? null;
}

/** First targeted token of the user, if any. */
function firstTarget() {
  const targets = globalThis.game?.user?.targets;
  return targets?.size ? Array.from(targets)[0] : null;
}

/** Where a point-anchored area starts when the interactive placement is unavailable: the first target, the mouse, the scene centre. */
function fallbackPoint() {
  const target = firstTarget();
  if (target) return tokenCenterOf(target, globalThis.canvas?.scene);
  const mouse = globalThis.canvas?.mousePosition;
  if (mouse) return { x: mouse.x, y: mouse.y };
  const centre = globalThis.canvas?.dimensions?.rect?.center;
  return centre ? { x: centre.x, y: centre.y } : { x: 0, y: 0 };
}

/**
 * Let the user place the shape: caster shapes keep the caster as origin and aim with the pointer, point shapes use
 * Foundry's own move and wheel rotation. Falls back to a fixed placement when the canvas cannot place interactively.
 * @returns {Promise<{ origin: {x:number,y:number}, rotation: number }|null>} null when the user dismissed the placement
 */
async function choosePlacement(geometry, scene, casterToken) {
  const casterCentre = casterToken ? tokenCenterOf(casterToken, scene) : null;
  const casterAnchored = geometry.anchor === 'caster' && casterCentre;
  const needsRotation = geometry.regionKind !== 'burst' && geometry.regionKind !== 'circle';
  const interactive = typeof globalThis.canvas?.regions?.placeRegion === 'function';

  // A burst has no direction: it is simply the caster's circle.
  if (casterAnchored && !needsRotation) return { origin: casterCentre, rotation: 0 };

  if (!interactive) {
    if (casterAnchored) {
      const target = firstTarget();
      return { origin: casterCentre, rotation: target ? aim(casterCentre, tokenCenterOf(target, scene)) : 0 };
    }
    return { origin: fallbackPoint(), rotation: 0 };
  }

  const start = casterAnchored ? casterCentre : fallbackPoint();
  const shape = buildAreaShape(geometry, { scene, origin: start, rotation: 0 });
  const previewData = { name: 'Area of Effect', color: '#e67e22', shapes: [shape] };
  const options = { create: false, allowRotation: !casterAnchored };
  if (casterAnchored) {
    // The origin stays on the caster; the pointer only sets the direction.
    options.onMove = ({ shape: live, position }) => {
      live.rotation = aim(casterCentre, position);
      return false;
    };
  }
  const placed = await globalThis.canvas.regions.placeRegion(previewData, options);
  const placedShape = placed?.shapes?.[0];
  if (!placedShape) return null;
  const rotation = Number(placedShape.rotation) || 0;
  if (casterAnchored) return { origin: casterCentre, rotation };
  return { origin: { x: Number(placedShape.x) || 0, y: Number(placedShape.y) || 0 }, rotation };
}

/**
 * The user's targets become exactly the tokens inside the placed regions. `skipId` is a token left out (the caster's own
 * token, which sits at the apex of its own cone or line).
 */
function targetTokensInside(regions, scene, skipId = '') {
  if (scene !== globalThis.canvas?.scene) return;
  const inside = new Map();
  for (const region of regions) {
    for (const doc of tokensInRegion(region)) if (doc.id !== skipId) inside.set(doc.id, doc);
  }
  const placeables = [...inside.values()].map(doc => doc.object).filter(Boolean);
  const user = globalThis.game?.user;
  if (!placeables.length) {
    for (const t of Array.from(user?.targets ?? [])) t.setTarget?.(false, { releaseOthers: false });
    return;
  }
  placeables.forEach((token, i) => token.setTarget?.(true, { releaseOthers: i === 0 }));
}

/** One-line description of the placed area for the notification. */
function describeArea(geometry) {
  const size = geometry.size === 'length' ? `${geometry.length}ft x ${geometry.width}ft` : `${geometry.distance}ft`;
  const splash = geometry.splash > 0 ? ` +${geometry.splash}ft splash` : '';
  return `${size} ${geometry.shape}${splash}`;
}

/**
 * @param {Event} event
 * @param {HTMLElement} button
 * @param {ChatMessage} message
 */
export async function handlePlaceTemplate(event, button, message) {
  const scene = globalThis.canvas?.scene;
  if (!scene) return;
  const itemUuid = button.dataset?.itemUuid;
  const item = itemUuid ? globalThis.fromUuidSync?.(itemUuid) : null;
  const geometry = item ? resolveAreaGeometry(item, { rank: auraRank(item.parent, item) }) : null;
  if (!geometry) {
    globalThis.ui?.notifications?.warn?.('Sprinter RPG | This card no longer points at an item with an area.');
    return;
  }

  const casterToken = findCasterToken(button.dataset?.actorUuid || item.parent?.uuid);
  const placement = await choosePlacement(geometry, scene, casterToken);
  if (!placement) return;

  const created = await createAreaRegions(item, {
    scene,
    origin: placement.origin,
    rotation: placement.rotation,
    messageId: message?.id ?? null,
    casterToken: casterToken?.document ?? casterToken ?? undefined
  });
  if (!created.length) return;
  // A caster-anchored area does not target its own caster unless it is meant for allies.
  const skipId = geometry.anchor === 'caster' && geometry.targetFilter !== 'allies' ? (casterToken?.document?.id ?? casterToken?.id ?? '') : '';
  targetTokensInside(created, scene, skipId);
  globalThis.ui?.notifications?.info(`Sprinter RPG | Placed ${describeArea(geometry)}.`);
  await postAreaPlacedCard(created, { item, scene });
}
