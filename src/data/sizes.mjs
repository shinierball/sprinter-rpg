/**
 * Sprinter RPG - Creature Size Registry
 *
 * A creature's size is a lowercase registry id (`medium`) stored in every size field. The registry holds the ordered
 * number, the label, the token size and the Race Creator cost. Sizes are compared as numbers. `CONFIG.COG.sizes` is the
 * same keyed object, so a module registers its own size (`registerSize`, or `ContentRegistry.registerSize`).
 *
 * Blank is not an id. A race stores `''` for "no size change"; every reader of a race's size sanitizes it and tests for
 * `''` before any lookup, because `getSizeInfo('')` is the Medium fallback.
 */
import { firstScalar } from '../utils/first-scalar.mjs';

export const DEFAULT_SIZE = 'medium';

const ID_PATTERN = /^[a-z][a-z0-9_.-]*$/;
const NO_CHANGE_KEY = 'COG.Size.noChange';

/** The ordered size registry keyed by id; `CONFIG.COG.sizes` is this object. */
export const CREATURE_SIZES = {};

/** The medium entry as a frozen copy, so a module that removes `medium` cannot break the fallback. */
export const FALLBACK_SIZE = Object.freeze({
  id: DEFAULT_SIZE, size: 4, label: 'COG.Size.medium', token: 1, raceCost: 0, racePill: true, junk: 32
});

const SEEDED_SIZES = [
  { id: 'tiny', size: 1, label: 'COG.Size.tiny', token: 1, raceCost: 3, junk: 1 },
  { id: 'small', size: 2, label: 'COG.Size.small', token: 1, raceCost: 3, junk: 4 },
  { id: 'petite', size: 3, label: 'COG.Size.petite', token: 1, raceCost: 0, junk: 16 },
  { id: 'medium', size: 4, label: 'COG.Size.medium', token: 1, raceCost: 0, junk: 32 },
  { id: 'large', size: 5, label: 'COG.Size.large', token: 2, raceCost: 3, junk: 64 },
  { id: 'huge', size: 6, label: 'COG.Size.huge', token: 3, raceCost: 3, junk: 128 },
  { id: 'colossal', size: 7, label: 'COG.Size.colossal', token: 3, raceCost: 3, junk: 256, racePill: false },
  { id: 'gargantuan', size: 8, label: 'COG.Size.gargantuan', token: 3, raceCost: 3, junk: 512, racePill: false }
];

/** The registry in use: the one on `CONFIG.COG.sizes` when set, else the module's own. */
function liveRegistry() {
  return globalThis.CONFIG?.COG?.sizes ?? CREATURE_SIZES;
}

/** Why a definition is not a size, or '' when it is valid (the number rule needs the registry, so `registerSize` checks it). */
export function sizeDefProblem(def) {
  if (!def || typeof def !== 'object') return 'the definition is not an object';
  if (typeof def.id !== 'string' || !ID_PATTERN.test(def.id)) return 'the id is not a valid size id';
  if (!Number.isFinite(Number(def.size)) || !(Number(def.size) > 0)) return 'size must be a number above 0';
  if (typeof def.label !== 'string' || !def.label.trim()) return 'a label is required';
  if (def.token !== undefined && !(Number(def.token) >= 1)) return 'token must be 1 or more';
  if (def.raceCost !== undefined && !Number.isFinite(Number(def.raceCost))) return 'raceCost must be a number';
  if (def.junk !== undefined && !(Number.isFinite(Number(def.junk)) && Number(def.junk) >= 0)) return 'junk must be a number, 0 or more';
  return '';
}

/** Normalize a valid definition to the stored entry shape. */
export function normalizeSizeDef(def) {
  return {
    id: def.id,
    size: Number(def.size),
    label: def.label.trim(),
    token: def.token === undefined ? 1 : Math.floor(Number(def.token)),
    raceCost: def.raceCost === undefined ? 0 : Number(def.raceCost),
    racePill: def.racePill !== false,
    // Misc. Junk a plain item of this size costs to craft (Table 43); absent on a module size that sets none (crafting then charges size squared).
    ...(def.junk === undefined ? {} : { junk: Math.floor(Number(def.junk)) })
  };
}

/**
 * Register (or replace) a size. A bad definition, or a number another id already has, is refused with a warning.
 * @param {{ id: string, size: number, label: string, token?: number, raceCost?: number, racePill?: boolean, junk?: number }} def
 * @returns {boolean} whether the size was registered
 */
export function registerSize(def) {
  const refuse = (why) => {
    console.warn(`Sprinter RPG | registerSize refused "${def?.id}": ${why}.`);
    return false;
  };
  const problem = sizeDefProblem(def);
  if (problem) return refuse(problem);
  const registry = liveRegistry();
  const entry = normalizeSizeDef(def);
  for (const other of Object.values(registry)) {
    if (other.id !== entry.id && other.size === entry.size) return refuse(`size ${entry.size} already belongs to "${other.id}"`);
  }
  registry[entry.id] = entry;
  return true;
}

for (const def of SEEDED_SIZES) CREATURE_SIZES[def.id] = normalizeSizeDef(def);

/** Registry entries sorted by their number. */
export function sizesInOrder() {
  return Object.values(liveRegistry()).sort((a, b) => a.size - b.size);
}

/**
 * The id a stored value means. First of an array or comma list, trimmed and lowercased; `''` stays `''`; a number (or a
 * numeric string) maps to the id that has that number; an unregistered id is kept as it is.
 * @param {*} raw
 * @returns {string}
 */
export function sanitizeSizeId(raw) {
  const val = firstScalar(raw);
  const text = String(val).trim().toLowerCase();
  if (text === '') return '';
  if (/^\d+(\.\d+)?$/.test(text)) {
    const byNumber = sizesInOrder().find(s => s.size === Number(text));
    if (byNumber) return byNumber.id;
  }
  return text;
}

/**
 * The registry entry for an id (any case) or a number. Blank, missing or unknown reads as the Medium fallback. Never a substring.
 * @param {*} input
 * @returns {{ id: string, size: number, label: string, token: number, raceCost: number, racePill: boolean }}
 */
export function getSizeInfo(input) {
  const id = sanitizeSizeId(input);
  const registry = liveRegistry();
  return (id && Object.hasOwn(registry, id) ? registry[id] : null) ?? FALLBACK_SIZE;
}

const localize = (key) => globalThis.game?.i18n?.localize?.(key) ?? key;

/** A label as text: a lang key is localized; a key with no translation loaded shows the id, capitalized. */
function entryName(info) {
  const text = localize(info.label);
  if (text !== info.label || !info.label.startsWith('COG.Size.')) return text;
  return info.id.charAt(0).toUpperCase() + info.id.slice(1);
}

function isRegistered(id) {
  return Object.hasOwn(liveRegistry(), id);
}

function isBlank(input) {
  return input !== null && input !== undefined && sanitizeSizeId(input) === '';
}

/** Localized label of a size ("Medium"). A blank value is the "No change" label, never Medium; an id the registry lacks shows as stored. */
export function sizeName(input) {
  if (isBlank(input)) return localize(NO_CHANGE_KEY);
  const id = sanitizeSizeId(input);
  if (id && !isRegistered(id) && id !== DEFAULT_SIZE) return id;
  return entryName(getSizeInfo(id));
}

/** "Medium (4)"; blank is the "No change" label; an id the registry lacks shows as stored. */
export function sizeText(input) {
  if (isBlank(input)) return localize(NO_CHANGE_KEY);
  const id = sanitizeSizeId(input);
  if (id && !isRegistered(id) && id !== DEFAULT_SIZE) return id;
  const info = getSizeInfo(id);
  return `${entryName(info)} (${info.size})`;
}

/** "4 Medium", the label a select and `attributes.sizeLabel` show. */
export function sizeLabel(input) {
  const info = getSizeInfo(input);
  return `${info.size} ${entryName(info)}`;
}

/**
 * The one select builder: `{ value, size, label: "4 Medium", selected }` per size, in order. `blankLabel` (a lang key) adds a
 * blank first option for a race. A stored id the registry lacks is kept as a "(Custom)" option.
 */
export function sizeOptions(current, { blankLabel } = {}) {
  const cur = sanitizeSizeId(current);
  const registry = liveRegistry();
  const out = [];
  if (blankLabel) out.push({ value: '', size: null, label: localize(blankLabel), selected: cur === '' });
  for (const info of sizesInOrder()) {
    out.push({ value: info.id, size: info.size, label: `${info.size} ${entryName(info)}`, selected: info.id === cur });
  }
  if (cur && !Object.hasOwn(registry, cur)) {
    const custom = localize('COG.Size.custom');
    out.push({ value: cur, size: null, label: `${cur} ${custom === 'COG.Size.custom' ? '(Custom)' : custom}`, selected: true });
  }
  return out;
}

/** The Race Creator pills: blank first (0 BP), then every entry that shows a pill: `{ value, label, cost, selected }`. */
export function raceSizeOptions(current) {
  const cur = sanitizeSizeId(current);
  return [
    { value: '', label: localize(NO_CHANGE_KEY), cost: 0, selected: cur === '' },
    ...sizesInOrder().filter(s => s.racePill !== false).map(s => ({
      value: s.id, label: `${s.size} ${entryName(s)}`, cost: s.raceCost ?? 0, selected: s.id === cur
    }))
  ];
}

/** Race Creator cost of a size id; blank or unknown is 0. */
export function raceSizeCost(id) {
  const key = sanitizeSizeId(id);
  const registry = liveRegistry();
  if (!key || !Object.hasOwn(registry, key)) return 0;
  return Number(registry[key].raceCost) || 0;
}

/**
 * The size number of an actor: its derived `attributes.sizeNumber`, else the normalized `attributes.size`
 * (a missing size reads as Medium, like the rest of the system).
 * @param {object|null} actor
 * @returns {number}
 */
export function actorSizeNumber(actor) {
  const attrs = actor?.system?.attributes;
  const n = Number(attrs?.sizeNumber);
  return Number.isFinite(n) && n >= 1 ? n : getSizeInfo(attrs?.size).size;
}

/**
 * The prototype token width and height (grid squares per side) for a creature size. Both mob builders (the Mob Creator
 * payload and the compendium shaper) size tokens with this.
 * @param {*} input - an id or number
 * @returns {number}
 */
export function mobTokenSize(input) {
  return getSizeInfo(input).token;
}
