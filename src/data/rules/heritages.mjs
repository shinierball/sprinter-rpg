/**
 * Sprinter RPG - Heritage Registry
 *
 * A race's heritage is a lowercase registry id (`earth`, `alien`, `pet`) stored in `system.heritage`, plus a derived
 * `heritage.<id>` tag (never stored), so a class can `require` a heritage. `CONFIG.COG.heritages` is the same keyed object,
 * so a module registers its own heritage (`registerHeritage`, or `ContentRegistry.registerHeritage`, which also registers
 * the tag).
 *
 * Pure module: imports nothing above it, because `derived-tags.mjs` imports it.
 *
 * A definition is `{ id, label, group, order, pill?, note?, perk?, creator?, companion? }`:
 *   label, group, pill: lang keys, or plain text from a module (label is the sheet option, group the race dropdown group,
 *     pill the Race Creator button)
 *   note: the plain text the Race Creator appends to a race's description
 *   perk: `{ id, name, description, category }`, the 0-cost receipt line in the Race Creator
 *   creator: true offers it as a pill in the Race Creator
 *   companion: true marks the group that `companion.pet` races join
 */
import { firstScalar } from '../../utils/first-scalar.mjs';

export const DEFAULT_HERITAGE = 'earth';
export const HERITAGE_TAG_PREFIX = 'heritage.';

/** The note a Silver Earth Box origin appends: a race of Earth heritage, and an Earth class. */
export const SILVER_EARTH_NOTE = 'Silver Earth Box, with a hobby skill potion inside';
const ALIEN_NOTE = 'Off-World Fanbase Popularity (Home-Planet Audience Appeal)';

const ID_PATTERN = /^[a-z][a-z0-9_.-]*$/;

/** The heritage registry keyed by id; `CONFIG.COG.heritages` is this object. */
export const HERITAGES = {};

const SEEDED_HERITAGES = [
  {
    id: 'earth', order: 1, creator: true, icon: 'fa-earth-americas',
    label: 'COG.Heritage.earth.label', group: 'COG.Heritage.earth.group', pill: 'COG.Heritage.earth.pill',
    note: SILVER_EARTH_NOTE,
    perk: {
      id: 'dccitm0000000012',
      name: 'Silver Earth Box (Hobby Skill Potion)',
      category: 'Earth Heritage',
      description: 'A Silver Earth Box with a hobby skill potion inside (3 Ranks in a hobby skill), and every Earth Class is open to you.'
    }
  },
  {
    id: 'alien', order: 2, creator: true, icon: 'fa-rocket',
    label: 'COG.Heritage.alien.label', group: 'COG.Heritage.alien.group', pill: 'COG.Heritage.alien.pill',
    note: ALIEN_NOTE,
    perk: {
      id: 'alien_offworld_fanbase',
      name: 'Off-World Fanbase Popularity',
      category: 'Alien Heritage',
      description: 'Audiences back on your home planet are watching, which opens unusual ways to gain Popularity and AI favor.'
    }
  },
  {
    id: 'pet', order: 3, companion: true,
    label: 'COG.Heritage.pet.label', group: 'COG.Heritage.pet.group', pill: 'COG.Heritage.pet.label'
  }
];

/** The registry in use: the one on `CONFIG.COG.heritages` when set, else the module's own. */
function liveRegistry() {
  return globalThis.CONFIG?.COG?.heritages ?? HERITAGES;
}

const localize = (text) => globalThis.game?.i18n?.localize?.(text) ?? text;

/** Why a definition is not a heritage, or '' when it is valid. */
export function heritageDefProblem(def) {
  if (!def || typeof def !== 'object') return 'the definition is not an object';
  if (typeof def.id !== 'string' || !ID_PATTERN.test(def.id)) return 'the id is not a valid heritage id';
  if (typeof def.label !== 'string' || !def.label.trim()) return 'a label is required';
  if (def.order !== undefined && !Number.isFinite(Number(def.order))) return 'order must be a number';
  return '';
}

function normalizeHeritageDef(def) {
  const text = (v) => (typeof v === 'string' && v.trim() ? v.trim() : '');
  const perk = def.perk && typeof def.perk === 'object' && text(def.perk.name)
    ? {
        id: text(def.perk.id) || `${def.id}_heritage`,
        name: text(def.perk.name),
        category: text(def.perk.category) || text(def.label),
        description: typeof def.perk.description === 'string' ? def.perk.description : ''
      }
    : null;
  return {
    id: def.id,
    label: def.label.trim(),
    group: text(def.group) || def.label.trim(),
    pill: text(def.pill) || def.label.trim(),
    order: def.order === undefined ? 100 : Number(def.order),
    icon: text(def.icon) || 'fa-star',
    note: text(def.note),
    perk,
    creator: def.creator === true,
    companion: def.companion === true
  };
}

/**
 * Register (or replace) a heritage. A bad definition is refused with a warning.
 * @param {object} def see the module header
 * @returns {boolean} whether the heritage was registered
 */
export function registerHeritage(def) {
  const problem = heritageDefProblem(def);
  if (problem) {
    console.warn(`Sprinter RPG | registerHeritage refused "${def?.id}": ${problem}.`);
    return false;
  }
  liveRegistry()[def.id] = normalizeHeritageDef(def);
  return true;
}

for (const def of SEEDED_HERITAGES) HERITAGES[def.id] = normalizeHeritageDef(def);

/** Registry entries sorted by `order`, then id. */
export function heritagesInOrder() {
  return Object.values(liveRegistry()).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

/**
 * The id a stored value means (CONTRIBUTING §4): first of an array or comma list, trimmed and lowercased. Blank is the
 * default heritage; an unregistered id is kept as it is.
 * @param {*} raw
 * @returns {string}
 */
export function sanitizeHeritageId(raw) {
  const val = firstScalar(raw);
  const text = String(val).trim().toLowerCase();
  return text || DEFAULT_HERITAGE;
}

/** The registered entry for a stored value, or undefined. */
export function getHeritage(raw) {
  const id = sanitizeHeritageId(raw);
  return Object.hasOwn(liveRegistry(), id) ? liveRegistry()[id] : undefined;
}

/** `heritage.<id>` */
export function heritageTag(id) {
  return `${HERITAGE_TAG_PREFIX}${id}`;
}

/** The label of a heritage, localized; `<id> (Custom)` when the registry lacks it. */
export function heritageLabel(raw) {
  const id = sanitizeHeritageId(raw);
  const entry = getHeritage(id);
  return entry ? localize(entry.label) : `${id} ${customWord()}`;
}

function customWord() {
  const text = localize('COG.Heritage.custom');
  return text === 'COG.Heritage.custom' ? '(Custom)' : text;
}

/** The sheet select: `{ value, label, selected }` per heritage in order; a stored unregistered id is kept as "(Custom)". */
export function heritageOptions(current) {
  const cur = sanitizeHeritageId(current);
  const out = heritagesInOrder().map(h => ({ value: h.id, label: localize(h.label), selected: h.id === cur }));
  if (!getHeritage(cur)) out.push({ value: cur, label: heritageLabel(cur), selected: true });
  return out;
}

/** The race dropdown groups `{ id, label, companion }` in order; the companion group first when asked. */
export function heritageGroups({ companionFirst = false } = {}) {
  const groups = heritagesInOrder().map(h => ({ id: h.id, label: localize(h.group), companion: h.companion === true }));
  if (!companionFirst) return groups;
  return [...groups.filter(g => g.companion), ...groups.filter(g => !g.companion)];
}

/** The id of the group `companion.pet` races join: the first registered `companion: true` heritage, else `pet`. */
export function companionHeritageId() {
  return heritagesInOrder().find(h => h.companion)?.id ?? 'pet';
}

/** The Race Creator pills `{ id, label, icon, selected }`: every `creator: true` entry, plus the current id when it is not one. */
export function heritagePills(current) {
  const cur = sanitizeHeritageId(current);
  const pills = heritagesInOrder().filter(h => h.creator).map(h => ({
    id: h.id, label: localize(h.pill), icon: h.icon, selected: h.id === cur
  }));
  if (!pills.some(p => p.id === cur)) {
    const entry = getHeritage(cur);
    pills.push({ id: cur, label: entry ? localize(entry.pill) : heritageLabel(cur), icon: entry?.icon ?? 'fa-star', selected: true });
  }
  return pills;
}
