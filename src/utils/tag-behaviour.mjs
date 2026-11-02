/**
 * Tag behaviour: a tag definition may carry `rows` (item row
 * JSON, applied as if on the item that carries the tag) and `flags` (bare ids read by `hasRuleFlag`). This leaf module
 * holds the behaviour index, the validator, the tag sources `getActiveModifierSources` appends, the rule-flag
 * registry and `hasRuleFlag`. It imports only `tags.mjs`, `tag-query.mjs` and `row-kinds.mjs`; `damage-modifiers.mjs`
 * and every gate import it, never the reverse.
 */
import { TAG_MAP, getCustomTags, getTagDefinition, isValidTag, splitRoleTag, collectActorTags, getItemAllTags, getItemRank, onTagDefinitionsChanged } from '../data/tags.mjs';
import { queryReferences } from './tag-query.mjs';
import { rowKindErrors } from './row-kinds.mjs';
import { SYSTEM_ID } from '../constants.mjs';
import { isBuffSuppressed } from './dispel.mjs';
import { referencedDebuffSources } from './referenced-debuffs.mjs';

/** The row arrays a tag may carry (the open ones, K2). Adding one later is one line. */
export const TAG_ROW_ARRAYS = Object.freeze(['damageModifiers', 'defenseModifiers', 'attackModifiers', 'checkModifiers']);

const MAX_ROWS_PER_ARRAY = 32;
const MAX_FLAGS = 16;
const FLAG_ID = /^[A-Za-z][\w.-]*$/;

/** Core flag ids; engine gates name these, never a `rule.*` tag. */
export const RULE_FLAGS = Object.freeze({
  noDamageEffects: 'no-damage-effects',
  requiresWeapon: 'requires-weapon',
  noStandaloneAttack: 'no-standalone-attack',
  noRedirect: 'no-redirect',
  mount: 'mount',
  area: 'area',
  ignoresDr: 'ignores-dr',
  antiPiercing: 'anti-piercing',
  noHands: 'no-hands',
  uncountedAlly: 'uncounted-ally',
  noRanks: 'no-ranks',
  emitsLight: 'emits-light',
  zone: 'zone',
  maneuver: 'maneuver'
});

/** @type {Record<string, { id: string, label: string, hint: string }>} `CONFIG.COG.ruleFlags` is this same object. */
export const RULE_FLAG_DEFS = {};
const flagPriorities = new Map();

/**
 * Declare a rule flag. Modules prefix their ids ('my-module.silent'); the core ids are seeded below.
 * @returns {boolean} whether the declaration took effect (a bad id, no label, or an equal-or-higher priority owner refuses it)
 */
export function registerRuleFlag(def, { priority = 10, provider = 'core' } = {}) {
  if (!def || typeof def !== 'object' || typeof def.id !== 'string' || !FLAG_ID.test(def.id)) {
    console.warn(`Sprinter RPG | registerRuleFlag refused "${def?.id}": the id is not a valid flag id.`);
    return false;
  }
  if (typeof def.label !== 'string' || !def.label.trim()) {
    console.warn(`Sprinter RPG | registerRuleFlag refused "${def.id}": a label is required.`);
    return false;
  }
  const current = flagPriorities.get(def.id);
  if (current !== undefined && current >= priority) {
    console.warn(`Sprinter RPG | registerRuleFlag refused "${def.id}": already registered at an equal or higher priority.`);
    return false;
  }
  flagPriorities.set(def.id, priority);
  RULE_FLAG_DEFS[def.id] = { id: def.id, label: def.label.trim(), hint: typeof def.hint === 'string' ? def.hint : '', provider };
  return true;
}

function seedFlags() {
  registerRuleFlag({ id: RULE_FLAGS.noDamageEffects, label: 'No Damage Effects', hint: 'No Damage Effect or technique may prime the attack.' }, { priority: 0 });
  registerRuleFlag({ id: RULE_FLAGS.requiresWeapon, label: 'Requires a weapon', hint: 'The skill attacks only with a wielded weapon.' }, { priority: 0 });
  registerRuleFlag({ id: RULE_FLAGS.noStandaloneAttack, label: 'No standalone attack', hint: 'Not offered as a standalone attack.' }, { priority: 0 });
  registerRuleFlag({ id: RULE_FLAGS.noRedirect, label: 'Cannot be redirected', hint: 'Intercept and redirect interrupts cannot target this attack.' }, { priority: 0 });
  registerRuleFlag({ id: RULE_FLAGS.area, label: 'Area shape', hint: 'A shape tag carrying this makes the attack an area (adds shape.aoe, offers Evade and a template).' }, { priority: 0 });
  registerRuleFlag({ id: RULE_FLAGS.ignoresDr, label: 'Ignores DR', hint: 'Damage from an attack carrying this ignores Damage Resistance (Armor-Piercing).' }, { priority: 0 });
  registerRuleFlag({ id: RULE_FLAGS.antiPiercing, label: 'Anti-Piercing', hint: 'Armor carrying this keeps its DR against Armor-Piercing damage; armor without it is ignored by Armor-Piercing.' }, { priority: 0 });
  registerRuleFlag({ id: RULE_FLAGS.noHands, label: 'No hands needed', hint: 'The attack occupies no hand and has no wield mode (natural weapons, unarmed strikes).' }, { priority: 0 });
  registerRuleFlag({ id: RULE_FLAGS.uncountedAlly, label: 'Not counted as a crawler', hint: 'A crawler-side combatant carrying this does not count toward a Boss\'s actions per crawler.' }, { priority: 0 });
  registerRuleFlag({ id: RULE_FLAGS.noRanks, label: 'No Ranks', hint: 'Skills carrying this have no Ranks, advancement marks or grinding (core actions every crawler has).' }, { priority: 0 });
  registerRuleFlag({ id: RULE_FLAGS.emitsLight, label: 'Emits light', hint: 'The item is a light source: using, casting or equipping it lights a token (radii default from CONFIG.COG.lightDefaults).' }, { priority: 0 });
  registerRuleFlag({ id: RULE_FLAGS.zone, label: 'Lingering area', hint: 'A placed area carrying this with a lasting duration becomes a zone that pulses its per-round effects at Clean Up.' }, { priority: 0 });
  registerRuleFlag({ id: RULE_FLAGS.maneuver, label: 'Maneuver', hint: 'A situation the attacker opts into per attack; listed under Maneuvers in the Attack Options pop-up.' }, { priority: 0 });
  registerRuleFlag({ id: RULE_FLAGS.mount, label: 'Mount', hint: 'A pet carrying this can be ridden.' }, { priority: 0 });
}
seedFlags();

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * Problems with a tag definition's behaviour. Reported, never thrown; the index keeps the definition and each bad row
 * is inert where it is evaluated.
 * @param {object} def a tag definition
 * @param {{ scaleErrors?: (spec: object) => string[] }} [opts] pass `scaleSpecErrors` to check `scaleBy` too (kept out of
 *   this leaf: `scalars.mjs` imports the engine)
 * @returns {string[]}
 */
export function tagBehaviourErrors(def, { scaleErrors = null } = {}) {
  const errors = [];
  if (!isPlain(def)) return ['definition is not an object'];
  const hasRows = def.rows !== undefined && def.rows !== null;
  const hasFlags = def.flags !== undefined && def.flags !== null;
  if (!hasRows && !hasFlags) return errors;
  if (typeof def.id === 'string' && splitRoleTag(def.id)) errors.push('a role-prefixed tag cannot carry behaviour (it is never carried)');
  if (def.descriptive === true) errors.push('a descriptive tag cannot carry rows or flags (it has no engine reader by definition)');
  if (hasRows) {
    if (!isPlain(def.rows)) errors.push('rows is not an object');
    else {
      for (const [key, list] of Object.entries(def.rows)) {
        if (!TAG_ROW_ARRAYS.includes(key)) { errors.push(`rows.${key} is not a row array a tag may carry`); continue; }
        if (!Array.isArray(list)) { errors.push(`rows.${key} is not an array`); continue; }
        if (list.length > MAX_ROWS_PER_ARRAY) errors.push(`rows.${key} has more than ${MAX_ROWS_PER_ARRAY} rows`);
        list.forEach((row, i) => {
          const at = `rows.${key}[${i}]`;
          if (!isPlain(row)) { errors.push(`${at} is not an object`); return; }
          for (const e of rowKindErrors(key, row)) errors.push(`${at}: ${e}`);
          if (row.disabled !== undefined && typeof row.disabled !== 'boolean') errors.push(`${at}: disabled is not a boolean`);
          if (queryReferences(row.condition, (t) => !isValidTag(t))) errors.push(`${at}: condition names an unregistered tag`);
          if (row.scaleBy && typeof scaleErrors === 'function') for (const e of scaleErrors(row.scaleBy)) errors.push(`${at}: scaleBy ${e}`);
        });
      }
    }
  }
  if (hasFlags) {
    if (!Array.isArray(def.flags) || def.flags.some((f) => typeof f !== 'string' || !f.trim())) errors.push('flags is not an array of non-empty strings');
    else {
      if (def.flags.length > MAX_FLAGS) errors.push(`more than ${MAX_FLAGS} flags`);
      for (const f of def.flags) if (!RULE_FLAG_DEFS[f.trim()]) errors.push(`flag "${f}" is not declared`);
    }
  }
  return errors;
}

// -- Index -------------------------------------------------------------------------------------------------------

let version = 0;
let cache = null;
const warnedFlags = new Set();

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

function cloneRows(rows) {
  const out = {};
  if (!isPlain(rows)) return out;
  for (const key of TAG_ROW_ARRAYS) {
    if (!Array.isArray(rows[key])) continue;
    const list = rows[key].filter(isPlain).map((row) => {
      try { return structuredClone(row); } catch { return { ...row }; }
    });
    if (list.length) out[key] = list;
  }
  return out;
}

function cleanFlags(flags) {
  return Array.isArray(flags) ? [...new Set(flags.filter((f) => typeof f === 'string' && f.trim()).map((f) => f.trim()))] : [];
}

/** The world override map `{ [tagId]: { rows?, flags? } }` (the `tagOverrides` setting; E7.5 writes it). */
export function getTagOverrides() {
  try {
    const saved = globalThis.game?.settings?.get?.(SYSTEM_ID, 'tagOverrides');
    if (isPlain(saved)) return saved;
  } catch {
    // Setting not registered yet.
  }
  return {};
}

const entryOf = (def, provider) => {
  const rows = cloneRows(def?.rows);
  const flags = cleanFlags(def?.flags);
  if (!Object.keys(rows).length && !flags.length) return null;
  return { rows, flags, provider };
};

function build() {
  const map = new Map();
  const put = (id, entry) => {
    if (!entry || splitRoleTag(id)) return;
    map.set(id, deepFreeze({ id, rows: entry.rows, flags: entry.flags, provider: entry.provider }));
  };
  for (const [id, def] of TAG_MAP) put(id, entryOf(def, 'registry'));
  for (const def of getCustomTags()) {
    if (def && typeof def.id === 'string' && !TAG_MAP.has(def.id)) put(def.id, entryOf(def, 'custom'));
  }
  for (const [id, ov] of Object.entries(getTagOverrides())) {
    if (!isPlain(ov) || !getTagDefinition(id)) continue;
    const base = map.get(id);
    const rows = ov.rows !== undefined ? cloneRows(ov.rows) : (base?.rows ?? {});
    const flags = ov.flags !== undefined ? cleanFlags(ov.flags) : (base?.flags ?? []);
    if (!Object.keys(rows).length && !flags.length) map.delete(id);
    else put(id, { rows, flags, provider: 'override' });
  }
  return map;
}

function index() {
  // The signature catches direct mutation of the registries (tests, macros); `invalidateTagBehaviour` is the explicit path.
  const custom = getCustomTags();
  const overrides = getTagOverrides();
  if (!cache || cache.version !== version || cache.size !== TAG_MAP.size || cache.custom !== custom || cache.customLength !== custom.length || cache.overrides !== overrides) {
    const map = build();
    cache = {
      version, size: TAG_MAP.size, custom, customLength: custom.length, overrides, map,
      hasRows: [...map.values()].some((e) => Object.keys(e.rows).length > 0)
    };
  }
  return cache;
}

/** The behaviour of one tag after precedence (override > custom/module/core, R4), or null. */
export function getTagBehaviour(tagId) {
  const entry = index().map.get(typeof tagId === 'string' ? tagId.trim() : tagId);
  if (!entry) return null;
  return { id: entry.id, label: getTagDefinition(entry.id)?.label ?? entry.id, rows: entry.rows, flags: entry.flags, provider: entry.provider };
}

/** Every behaviour tag (the Tag Manager list, the dry run). */
export function listBehaviourTags() {
  return [...index().map.keys()].sort().map((id) => getTagBehaviour(id));
}

export function behaviourVersion() {
  return version;
}

/**
 * A definition changed (R14): bump the version, rebuild the index on next read, and re-prepare the world's actors
 * (static rows such as unconditional DR live in derived data).
 */
export function invalidateTagBehaviour() {
  version += 1;
  cache = null;
  const g = globalThis.game;
  if (!g) return;
  const actors = new Set();
  try {
    for (const a of g.actors ?? []) actors.add(a);
    for (const t of g.scenes?.viewed?.tokens ?? []) if (t?.actor) actors.add(t.actor);
  } catch {
    // Collections not ready.
  }
  for (const actor of actors) {
    try { actor.reset?.(); } catch (e) { console.warn('Sprinter RPG | Could not re-prepare an actor after a tag change', e); }
  }
}
onTagDefinitionsChanged(invalidateTagBehaviour);

/** Tests only: forget the index, the warning memory and any registered module flags. */
export function _resetTagBehaviour() {
  version += 1;
  cache = null;
  warnedFlags.clear();
  for (const id of Object.keys(RULE_FLAG_DEFS)) delete RULE_FLAG_DEFS[id];
  flagPriorities.clear();
  seedFlags();
}

// -- Tag sources -------------------------------------------------------------------------------------------------

const tagsOf = (item) => {
  if (!item) return new Set();
  return item.allTags instanceof Set ? item.allTags : getItemAllTags(item);
};

const itemsOf = (actor) => (Array.from(actor?.items ?? []));

/**
 * The item sources of an actor, with no tag sources: equipped gear, active buffs, active debuffs (owned, and carried by
 * reference), skills, race, class, the active external buff slots, and the context item when it is not already there. Every owned spell is a source (E5.1):
 * a spell's rows are gated by `minRank`/`maxRank` on its Rank and by their own conditions, like a skill's.
 */
export function collectItemSources(actor, ctxItem = null) {
  const sources = [];
  const seenIds = new Set();
  const addSource = (src) => {
    if (!src) return;
    const id = src.id || src._id;
    if (id && seenIds.has(id)) return;
    if (id) seenIds.add(id);
    sources.push(src);
  };
  for (const item of itemsOf(actor)) {
    if (!item) continue;
    const type = item.type;
    if (type === 'gear' && item.system?.equipped) addSource(item);
    else if (type === 'buff' && (item.system?.active ?? true) && !isBuffSuppressed(actor, item)) addSource(item);
    else if (type === 'debuff') { if (item.system?.active !== false) addSource(item); }
    else if (type === 'skill' || type === 'spell' || type === 'race' || type === 'class') addSource(item);
  }
  // Debuffs carried by reference (the condition list, equipped gear's persistent debuffs): their catalog rows count too.
  for (const debuff of referencedDebuffSources(actor)) addSource(debuff);
  const activeBuffs = actor?.getActiveBuffs ? actor.getActiveBuffs() : [];
  for (const buff of activeBuffs) addSource(buff);
  // The context item when not already a source: an unequipped attack item with its own rows, or a spell that is not
  // an owned item (cast from a compendium entry).
  if (ctxItem && ctxItem.type !== 'skill') addSource(ctxItem);
  return sources;
}

/** Deity and sponsor items: identity carriers that are not modifier sources. */
const IDENTITY_ONLY_TYPES = ['deity', 'sponsor'];

/**
 * Append one synthetic source per row-carrying tag the actor carries (spec §4.1). The tags counted are those of the
 * active sources (as if on the item) plus the actor's identity tags. One source per tag (R5): the carrier is the
 * highest-rank item carrying it, else the actor; `carriers` lists all. Flags-only tags never make a source.
 * @param {object} actor
 * @param {Array<object>} sources the item sources (mutated and returned)
 * @returns {Array<object>}
 */
export function appendTagSources(actor, sources) {
  const idx = index();
  if (!idx.hasRows) return sources;
  const carriersByTag = new Map();
  const note = (tag, carrier) => {
    const entry = idx.map.get(tag);
    if (!entry || !Object.keys(entry.rows).length) return;
    if (!carriersByTag.has(tag)) carriersByTag.set(tag, []);
    carriersByTag.get(tag).push(carrier);
  };
  const itemSources = [...sources];
  for (const src of itemSources) for (const t of tagsOf(src)) note(t, src);
  for (const item of itemsOf(actor)) {
    if (item && IDENTITY_ONLY_TYPES.includes(item.type)) for (const t of tagsOf(item)) note(t, item);
  }
  for (const t of collectActorTags(actor, { identityOnly: true })) {
    if (!carriersByTag.has(t)) note(t, actor);
  }
  for (const tag of [...carriersByTag.keys()].sort()) {
    const carriers = carriersByTag.get(tag);
    let carrier = null;
    let best = -Infinity;
    for (const c of carriers) {
      if (c === actor) continue;
      const rank = getItemRank(c);
      if (rank > best) { best = rank; carrier = c; }
    }
    sources.push({
      id: `tag:${tag}`, type: 'tag', tag,
      name: getTagDefinition(tag)?.label ?? tag,
      carrier: carrier ?? actor, carriers,
      system: idx.map.get(tag).rows
    });
  }
  return sources;
}

/** The tags an actor carries for behaviour purposes (R7): active sources' tags plus identity tags, computed live. */
export function actorTagScope(actor) {
  const scope = new Set();
  for (const src of collectItemSources(actor)) for (const t of tagsOf(src)) scope.add(t);
  for (const t of collectActorTags(actor, { identityOnly: true })) scope.add(t);
  return scope;
}

// -- Flags -------------------------------------------------------------------------------------------------------

/** The tag ids whose behaviour lists `flag`. */
export function tagsWithFlag(flag) {
  const out = new Set();
  if (typeof flag !== 'string') return out;
  for (const entry of index().map.values()) if (entry.flags.includes(flag)) out.add(entry.id);
  return out;
}

/**
 * Whether the subject carries a tag whose behaviour lists `flag`. The subject is a tag Set or Array, an Actor (its
 * behaviour scope, R7) or an item. An undeclared flag warns once and still answers; an empty flag set does no tag work.
 * @param {Iterable<string>|object|null} subject
 * @param {string} flag
 * @returns {boolean}
 */
export function hasRuleFlag(subject, flag) {
  if (!subject || typeof flag !== 'string') return false;
  if (!RULE_FLAG_DEFS[flag] && !warnedFlags.has(flag)) {
    warnedFlags.add(flag);
    console.warn(`Sprinter RPG | Rule flag "${flag}" is not declared (registerRuleFlag).`);
  }
  const carrying = tagsWithFlag(flag);
  if (!carrying.size) return false;
  let tags;
  if (subject instanceof Set || Array.isArray(subject)) tags = subject;
  else if (subject.documentName === 'Actor') tags = actorTagScope(subject);
  else tags = tagsOf(subject);
  for (const t of tags) if (carrying.has(t)) return true;
  return false;
}
