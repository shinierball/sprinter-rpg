/**
 * src/data/builders/item-payload.mjs
 * The one normalising entry point for creation payloads.
 *
 * `buildPayload(type, spec)` turns an authoring spec into a
 * document creation payload `{ _id?, name, type, img, system, ... }`. It normalises, it does not compute: no prose
 * parsing, no grant inference. Types with a budget (race, class, mob, personal_space, crawler) keep their builders;
 * those register themselves with `registerPayloadDelegate` and their result continues through the same validation.
 *
 * Never throws on content (CONTRIBUTING rule 2): problems become warnings, collected in `options.warnings` or sent to
 * `console.warn`. Pure: no Foundry globals at import (the DataModel pass reads `CONFIG` only when it runs).
 */

import { getTagDefinition } from '../tag-definitions.mjs';
import { splitRoleTag } from '../tag-vocabulary.mjs';
import { sanitizeLootBox, sanitizeRewardBoxes } from '../loot-box-rows.mjs';
import { grantRowErrors, GRANTED_EFFECT_TYPES } from '../../models/items/grant-validation.mjs';
import { normalizeItemSystemData, RUNTIME_ONLY_SYSTEM_KEYS } from '../../models/items/base-item-model.mjs';
import { fillEnchantmentTemplateIds } from '../../utils/loot/outcome-defaults.mjs';
import { slugifyIdentifier } from '../../utils/identifier.mjs';
import { firstScalar } from '../../utils/first-scalar.mjs';
import { normalizeTransform } from '../../utils/character/transform-rules.mjs';
import { isRedacted, placeholderName, placeholderBase } from '../../sourcery/redacted.mjs';
import { buildRollTablePayload } from './rolltable-payload.mjs';
import { buildJournalPayload } from './journal-payload.mjs';
import { applyTokenDefaults, TOKEN_DEFAULTS } from '../token-defaults.mjs';
import { readSourceStamp, stampSpec } from '../../utils/content-source.mjs';

/** Item document types the builder knows. */
export const PAYLOAD_ITEM_TYPES = Object.freeze([
  'skill', 'spell', 'attack', 'gear', 'buff', 'debuff', 'loot', 'achievement', 'race', 'class', 'deity', 'sponsor', 'space_upgrade'
]);

/** Actor document types the builder knows. */
export const PAYLOAD_ACTOR_TYPES = Object.freeze([
  'crawler', 'pet', 'mercenary', 'mount_vehicle', 'personal_space', 'marker', 'npc', 'mob'
]);

/** Name given when the spec has none. */
export const DEFAULT_NAMES = Object.freeze({
  gear: 'New Equipment',
  weapon: 'New Weapon',
  spell: 'New Spell',
  skill: 'New Skill',
  attack: 'New Attack',
  class: 'New Class',
  race: 'New Race',
  buff: 'New Buff',
  debuff: 'New Debuff',
  loot: 'New Consumable Item',
  achievement: 'New Achievement',
  deity: 'New Deity',
  sponsor: 'New Sponsor',
  space_upgrade: 'New Space Upgrade',
  crawler: 'New Crawler',
  pet: 'New Pet Companion',
  mercenary: 'New Mercenary',
  mount_vehicle: 'New Vehicle',
  personal_space: 'New Space',
  marker: 'New Light',
  npc: 'New NPC',
  mob: 'Unnamed Mob'
});

/** Icon given when the spec has none (every path exists in the Foundry v14 icon manifest). */
export const DEFAULT_ICONS = Object.freeze({
  gear: 'icons/svg/shield.svg',
  weapon: 'icons/svg/sword.svg',
  attack: 'icons/svg/sword.svg',
  spell: 'icons/weapons/wands/wand-gem-blue.webp',
  skill: 'icons/svg/book.svg',
  class: 'icons/svg/book.svg',
  race: 'icons/svg/mystery-man.svg',
  buff: 'icons/svg/aura.svg',
  debuff: 'icons/svg/hazard.svg',
  loot: 'icons/svg/item-bag.svg',
  achievement: 'icons/svg/levels.svg',
  deity: 'icons/svg/sun.svg',
  sponsor: 'icons/svg/coins.svg',
  space_upgrade: 'icons/svg/upgrade.svg',
  crawler: 'icons/svg/mystery-man.svg',
  pet: 'icons/svg/pawprint.svg',
  mercenary: 'icons/svg/mystery-man.svg',
  mount_vehicle: 'icons/svg/walk.svg',
  personal_space: 'icons/svg/house.svg',
  marker: 'icons/svg/light.svg',
  npc: 'icons/svg/mystery-man.svg',
  mob: 'icons/svg/skull.svg'
});

/** Keys whose value is a TagQuery ({ all, any, none }). */
const TAG_QUERY_KEYS = new Set(['condition', 'query', 'appliesToQuery', 'allowedSkillTags', 'requires', 'where']);

/** Budget builders by type, filled by the builder modules themselves (they cannot be imported without Foundry). */
const delegates = new Map();

/**
 * Register the budget builder for a type. `fn(spec)` returns a payload; for `personal_space` it is `fn(owner, spec)`.
 * @param {string} type
 * @param {Function} fn
 */
export function registerPayloadDelegate(type, fn) {
  if (typeof type === 'string' && typeof fn === 'function') delegates.set(type, fn);
}

/** First entry of an array or comma-delimited string, trimmed (CONTRIBUTING §4). */
function sanitizeType(raw) {
  const val = firstScalar(raw);
  return typeof val === 'string' ? val.trim() : '';
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Types whose spec carries a `system` overlay over the budget builder's result. */
const OVERLAY_TYPES = new Set(['race', 'class']);

/** Types whose `system.grantedEffects[]` is compiled entry by entry. */
const GRANTED_EFFECT_OWNERS = new Set(['race', 'class']);

/**
 * Deep-merge a spec's `system` overlay over a budget builder's `system` (3.32). The overlay wins; plain objects merge key
 * by key, arrays and scalars replace. A canonical race or class has rows the point-buy builder cannot express, so its
 * spec is the point-buy spec (name, img, ...) plus `system: { ...the rows... }`.
 */
function mergeOverlay(base, overlay) {
  const out = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    out[key] = isPlainObject(value) && isPlainObject(out[key]) ? mergeOverlay(out[key], value) : value;
  }
  return out;
}

/**
 * Fields a payload always carries, filled where the spec leaves them out. They are the DataModel's own initial
 * values, written here so a creator and `build:packs` store the same document; the pack shapers add nothing of their own.
 * Only a missing value is filled: a blank `duration` or `severity` stays blank, because a redacted spec empties
 * text on purpose and Sourcery fills it back, so "" is pending text, not a missing value.
 * @param {string} docType
 * @param {object} system the payload's `system`, filled in place
 */
function applyTypeDefaults(docType, system) {
  if (docType === 'buff' || docType === 'debuff') {
    if (typeof system.damageType !== 'string') system.damageType = '';
    if (typeof system.duration !== 'string') system.duration = docType === 'buff' ? '1 Hour' : 'Combat';
    if (docType === 'debuff' && typeof system.severity !== 'string') system.severity = 'Minor';
  }
  if (docType === 'mob' && isPlainObject(system.attributes)) {
    const attrs = system.attributes;
    if (typeof attrs.debuffs !== 'string') attrs.debuffs = '';
    if (!isPlainObject(attrs.externalBuffs)) attrs.externalBuffs = {};
    for (const slot of ['buff1', 'buff2', 'buff3']) if (typeof attrs.externalBuffs[slot] !== 'string') attrs.externalBuffs[slot] = '';
    if (attrs.xp === undefined || attrs.xp === null) attrs.xp = 0;
  }
}

/** Collect every tag a system object names, with the path it was found at. */
function collectTagRefs(node, path, out) {
  if (Array.isArray(node)) {
    node.forEach((entry, i) => collectTagRefs(entry, `${path}[${i}]`, out));
    return out;
  }
  if (!isPlainObject(node)) return out;
  for (const [key, value] of Object.entries(node)) {
    const here = path ? `${path}.${key}` : key;
    if (key === 'tags' && Array.isArray(value)) {
      value.forEach((tag, i) => { if (typeof tag === 'string') out.push({ path: `${here}[${i}]`, tag }); });
    } else if (TAG_QUERY_KEYS.has(key) && isPlainObject(value) && ['all', 'any', 'none'].some(k => Array.isArray(value[k]))) {
      for (const k of ['all', 'any', 'none']) {
        (Array.isArray(value[k]) ? value[k] : []).forEach((tag, i) => {
          if (typeof tag === 'string') out.push({ path: `${here}.${k}[${i}]`, tag });
        });
      }
    } else if (key === 'tag' && typeof value === 'string' && node.kind === 'rank_bonus') {
      out.push({ path: here, tag: value });
    } else {
      collectTagRefs(value, here, out);
    }
  }
  return out;
}

/** Whether a tag is registered, custom, an auto-descriptor, or a role prefix wrapping one of those. */
function isKnownTag(tag) {
  const wrapped = splitRoleTag(tag);
  return getTagDefinition(wrapped ? wrapped.tag : tag) !== null;
}

/**
 * Build a creation payload from an authoring spec.
 * @param {string} type document type (or the `weapon` pseudo-type: a gear item with `isWeapon`)
 * @param {object} [spec] partial payload `{ _id?, name?, img?, system?, flags?, items?, folder? }`; budget types take their builder's spec.
 *   A `race` or `class` spec is the point-buy spec plus an optional `system` overlay, deep-merged over the builder's result
 *   (the overlay wins; arrays replace), so a canonical entry the builder cannot express (rows) still compiles.
 * @param {{ warnings?: Array<{path: string, message: string, code: string}>, delegate?: boolean, dataModel?: boolean, normalize?: boolean }} [options]
 *   `warnings`, when an array, collects `{ path, message, code }` (code: tag, grant, type, schema, spec). `delegate: false` treats the spec as a ready payload even
 *   for a budget type (bundled datasets are payloads, not builder specs). `dataModel: false` skips the cleanData pass.
 *   `normalize: false` also skips identifier, crit and row defaults (name, icon and tag checks always run); a caller that
 *   needs a spec's literal output (the 3.32 golden test) uses it. `nested: true` (set for embedded items and granted
 *   effects) skips the per-type field defaults of `applyTypeDefaults`, which belong to the top-level document.
 * @returns {object} the payload; a spec of an unknown type comes back as a copy, unnormalised, with a warning
 */
export function buildPayload(type, spec = {}, options = {}) {
  const warnings = Array.isArray(options?.warnings) ? options.warnings : null;
  const warn = (path, message, code = 'spec') => {
    if (warnings) warnings.push({ path, message, code });
    else console.warn(`Sprinter RPG | ${path}: ${message}`);
  };
  const input = isPlainObject(spec) ? spec : {};

  // 1. Sanitise the type; `weapon` is gear with a weapon slot.
  let docType = sanitizeType(type);
  // RollTables (3.25c S5) and JournalEntries (5.4) have their own builders: no Item/Actor normalisation, tag check or DataModel pass.
  if (docType === 'rolltable') return buildRollTablePayload(input, { warnings });
  if (docType === 'journal') return buildJournalPayload(input, { warnings });
  const weaponPseudo = docType === 'weapon';
  const nameKey = docType;
  if (weaponPseudo) docType = 'gear';
  const isActor = PAYLOAD_ACTOR_TYPES.includes(docType);
  if (!isActor && !PAYLOAD_ITEM_TYPES.includes(docType)) {
    // Never lose content (rule 2): warn and hand the spec back unnormalised, for the caller or the DataModel to refuse.
    warn('type', `unknown document type "${docType}"`, 'type');
    return structuredClone(input);
  }
  const documentName = isActor ? 'Actor' : 'Item';

  // 2. Delegate to the budget builder, when one is registered; its result continues through steps 4 to 8.
  let payload;
  const delegate = options?.delegate === false ? undefined : delegates.get(docType);
  if (delegate) {
    if (docType === 'personal_space') {
      const owner = isPlainObject(input.owner) ? input.owner : {};
      if (!owner.crawlerUuid) warn('owner', 'personal_space needs spec.owner.crawlerUuid');
      payload = delegate({ crawlerUuid: owner.crawlerUuid ?? '', crawlerName: owner.crawlerName ?? '' }, input);
      if (!owner.crawlerUuid && payload?.system) {
        payload.system.ownerUuid = '';
        payload.system.occupantUuids = [];
      }
    } else {
      payload = docType === 'crawler' ? delegate(input, options) : delegate(input);
    }
    payload = structuredClone(payload ?? {});
    payload.type = docType;
    if (input._id && !payload._id) payload._id = input._id;
    // A budget builder's payload replaces the spec, so the spec's own embedded items would be lost: append them to the
    // delegate's (a mob's slots, a space's none) and let step 8 normalise both lists the same way.
    if (Array.isArray(input.items) && input.items.length) {
      payload.items = [...(Array.isArray(payload.items) ? payload.items : []), ...structuredClone(input.items)];
    }
    // Race and class: a canonical entry's `system` overlay wins over the budget builder's result (see mergeOverlay).
    if (OVERLAY_TYPES.has(docType) && isPlainObject(input.system)) {
      payload.system = mergeOverlay(isPlainObject(payload.system) ? payload.system : {}, structuredClone(input.system));
    }
  } else {
    payload = { ...structuredClone(input), type: docType };
  }
  const weaponGear = docType === 'gear' && (weaponPseudo || payload.system?.isWeapon === true);

  // 3. Name.
  if (typeof payload.name !== 'string' || !payload.name.trim()) {
    payload.name = DEFAULT_NAMES[weaponPseudo ? 'weapon' : nameKey] ?? DEFAULT_NAMES[docType] ?? 'New Item';
  }
  // A redacted canon spec has no name of its own: a placeholder the hydrator knows to replace (the flag says
  // so), whatever default a budget builder gave it.
  if (isRedacted(input) && !(typeof input.name === 'string' && input.name.trim())) {
    const base = DEFAULT_NAMES[weaponPseudo ? 'weapon' : nameKey] ?? DEFAULT_NAMES[docType] ?? `New ${docType.charAt(0).toUpperCase()}${docType.slice(1)}`;
    payload.name = placeholderName(placeholderBase(input, base, docType), payload._id ?? input._id);
  }

  // Actors carry the prototype token defaults, as `_preCreate` gives a hand-made one (a compendium import skips that fill).
  if (isActor && options?.normalize !== false && !options?.nested) {
    applyTokenDefaults(payload, input, globalThis.CONFIG?.COG?.tokenDefaults ?? TOKEN_DEFAULTS);
  }

  const system = isPlainObject(payload.system) ? payload.system : {};

  const normalize = options?.normalize !== false;
  const specKeys = new Set(Object.keys(system));
  if (normalize) {
    // Weapon gear gets the hands slot and a 1x crit unless the spec says otherwise; skills and spells get 1x rank crits.
    if (weaponGear) {
      system.isWeapon = true;
      if (!system.slot) system.slot = 'hands';
      if (system.critMultiplier === undefined) system.critMultiplier = 1;
    }
    if (docType === 'skill' || docType === 'spell') {
      if (system.critMultiplierR5 === undefined) system.critMultiplierR5 = 1;
      if (system.critMultiplierR15 === undefined) system.critMultiplierR15 = 1;
    }

    // 4. Identifier: given or the name's slug (items only; actors have none). A redacted spec's name is a placeholder, so no
    // slug is derived from it (the hydrated document would keep `new-achievement-0001`, unlike a dev-module build).
    if (!isActor && !isRedacted(input) && (typeof system.identifier !== 'string' || !system.identifier.trim())) {
      system.identifier = slugifyIdentifier(payload.name);
    }
  }

  // An enchantment template left without an id gets its label's slug, the id the sheet's Add button gives it (7.20n).
  if (normalize && docType === 'loot') {
    fillEnchantmentTemplateIds(system.blueprint?.enchantments);
    if (Array.isArray(system.outcomes)) for (const row of system.outcomes) if (isPlainObject(row)) fillEnchantmentTemplateIds(row.enchantments);
  }

  // 5. Icon.
  if (typeof payload.img !== 'string' || !payload.img.trim()) {
    payload.img = (weaponGear ? DEFAULT_ICONS.weapon : DEFAULT_ICONS[docType]) ?? 'icons/svg/item-bag.svg';
  }

  // Granted effects leave `system` here so the outer tag walk and row pass do not see them: the nested
  // buildPayload below checks their tags once. They go back before the DataModel clean (step 8).
  const grantedEffectsIn = GRANTED_EFFECT_OWNERS.has(docType) && Array.isArray(system.grantedEffects) ? system.grantedEffects : null;
  if (grantedEffectsIn) delete system.grantedEffects;

  // 6. Tags: every tag and every tag inside a TagQuery must be registered (role prefixes wrap a registered tag).
  const seen = new Set();
  for (const { path, tag } of collectTagRefs(system, 'system', [])) {
    if (seen.has(tag)) continue;
    if (!isKnownTag(tag)) {
      seen.add(tag);
      warn(path, `unknown tag "${tag}"`, 'tag');
    }
  }

  // 7. Row defaults (the same normaliser prepareBaseData runs) and grant row validation.
  if (normalize && !options?.nested) applyTypeDefaults(docType, system);
  if (normalize && !isActor) {
    normalizeItemSystemData(docType, system);
    // Runtime-derived keys no schema persists stay out of the payload unless the spec itself named them.
    for (const key of RUNTIME_ONLY_SYSTEM_KEYS) if (!specKeys.has(key)) delete system[key];
  }
  // Loot box arrays (7.3a): tier input may be an array or a comma string; an unknown row kind is kept with a warning.
  if (docType === 'loot' && system.box !== undefined) system.box = sanitizeLootBox(system.box, (path, message) => warn(`system.${path}`, message));
  if (docType === 'achievement' && system.rewardBoxes !== undefined) system.rewardBoxes = sanitizeRewardBoxes(system.rewardBoxes, (path, message) => warn(`system.${path}`, message));
  // An affliction must change the victim into something: at least one form or one added effect.
  if (docType === 'debuff' && system.transform !== undefined && system.transform !== null) {
    const block = normalizeTransform(system.transform);
    if (!block || (block.forms.length === 0 && block.effects.length === 0)) {
      warn('system.transform', 'an affliction changes into nothing: name at least one form or one added effect', 'spec');
    }
  }
  if (Array.isArray(system.grants)) {
    system.grants.forEach((grant, i) => {
      for (const message of grantRowErrors(grant)) warn(`system.grants[${i}]`, message, 'grant');
    });
  }

  if (grantedEffectsIn) {
    system.grantedEffects = [];
    grantedEffectsIn.forEach((entry, i) => {
      if (!isPlainObject(entry) || !GRANTED_EFFECT_TYPES.includes(entry.type)) {
        warn(`system.grantedEffects[${i}]`, `a granted effect must be a buff or a debuff, not "${isPlainObject(entry) ? entry.type : typeof entry}"`, 'grant');
        return;
      }
      const inner = [];
      const built = buildPayload(entry.type, entry, { warnings: inner, delegate: false, dataModel: options?.dataModel, normalize: options?.normalize, nested: true });
      for (const w of inner) warn(`grantedEffects[${i}].${w.path}`, w.message, w.code);
      system.grantedEffects.push({ type: built.type, name: built.name, img: built.img, system: built.system });
    });
  }

  // 8. DataModel clean, when one is registered (runtime and tests). At build:packs there is none; the 3.5 test covers it.
  const Model = options?.dataModel === false ? undefined : globalThis.CONFIG?.[documentName]?.dataModels?.[docType];
  if (typeof Model?.cleanData === 'function') {
    try {
      const cleaned = Model.cleanData(system);
      for (const key of Object.keys(system)) {
        // Keys the row normaliser invented (runtime-only arrays the schema does not persist) drop silently.
        if (specKeys.has(key) && !(key in cleaned)) warn(`system.${key}`, 'is not in the schema and was dropped', 'schema');
      }
      payload.system = cleaned;
    } catch (err) {
      warn('system', `DataModel cleanData failed: ${err?.message ?? err}`, 'schema');
      payload.system = system;
    }
  } else {
    payload.system = system;
  }

  // Embedded items on a spec are normalised the same way (a delegate's own items too: they go through the same validation).
  if (Array.isArray(payload.items)) {
    payload.items = payload.items.map((item, i) => {
      if (!isPlainObject(item)) return item;
      const inner = [];
      const built = buildPayload(item.type, item, { warnings: inner, delegate: false, dataModel: options?.dataModel, normalize: options?.normalize, nested: true });
      for (const w of inner) warn(`items[${i}].${w.path}`, w.message, w.code);
      return built;
    });
  }

  return payload;
}

/**
 * Compile a list of specs (each `{ type, ... }`) into payloads. `strict` turns any warning into a thrown Error naming
 * every problem (used by build:packs); otherwise warnings are returned in `options.warnings` or logged.
 * @param {object[]} specs
 * @param {{ strict?: boolean, warnings?: Array, delegate?: boolean, dataModel?: boolean, normalize?: boolean, buildOptions?: (spec: object) => object }} [options] see `buildPayload` for the delegate, dataModel and normalize; `buildOptions` gives the extra options one spec is built with (a crawler's floor tables and Race and Class definitions)
 * @returns {object[]} payloads in order
 */
export function compileSpecs(specs, options = {}) {
  const collected = [];
  const out = [];
  for (const [i, spec] of (Array.isArray(specs) ? specs : []).entries()) {
    const own = [];
    const built = buildPayload(spec?.type, spec, { warnings: own, delegate: options.delegate, dataModel: options.dataModel, normalize: options.normalize, ...(options.buildOptions?.(spec) ?? {}) });
    const label = `${spec?.name ?? `#${i}`}`;
    for (const w of own) collected.push({ ...w, path: `${label}: ${w.path}` });
    // The source stamp of the spec (7.7c) survives a builder that rebuilds `flags` (mobs, crawlers, spaces), on the
    // document and on each embedded item that has none of its own.
    const stamp = readSourceStamp(spec);
    out.push(stamp ? stampSpec(built, stamp) : built);
  }
  if (options.strict && collected.length) {
    throw new Error(`Spec warnings:\n${collected.map(w => `  ${w.path}: ${w.message}`).join('\n')}`);
  }
  if (Array.isArray(options.warnings)) options.warnings.push(...collected);
  else for (const w of collected) console.warn(`Sprinter RPG | ${w.path}: ${w.message}`);
  return out;
}

/**
 * Compile one `PACK_SPECS` entry (`{ pack, specs, delegate?, dataModel?, normalize? }`).
 * @param {{ specs: object[], delegate?: boolean, dataModel?: boolean, normalize?: boolean }} entry
 * @param {{ strict?: boolean, warnings?: Array }} [options]
 * @returns {object[]}
 */
export function compilePackSpecs(entry, options = {}) {
  return compileSpecs(entry?.specs, { ...options, delegate: entry?.delegate ?? options.delegate, dataModel: entry?.dataModel ?? options.dataModel, normalize: entry?.normalize ?? options.normalize, buildOptions: entry?.buildOptions ?? options.buildOptions });
}
