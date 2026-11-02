/**
 * Pure area geometry. What an item's area is, in feet, from its `system.area` fields, the reached rank
 * breaks and the geometry block of its `shape.<id>` tag definition. No canvas, no Foundry documents: the Region builder
 * (`region-shapes.mjs`), placement and zones read this result and turn feet into pixels.
 */
import { resolveAreaShape, COG_TAGS, getCustomTags } from '../data/tags.mjs';
import { resolveReachedRankBreaks } from './rank-breaks.mjs';
import { durationRounds as configRounds } from './durations.mjs';

/** Default width in feet of a line, wall or rectangle when neither the item nor the shape definition names one. */
const FALLBACK_WIDTH = 5;

/**
 * Bare shape id from raw data: array/comma sanitised (CONTRIBUTING §4), `shape.` prefix stripped, lower-cased. An unknown or
 * geometry-less id falls back to `burst` with one console warning per id.
 * @param {*} raw
 * @returns {string}
 */
export function resolveAreaShapeId(raw) {
  return resolveAreaShape(raw).id;
}

const feet = (v) => Math.max(0, Number(v) || 0);

/**
 * The area of an item at its current rank, in feet. Null when the item has no area (`hasArea` false and no size).
 * - `distance`: `radius` + radius bonus, for burst, blast and cone (a size-`radius` shape).
 * - `length` / `width`: `lineLength` + bonus by `lineWidth` + bonus, for line, wall and rect (a size-`length` shape);
 *   width falls back to the shape definition's default.
 * - `angle`: the shape definition's fixed angle (cone 60), else null.
 * - `splash`: `area.splash` + rank-break `splashBonus`, the add-on ring beyond the full-damage area.
 * - `durationRounds`: rounds + `durationBonus` for a `rounds` duration, 0 for instant, null for minutes, hours and
 *   permanent (until dismissed, until the 3.12 time model converts them).
 * @param {object} item an item document or its data
 * @param {{ rank?: number }} [options] the rank to measure at; defaults to the item's own rank (`modifiedRank`,
 *   `totalRank`, then `rank`). Callers holding an actor pass `auraRank(holder, item)`.
 * @returns {{ shape: string, def: object, anchor: 'caster'|'point', regionKind: string, size: 'radius'|'length',
 *   distance: number, length: number, width: number, angle: number|null, splash: number, targetFilter: string,
 *   durationRounds: number|null, isInstant: boolean }|null}
 */
export function resolveAreaGeometry(item, { rank } = {}) {
  const sys = item?.system || item || {};
  const area = sys.area;
  if (!area || typeof area !== 'object') return null;
  if (!area.hasArea && !(Number(area.radius) > 0) && !(Number(area.lineLength) > 0)) return null;

  const { id, def } = resolveAreaShape(area.shape);
  const bonus = resolveReachedRankBreaks(sys, rank).area;
  const defaults = def.defaults || {};
  const size = def.size === 'length' ? 'length' : 'radius';

  const distance = feet(area.radius) + feet(bonus.radiusBonus);
  const length = feet(area.lineLength) + feet(bonus.lineLengthBonus);
  const baseWidth = area.lineWidth === undefined || area.lineWidth === null ? (defaults.width ?? FALLBACK_WIDTH) : area.lineWidth;
  const width = feet(baseWidth) + feet(bonus.lineWidthBonus);
  const splash = feet(area.splash) + feet(bonus.splashBonus);

  const type = sys.durationConfig?.type || 'instant';
  const isInstant = type === 'instant';
  let durationRounds = null;
  if (isInstant) durationRounds = 0;
  else if (type === 'rounds') {
    durationRounds = feet(configRounds(sys.durationConfig)) + feet(resolveReachedRankBreaks(sys, rank).durationBonus);
  }

  return {
    shape: id,
    def,
    anchor: def.anchor === 'point' ? 'point' : 'caster',
    regionKind: def.region,
    size,
    distance,
    length,
    width,
    angle: defaults.angle ?? null,
    splash,
    targetFilter: String(area.targetFilter || 'allies'),
    durationRounds,
    isInstant
  };
}

/**
 * The radius the older callers sized by (a radius shape's distance, else the line length, else 5), kept so the
 * chat buttons keep a single number to print.
 * @param {ReturnType<typeof resolveAreaGeometry>} geometry
 * @returns {number}
 */
export function areaReach(geometry) {
  if (!geometry) return 0;
  return geometry.size === 'length' ? geometry.length : geometry.distance;
}

/**
 * Splash ring geometry: the add-on beyond the full-damage area. The ring is the core shape grown by `splash` feet
 * with the core cut out of it. Null when the item has no splash.
 * @param {ReturnType<typeof resolveAreaGeometry>} geometry
 * @returns {{ kind: 'ring', base: string, regionKind: string, grow: number, innerDistance: number, outerDistance: number|null,
 *   hole: true }|null} `outerDistance` is the grown radius for a radius shape (burst, blast: radius + splash), null
 *   otherwise (the builder grows the core shape by `grow`).
 */
export function resolveSplashRing(geometry) {
  if (!geometry || !(geometry.splash > 0)) return null;
  const isCircle = geometry.regionKind === 'burst' || geometry.regionKind === 'circle';
  return {
    kind: 'ring',
    base: geometry.shape,
    regionKind: geometry.regionKind,
    grow: geometry.splash,
    innerDistance: geometry.distance,
    outerDistance: isCircle ? geometry.distance + geometry.splash : null,
    hole: true
  };
}

/**
 * Every registered shape that carries a geometry block (core `shape.<id>` tags plus module and world tags), in
 * registration order. The sheets build their shape select from this, so a module shape appears without a core patch.
 * @returns {{ id: string, label: string, anchor: 'caster'|'point', size: 'radius'|'length' }[]}
 */
export function listAreaShapes() {
  const seen = new Set();
  const out = [];
  for (const tag of [...COG_TAGS, ...getCustomTags()]) {
    if (!tag?.id || !tag.area || typeof tag.area !== 'object' || !String(tag.id).startsWith('shape.')) continue;
    const id = tag.id.slice('shape.'.length);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, label: tag.label || id, anchor: tag.area.anchor === 'point' ? 'point' : 'caster', size: tag.area.size === 'length' ? 'length' : 'radius' });
  }
  return out;
}
