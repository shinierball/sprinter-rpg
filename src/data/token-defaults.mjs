/**
 * Prototype token defaults for new actors, by actor type. Data, so a module can change it
 * through `CONFIG.COG.tokenDefaults` (same shape). `default` applies to every type; a type's own
 * row is laid over it. Keys are dotted document paths.
 */

/** CONST.TOKEN_DISPLAY_MODES.ALWAYS: the name is visible to everyone. */
const DISPLAY_ALWAYS = 50;

/** Player-side actors see 120 ft (scene grid units); light is left alone, carried lights decide what is lit. */
const PLAYER_SIDE_SIGHT = Object.freeze({
  'prototypeToken.sight.enabled': true,
  'prototypeToken.sight.range': 120
});

export const TOKEN_DEFAULTS = Object.freeze({
  default: Object.freeze({ 'prototypeToken.displayName': DISPLAY_ALWAYS }),
  crawler: PLAYER_SIDE_SIGHT,
  npc: PLAYER_SIDE_SIGHT,
  pet: PLAYER_SIDE_SIGHT,
  mercenary: PLAYER_SIDE_SIGHT
});

function isSet(data, path) {
  if (data?.[path] !== undefined) return true;
  let cur = data;
  for (const part of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return false;
    cur = cur[part];
  }
  return cur !== undefined;
}

function nest(target, path, value) {
  const parts = path.split('.');
  let cur = target;
  for (const part of parts.slice(0, -1)) {
    if (cur[part] === null || typeof cur[part] !== 'object') cur[part] = {};
    cur = cur[part];
  }
  cur[parts.at(-1)] = value;
}

/**
 * The updateSource payload for a new actor: the table's values for its type, minus any path the
 * creation data already sets (only `undefined` counts as unset).
 * @param {string} type
 * @param {object} data creation data
 * @param {object} [table]
 * @returns {Record<string, *>}
 */
export function tokenDefaultUpdates(type, data, table = TOKEN_DEFAULTS) {
  const merged = { ...(table?.default ?? {}), ...(table?.[type] ?? {}) };
  const updates = {};
  for (const [path, value] of Object.entries(merged)) {
    if (!isSet(data, path)) updates[path] = value;
  }
  return updates;
}

/**
 * Lay the type's defaults into a built actor payload's `prototypeToken`. A payload compiled into a pack never passes
 * through `_preCreate` before a world copy is made (a compendium import carries every schema field already filled), so
 * the builder carries them. Values the payload or the spec already set win; a spec's own `prototypeToken` is carried
 * over a builder that dropped it.
 * @param {object} payload built actor payload (mutated)
 * @param {object} [spec] the authoring spec
 * @param {object} [table]
 * @returns {object} the payload
 */
export function applyTokenDefaults(payload, spec = {}, table = TOKEN_DEFAULTS) {
  const token = structuredClone({ ...(spec?.prototypeToken ?? {}), ...(payload.prototypeToken ?? {}) });
  const holder = { prototypeToken: token };
  for (const [path, value] of Object.entries(tokenDefaultUpdates(payload.type, holder, table))) nest(holder, path, value);
  payload.prototypeToken = holder.prototypeToken;
  return payload;
}
