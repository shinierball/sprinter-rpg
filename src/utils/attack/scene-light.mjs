/**
 * How lit a token's centre is, read from Foundry v14's lighting (the only file that touches it).
 * Anything unexpected (no canvas, token vision off, a missing call, a throw) reads as null: Darkness then stays a
 * manual tick. Points are elevated points `{ x, y, elevation }`; light radii are pixels from the source's origin.
 */

const LIGHT_BANDS = Object.freeze({ bright: 'bright', dim: 'dim', dark: 'dark' });

const asList = (collection) => (collection ? Array.from(collection.values?.() ?? collection) : []);
const contains = (source, point) => source?.shape?.contains?.(point.x, point.y) === true;

/**
 * The band global illumination gives at the point, or null when it is not in force there: the global source is on and
 * the darkness there is inside its range (its `active` ignores the cap). The scene's global light is dim unless the
 * scene sets it bright (v14 `environment.globalLight.bright`; the source then has a bright radius, else 0).
 */
function globalLightBand(point, canvas) {
  const source = canvas.environment?.globalLightSource;
  if (!source || source.active !== true || !contains(source, point)) return null;
  const darkness = canvas.effects.getDarknessLevel(point);
  const { min = 0, max = 1 } = source.data?.darkness ?? {};
  if (!(Number.isFinite(darkness) && darkness >= min && darkness <= max)) return null;
  const brightMode = Number(source.data?.bright) > 0 || canvas.scene?.environment?.globalLight?.bright === true;
  return brightMode ? LIGHT_BANDS.bright : LIGHT_BANDS.dim;
}

/** The band a point light gives: bright inside its bright radius, else dim; null when it does not reach the point. */
function sourceBand(source, point) {
  if (source.active === false || !contains(source, point)) return null;
  const { x, y, bright } = source.data ?? {};
  if (![x, y, bright].every(Number.isFinite)) return LIGHT_BANDS.dim;
  return Math.hypot(point.x - x, point.y - y) <= bright ? LIGHT_BANDS.bright : LIGHT_BANDS.dim;
}

/**
 * @param {object} token a placed token
 * @returns {'bright'|'dim'|'dark'|null} null when the scene cannot say
 */
export function lightBandAt(token) {
  try {
    const canvas = globalThis.canvas;
    const centre = token?.center;
    if (!canvas?.ready || !canvas.effects || !centre || canvas.scene?.tokenVision !== true) return null;
    const point = { x: centre.x, y: centre.y, elevation: Number(token.document?.elevation) || 0 };
    if (asList(canvas.effects.darknessSources).some((s) => s.active !== false && contains(s, point))) return LIGHT_BANDS.dark;
    const fromGlobal = globalLightBand(point, canvas);
    if (fromGlobal === LIGHT_BANDS.bright) return fromGlobal;
    const globalSource = canvas.environment?.globalLightSource;
    let best = fromGlobal ?? LIGHT_BANDS.dark;
    for (const source of asList(canvas.effects.lightSources)) {
      if (source === globalSource) continue;
      const band = sourceBand(source, point);
      if (band === LIGHT_BANDS.bright) return band;
      if (band === LIGHT_BANDS.dim) best = band;
    }
    return best;
  } catch {
    return null;
  }
}
