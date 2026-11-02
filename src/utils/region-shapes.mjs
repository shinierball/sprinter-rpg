/**
 * Region-based area markers (Foundry v14 merged MeasuredTemplate into Region).
 *
 * Geometry in, Region data out: `resolveAreaGeometry` (area-geometry.mjs) gives an area's size in feet and its shape
 * definition names the Region shape (`area.region`); this module turns that into native Foundry shapes (circle, cone,
 * line, rectangle, and an emanation with a hole for the splash ring) in pixels. Directions are degrees, 0 = east,
 * increasing clockwise on screen (canvas y points down).
 */
import { SYSTEM_ID } from '../constants.mjs';
import { resolveSplashRing } from './area-geometry.mjs';
import { isMarkerActor } from './marker.mjs';

/** Cone angle used when a shape definition carries none (the cone is a 60 degree arc). */
const DEFAULT_CONE_ANGLE = 60;
const OWNER = () => globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3;
const VISIBILITY_ALWAYS = () => globalThis.CONST?.REGION_VISIBILITY?.ALWAYS ?? 2;
const VISIBILITY_LAYER = () => globalThis.CONST?.REGION_VISIBILITY?.LAYER ?? 0;

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Pixels per scene distance unit (e.g. per foot): Foundry's own `dimensions.distancePixels` when the scene has it,
 * else the grid size over the grid distance.
 * @param {object} [scene]
 * @returns {number}
 */
export function pixelsPerUnit(scene) {
  const own = Number(scene?.dimensions?.distancePixels);
  if (own > 0) return own;
  const size = Number(scene?.grid?.size) || Number(globalThis.canvas?.grid?.size) || 100;
  const distance = Number(scene?.grid?.distance) || 5;
  return size / distance;
}

/**
 * The single level a restricted region must sit on: the explicit level, the caster token's level, the viewed
 * level when the scene is the viewed scene, else the scene's first level. Empty when none is known.
 * @param {object} scene
 * @param {{ level?: string, token?: object }} [options]
 * @returns {string}
 */
export function resolveRegionLevel(scene, { level, token } = {}) {
  if (level) return String(level);
  const tokenLevel = token?.level ?? token?.document?.level;
  if (tokenLevel) return String(tokenLevel);
  if (globalThis.canvas?.scene === scene && globalThis.canvas?.level?.id) return String(globalThis.canvas.level.id);
  const first = scene?.levels?.contents?.[0] ?? (Array.isArray(scene?.levels) ? scene.levels[0] : null);
  return first?.id ? String(first.id) : '';
}

/**
 * The fields every region this system places carries, as Foundry's own template mode sets them: the placing user
 * owns it (a Region has no author, so ownership is what lets a player delete their own), it is always visible, shows
 * its measurements and covers whole squares, and it clips against walls (restriction needs exactly one level).
 * @param {{ scene?: object, userId?: string, level?: string, token?: object }} [p]
 * @returns {object}
 */
export function regionDefaults({ scene, userId, level, token } = {}) {
  const levelId = resolveRegionLevel(scene, { level, token });
  const owner = userId ?? globalThis.game?.user?.id;
  return {
    visibility: VISIBILITY_ALWAYS(),
    highlightMode: 'coverage',
    displayMeasurements: true,
    ...(owner ? { ownership: { [owner]: OWNER() } } : {}),
    ...(levelId ? { levels: [levelId], restriction: { enabled: true, type: 'move' } } : {})
  };
}

/* -------------------------------------------- */
/*  Native shape builders                       */
/* -------------------------------------------- */

/**
 * Shape builders keyed by a shape definition's `area.region`. Each takes the geometry (feet), the placement and the
 * pixels per foot, and returns one Foundry shape data object. Exposed as `CONFIG.COG.areaRegionBuilders`.
 * - `burst`: a circle at the caster, grid-based on a gridded scene (the same circle an aura draws).
 * - `circle`: a circle at the placed point (a blast), grid-based on a gridded scene.
 * - `cone`: a native cone, apex at the origin.
 * - `line`: a native line from the origin (a line from the caster, or a wall at the placed point).
 * - `rectangle`: a native rectangle centred on the placed point.
 */
export const AREA_REGION_BUILDERS = {
  burst: (geometry, { x, y, px, gridded }) => ({
    type: 'circle', x, y, radius: round2(geometry.distance * px), hole: false, ...(gridded ? { gridBased: true } : {})
  }),
  circle: (geometry, { x, y, px, gridded }) => ({
    type: 'circle', x, y, radius: round2(geometry.distance * px), hole: false, ...(gridded ? { gridBased: true } : {})
  }),
  cone: (geometry, { x, y, px, rotation }) => ({
    type: 'cone', x, y, radius: round2(geometry.distance * px), angle: geometry.angle ?? DEFAULT_CONE_ANGLE,
    rotation, curvature: 'round', hole: false, gridBased: false
  }),
  line: (geometry, { x, y, px, rotation }) => ({
    type: 'line', x, y, length: round2(geometry.length * px), width: round2(geometry.width * px), rotation, hole: false, gridBased: false
  }),
  rectangle: (geometry, { x, y, px, rotation }) => ({
    type: 'rectangle', x, y, width: round2(geometry.length * px), height: round2(geometry.width * px),
    anchorX: 0.5, anchorY: 0.5, rotation, hole: false, gridBased: false
  })
};

/** The registered builder for a geometry's region kind, falling back to the burst circle for an unknown kind. */
function builderFor(geometry) {
  const registry = globalThis.CONFIG?.COG?.areaRegionBuilders ?? AREA_REGION_BUILDERS;
  return registry[geometry.regionKind] ?? AREA_REGION_BUILDERS.burst;
}

/** How a ring region draws: its real (round) shape, not the grid squares it covers. */
export const RING_HIGHLIGHT_MODE = 'shapes';

/**
 * The visual-only round twin of a grid-based circle: the same circle off the grid. A grid-based circle is measured
 * in the grid's own metric (the squares a measurement counts as inside) and Foundry draws it as squares; the twin is
 * drawn round. It belongs to no membership test, which reads the grid-based region alone.
 * @param {object} shape a Foundry shape data object
 * @returns {object|null} null unless `shape` is a grid-based circle
 */
export function ringShapeOf(shape) {
  return shape?.type === 'circle' && shape.gridBased ? { ...shape, gridBased: false } : null;
}

/**
 * The membership region of a ring pair, without its grid-coverage fill: visible only on the Regions layer (to
 * Observers, for editing), never in play, and no measurement label (the ring carries it). Membership reads the region
 * document's shapes, so it does not change; Foundry has no fill-alpha option on a Region, `visibility` is the switch.
 * @param {object} data region data
 * @returns {object}
 */
export function withoutCoverageFill(data) {
  return { ...data, visibility: VISIBILITY_LAYER(), displayMeasurements: false };
}

/** True when the core shape has no extent (a Blast of radius 0: the target is the core). */
function coreIsEmpty(geometry) {
  return geometry.size === 'length' ? !(geometry.length > 0 && geometry.width > 0) : !(geometry.distance > 0);
}

/**
 * The core shape of an area at an origin, in pixels.
 * @param {object} geometry resolveAreaGeometry() result
 * @param {{ scene?: object, origin: { x: number, y: number }, rotation?: number }} p
 * @returns {object} a Foundry shape data object
 */
export function buildAreaShape(geometry, { scene, origin, rotation = 0 }) {
  const gridded = !scene?.grid?.isGridless;
  return builderFor(geometry)(geometry, {
    x: round2(Number(origin?.x) || 0),
    y: round2(Number(origin?.y) || 0),
    px: pixelsPerUnit(scene),
    rotation: Number(rotation) || 0,
    gridded
  });
}

/**
 * The shapes of the splash region: the core shape grown by the splash distance with the core cut out of it. A circle
 * grows by radius; any other shape becomes an emanation of itself. An empty core leaves the grown shape alone.
 * @returns {object[]|null} null when there is no splash
 */
function buildSplashShapes(geometry, core, scene) {
  const ring = resolveSplashRing(geometry);
  if (!ring) return null;
  const px = pixelsPerUnit(scene);
  const empty = coreIsEmpty(geometry);
  let outer;
  if (core.type === 'circle') {
    outer = { ...core, radius: round2((geometry.distance + ring.grow) * px), hole: false };
  } else {
    const { hole: _hole, ...base } = core;
    outer = { type: 'emanation', base, radius: round2(ring.grow * px), hole: false, gridBased: false };
  }
  return empty ? [outer] : [outer, { ...core, hole: true }];
}

/**
 * Region data for an area: `[core]` or `[core, splash]` (the splash region only when the splash total is above 0;
 * the core is left out when it has no extent). Sizes come from the geometry in feet, positions are pixels.
 * Flags nest under the system id, the area ones under `area`.
 * @param {object} geometry resolveAreaGeometry() result
 * @param {{ scene?: object, origin: { x: number, y: number }, rotation?: number, casterToken?: object,
 *   userId?: string, name?: string, color?: string, level?: string, attachToken?: string, groupId?: string,
 *   kind?: 'zone'|'marker', remainingRounds?: number|null, sourceItemUuid?: string, casterUuid?: string, messageId?: string|null, flags?: object }} ctx
 * @returns {object[]} RegionData objects
 */
export function buildAreaRegions(geometry, ctx = {}) {
  const { scene, origin, rotation = 0, casterToken, userId, name = 'Area of Effect', color = '#e67e22', level, attachToken = '' } = ctx;
  const groupId = ctx.groupId || globalThis.foundry?.utils?.randomID?.() || `grp${Math.random().toString(36).slice(2, 10)}`;
  const combat = globalThis.game?.combat;
  const core = buildAreaShape(geometry, { scene, origin, rotation });
  const defaults = regionDefaults({ scene, userId, level, token: casterToken });
  const areaFlags = (role) => ({
    kind: ctx.kind ?? 'marker',
    role,
    groupId,
    sourceItemUuid: ctx.sourceItemUuid ?? '',
    casterUuid: ctx.casterUuid ?? '',
    shape: geometry.shape,
    combatId: combat?.id ?? null,
    placedRound: combat ? (Number(combat.round) || 0) : null,
    remainingRounds: role === 'core' ? (ctx.remainingRounds ?? null) : null,
    lastPulsedRound: null,
    messageId: ctx.messageId ?? null
  });
  const make = (role, regionName, shapes) => ({
    name: regionName,
    color,
    shapes,
    behaviors: [],
    locked: true,
    ...defaults,
    ...(attachToken ? { attachment: { token: attachToken } } : {}),
    flags: { [SYSTEM_ID]: { ...(ctx.flags ?? {}), area: areaFlags(role) } }
  });

  const regions = [];
  const splashShapes = buildSplashShapes(geometry, core, scene);
  const hasCore = !coreIsEmpty(geometry) || !splashShapes;
  // A grid-based circle highlights as grid squares: draw its round outline instead (membership stays the core's).
  const ring = hasCore ? ringShapeOf(core) : null;
  if (hasCore) regions.push(ring ? withoutCoverageFill(make('core', name, [core])) : make('core', name, [core]));
  if (splashShapes) regions.push(make('splash', `${name} (splash)`, splashShapes));
  if (ring) regions.push({ ...make('ring', `${name} (ring)`, [ring]), highlightMode: RING_HIGHLIGHT_MODE });
  return regions;
}

/**
 * Region document data for an aura: a circle around the caster, optionally attached to the caster's token so Foundry
 * moves it whenever the token moves. Carries the same region defaults as a placed area (owner, level, restriction,
 * visibility), so the casting player can delete it again. `flags` land under the system namespace.
 * @param {{ name?: string, color?: string, flags?: object, scene?: object, x: number, y: number, distance: number,
 *   gridBased?: boolean, attachToken?: string, level?: string, userId?: string }} p
 *   distance is in scene units (ft); x/y in pixels. `gridBased` makes the circle use the grid's own distance metric,
 *   so it covers the same squares a grid measurement counts as inside. `attachToken` is a token id.
 * @returns {object}
 */
export function buildRegionData({ name = 'Area of Effect', color = '#e67e22', flags = {}, scene, x, y, distance, gridBased = false, attachToken = '', level, userId } = {}) {
  return {
    name,
    color,
    shapes: [{ type: 'circle', x, y, radius: round2((Number(distance) || 0) * pixelsPerUnit(scene)), hole: false, ...(gridBased ? { gridBased: true } : {}) }],
    behaviors: [],
    ...regionDefaults({ scene, userId, level }),
    ...(attachToken ? { attachment: { token: attachToken } } : {}),
    flags: { [SYSTEM_ID]: { ...flags } }
  };
}

/**
 * The round outline twin of an aura region (see `ringShapeOf`): the same data as `buildRegionData`, off the grid,
 * drawn as its shape, flagged `ring` and carrying the aura's own flags so every delete-by-aura path removes it too.
 * @param {object} params the arguments of `buildRegionData`
 * @returns {object|null} null unless the aura circle is grid-based
 */
export function buildAuraRingData(params = {}) {
  if (!params.gridBased) return null;
  const data = buildRegionData(params);
  return {
    ...data,
    name: `${data.name} (ring)`,
    shapes: data.shapes.map(s => ringShapeOf(s) ?? s),
    highlightMode: RING_HIGHLIGHT_MODE,
    flags: { [SYSTEM_ID]: { ...data.flags[SYSTEM_ID], ring: true } }
  };
}

/* -------------------------------------------- */
/*  Scene helpers                               */
/* -------------------------------------------- */

/** @param {object} [scene] @returns {object[]} regions of the scene as an array */
export function sceneRegions(scene) {
  const regions = scene?.regions;
  if (!regions) return [];
  return Array.isArray(regions) ? regions : Array.from(regions.contents ?? regions);
}

/**
 * Aura regions on a scene, optionally only those emitted by one aura item UUID.
 * @param {object} [scene]
 * @param {string} [auraUuid] when passed, an empty value matches nothing
 * @returns {object[]}
 */
export function findAuraRegions(scene, auraUuid) {
  return sceneRegions(scene).filter(r => {
    const f = r.flags?.[SYSTEM_ID];
    if (!f?.isAura) return false;
    return auraUuid === undefined || (!!auraUuid && f.auraSourceUuid === auraUuid);
  });
}

/** Every scene the client knows: the viewed scene first, then `game.scenes`. */
function allScenes() {
  const scenes = new Set();
  if (globalThis.canvas?.scene) scenes.add(globalThis.canvas.scene);
  for (const scene of Array.from(globalThis.game?.scenes ?? [])) scenes.add(scene);
  return [...scenes];
}

/**
 * Placed area regions (flag `area`) on a scene, or on every scene when `scene` is null, filtered by flag fields.
 * @param {object|null} scene
 * @param {{ kind?: string, role?: string, groupId?: string, sourceItemUuid?: string }} [filter] omitted fields match anything
 * @returns {object[]}
 */
export function findAreaRegions(scene, { kind, role, groupId, sourceItemUuid } = {}) {
  const scenes = scene ? [scene] : allScenes();
  return scenes.flatMap(sc => sceneRegions(sc)).filter(r => {
    const f = r.flags?.[SYSTEM_ID]?.area;
    if (!f) return false;
    return (kind === undefined || f.kind === kind)
      && (role === undefined || f.role === role)
      && (groupId === undefined || f.groupId === groupId)
      && (sourceItemUuid === undefined || f.sourceItemUuid === sourceItemUuid);
  });
}

/**
 * Tokens with an actor inside the region by Foundry's own containment test (walls clip the region, and the test is
 * synchronous on any client; `RegionDocument#tokens` is filled late and only by the GM). Marker actors are excluded.
 * @param {object} region a RegionDocument
 * @param {Map<string, {x: number, y: number}>} [positions] token id -> top-left it is moving to (a `moveToken` fires
 *   before the document holds the destination)
 * @returns {object[]} TokenDocuments
 */
export function tokensInRegion(region, positions = null) {
  const tokens = region?.parent?.tokens;
  if (!tokens) return [];
  return Array.from(tokens.contents ?? tokens).filter(t => {
    if (!t.actor || isMarkerActor(t)) return false;
    try {
      const at = positions?.get(t.id);
      return Boolean(at ? t.testInsideRegion?.(region, at) : t.testInsideRegion?.(region));
    } catch {
      return false; // a token on another scene or a region that cannot be tested
    }
  });
}

/**
 * Create a Region on a scene.
 * @returns {Promise<object|null>} the created region
 */
export async function createRegion(scene, data) {
  if (typeof scene?.createEmbeddedDocuments !== 'function') return null;
  const created = await scene.createEmbeddedDocuments('Region', [data]);
  return created?.[0] ?? null;
}

/** Delete the given regions from a scene. */
export async function deleteRegions(scene, regions) {
  if (!regions.length || typeof scene?.deleteEmbeddedDocuments !== 'function') return;
  await scene.deleteEmbeddedDocuments('Region', regions.map(r => r.id));
}
