/**
 * src/content/creation-loadouts.mjs
 * Reader for the Level 1 starter loadout options.
 *
 * - weapon: the 18 system weapons, with registered `weapon` entries merged in (a registered id replaces, a new id is appended).
 * - spell / unarmed / potion: the registered entries of that slot; when no provider registered anything for the slot,
 *   the system example for that slot (each copy marked `baseline: true`).
 *
 * References resolve by id (never by name): a spell, unarmed skill or potion is a copy of the catalog document with that
 * identifier or `_id`, else the entry's embedded `fallback` spec built with `buildPayload`.
 */
import { catalogEntries, findCatalogEntry } from './catalog-lookup.mjs';
import { STARTER_WEAPON_LOADOUTS, STARTER_RANK, STARTER_POTION_COUNT, DEFAULT_STARTER_WEAPON } from '../data/creation-loadouts.mjs';
import { EXAMPLE_CREATION_LOADOUTS } from './specs/examples/creation-loadouts.mjs';
import { buildPayload } from '../data/builders/item-payload.mjs';

export { STARTER_RANK, STARTER_POTION_COUNT };

const clone = (value) => (globalThis.foundry?.utils?.deepClone ? globalThis.foundry.utils.deepClone(value) : structuredClone(value));

/** Registered entries of one slot, in registration order. */
function registeredEntries(slot) {
  return catalogEntries('creationLoadouts').filter(entry => entry?.slot === slot && typeof entry.id === 'string' && entry.id);
}

/**
 * Whether a registered spell, unarmed or potion entry can be given: it has an embedded `fallback`, or every document it
 * references is in the catalog (a book entry resolves only after an import).
 */
function loadoutResolves(slot, entry) {
  if (entry.fallback && typeof entry.fallback === 'object') return true;
  if (slot === 'spell') return Boolean(findCatalogEntry('spells', entry.spellIdentifier ?? entry.id));
  if (slot === 'unarmed') return [entry.skillIdentifier, entry.effectIdentifier].every(ref => typeof ref === 'string' && ref && findCatalogEntry('skills', ref));
  if (slot === 'potion') return Boolean(entry.itemRef) && Boolean(findCatalogEntry('items', entry.itemRef));
  return true;
}

/**
 * @param {'weapon'|'spell'|'unarmed'|'potion'} slot
 * @returns {object[]} Options for the slot; examples carry `baseline: true`
 */
export function loadoutOptions(slot) {
  const registered = registeredEntries(slot);
  if (slot === 'weapon') {
    const merged = STARTER_WEAPON_LOADOUTS.map(base => registered.find(entry => entry.id === base.id) ?? base);
    const known = new Set(STARTER_WEAPON_LOADOUTS.map(base => base.id));
    return [...merged, ...registered.filter(entry => !known.has(entry.id))];
  }
  const offered = registered.filter(entry => loadoutResolves(slot, entry));
  if (offered.length) return offered;
  return EXAMPLE_CREATION_LOADOUTS.filter(entry => entry.slot === slot).map(entry => ({ ...entry, baseline: true }));
}

/**
 * Exact id within the slot; for `weapon` the ref is lower-cased first (weapon ids are lower-case).
 * @returns {object|null} null when unknown
 */
export function findLoadout(slot, ref) {
  if (typeof ref !== 'string') return null;
  const key = slot === 'weapon' ? ref.trim().toLowerCase() : ref;
  if (!key) return null;
  return loadoutOptions(slot).find(entry => entry.id === key) ?? null;
}

export function defaultLoadout(slot) {
  return loadoutOptions(slot)[0] ?? null;
}

/** Id of the entry `ref` names in the slot, else the creator's default (Longsword for weapons, else the first option), else ''. */
export function resolveLoadoutId(slot, ref) {
  const preferred = slot === 'weapon' ? findLoadout('weapon', DEFAULT_STARTER_WEAPON) : null;
  return findLoadout(slot, ref)?.id ?? preferred?.id ?? defaultLoadout(slot)?.id ?? '';
}

/**
 * The weapon entry for `ref`, else the generic definition (name = ref or "Weapon", 1d6 Str Slashing).
 * @param {string} ref
 * @returns {object}
 */
export function getStarterWeaponDefinition(ref) {
  const found = findLoadout('weapon', ref);
  if (found) return found;
  return {
    name: ref || 'Weapon',
    toHitStat: 'str',
    damageDice: '1d6',
    damageStat: 'str',
    damageType: 'Slashing',
    effects: 'Standard weapon',
    img: 'icons/svg/sword.svg'
  };
}

/**
 * The text a loadout option shows. An entry's own `label` wins; a spell entry shows the name of the catalog spell it references;
 * an unarmed package with an empty label shows the names of the catalog skill and Damage Effect it references (found by
 * identifier or `_id`, never by name; the bundled placeholder names before a Sourcery import, the imported names after);
 * else the entry's `name`.
 * @param {object} entry
 * @returns {string}
 */
export function loadoutLabel(entry) {
  const own = typeof entry?.label === 'string' ? entry.label.trim() : '';
  if (own) return own;
  if (entry?.slot === 'spell') {
    const spellName = findCatalogEntry('spells', entry.spellIdentifier ?? entry.id)?.name;
    if (spellName) return spellName;
  }
  const names = [entry?.skillIdentifier, entry?.effectIdentifier]
    .map(ref => (typeof ref === 'string' && ref ? findCatalogEntry('skills', ref)?.name : ''))
    .filter(Boolean);
  return names.join(' + ') || entry?.name || '';
}

/** A copy of the catalog document with this identifier or `_id`, ids stripped; null when the catalog lacks it. */
function catalogCopy(kind, ref) {
  const entry = findCatalogEntry(kind, ref);
  if (!entry) return null;
  const copy = clone(entry);
  delete copy._id;
  delete copy.id;
  return copy;
}

/** The entry's embedded fallback built; the system example (`baseline`) is a defined fallback and warns about nothing. */
function builtFallback(type, entry, spec, label, warnings) {
  if (!spec || typeof spec !== 'object') {
    warnings.push(`The catalog has no ${label} and the loadout has no fallback.`);
    return null;
  }
  const built = buildPayload(type, clone(spec), { warnings: [] });
  if (!entry.baseline) warnings.push(`The catalog has no ${label}; its embedded fallback was built.`);
  return built;
}

/**
 * Payload of a starter spell entry (rank left to the caller): the catalog spell, else the entry's fallback.
 * @param {object} entry a `spell` loadout entry
 * @param {string[]} [warnings] receives a message when a catalog document was missing
 * @returns {object|null} null when neither the catalog nor a fallback has it
 */
export function starterSpellPayload(entry, warnings = []) {
  if (!entry) return null;
  const copy = catalogCopy('spells', entry.spellIdentifier ?? entry.id);
  if (copy) return copy;
  return builtFallback('spell', entry, entry.fallback, `spell ${entry.spellIdentifier ?? entry.id}`, warnings);
}

/**
 * Payloads of a starter unarmed package: the skill and its Damage Effect.
 * @param {object} entry an `unarmed` loadout entry
 * @param {string[]} [warnings]
 * @returns {{ skill: object|null, effect: object|null }}
 */
export function starterUnarmedPayloads(entry, warnings = []) {
  const out = { skill: null, effect: null };
  if (!entry) return out;
  for (const [part, ref] of [['skill', entry.skillIdentifier], ['effect', entry.effectIdentifier]]) {
    const copy = catalogCopy('skills', ref);
    if (copy) { out[part] = copy; continue; }
    out[part] = builtFallback('skill', entry, entry.fallback?.[part], `skill ${ref}`, warnings);
  }
  return out;
}

/**
 * Payload of `quantity` starter mana potions: a catalog copy by the entry's `itemRef`, else the entry's fallback. The
 * system example is a defined fallback, so it builds without a warning; a warning means a registered entry could not resolve.
 * @param {number} quantity
 * @param {string[]} [warnings]
 * @returns {object|null} null when no entry resolves
 */
export function starterPotionPayload(quantity, warnings = []) {
  const entry = defaultLoadout('potion');
  if (!entry) { warnings.push('No starter potion is defined.'); return null; }
  const copy = catalogCopy('items', entry.itemRef);
  const payload = copy ? buildPayload('loot', copy, { warnings: [] }) : builtFallback('loot', entry, entry.fallback, entry.name, warnings);
  if (!payload) return null;
  payload.system = { ...(payload.system ?? {}), quantity };
  return payload;
}
