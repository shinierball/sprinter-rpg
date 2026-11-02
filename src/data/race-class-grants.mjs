/**
 * Sprinter RPG - Race & Class grant helpers
 * The per-kind profile and the stage functions `COGRaceClassApplier.applyKind` runs for a race or a class: grant
 * document resolution, choice resolution, skill / spell grants, the embedded race / class item and its applied record.
 * Stages take the applier as an argument (it is where tests patch `findRace`, `promptChoicesDialog` and the like),
 * so this module never imports it.
 */

import { catalogEntries } from '../content/catalog-lookup.mjs';
import { contentRegistry } from '../content/registry.mjs';
import { SYSTEM_ID } from '../constants.mjs';
import { normalizeBaseDamage } from '../utils/base-damage.mjs';
import { normalizeTiming } from '../utils/timing.mjs';
import { stampCompendiumLink } from './compendium-sync.mjs';

/** The cooldown a merged skill row carries: the row's own when it has one, else the catalog skill's, else none. */
const pickCooldown = (own, fallback) => (normalizeTiming(own).unit ? own : (normalizeTiming(fallback).unit ? fallback : { value: 0, unit: '' }));

/**
 * All Item compendiums: the registry's content packs first by priority (an imported Sourcery pack, then a content
 * module's, then the bundled one), so the hydrated copy of a document wins over the redacted bundled copy. The rest follow,
 * the system's own before others, so a duplicate identifier resolves the same way every time.
 * @returns {object[]}
 */
function itemPacks() {
  const packs = Array.from(globalThis.game?.packs?.values?.() || [])
    .filter(pack => (pack.documentName || pack.metadata?.type || pack.metadata?.entity) === 'Item');
  const idOf = (pack) => String(pack.collection || pack.metadata?.id || '');
  const own = (pack) => idOf(pack).startsWith(`${SYSTEM_ID}.`);
  const rank = new Map(contentRegistry.getPackIdsByPriority().map((id, i) => [id, i]));
  const registered = packs.filter(pack => rank.has(idOf(pack))).sort((a, b) => rank.get(idOf(a)) - rank.get(idOf(b)));
  const rest = packs.filter(pack => !rank.has(idOf(pack)));
  return [...registered, ...rest.filter(own), ...rest.filter(pack => !own(pack))];
}

/**
 * The compendium document whose `system.identifier` is `identifier`, found through each pack's
 * index (never by loading every document).
 * @param {string} identifier
 * @param {string} [expectedType]
 * @returns {Promise<{pack: object, entry: object}|null>}
 */
async function findPackIndexEntry(identifier, expectedType) {
  for (const pack of itemPacks()) {
    let index;
    try {
      index = await pack.getIndex({ fields: ['system.identifier'] });
    } catch (_) {
      index = pack.index;
    }
    const entries = index?.values ? Array.from(index.values()) : Array.from(index || []);
    const entry = entries.find(e => e?.system?.identifier === identifier && (!expectedType || !e.type || e.type === expectedType));
    if (entry) return { pack, entry };
  }
  return null;
}

/** The compendium document whose `system.identifier` is `identifier`; loads only the one matching document. */
async function findPackDocumentByIdentifier(identifier, expectedType) {
  const found = await findPackIndexEntry(identifier, expectedType);
  if (!found) return null;
  return (await found.pack.getDocument?.(found.entry._id ?? found.entry.id)) ?? null;
}

/**
 * The name of the item a grant row references, for display only. Same lookup order as {@link resolveGrantDocument},
 * but a compendium match reads the name from the pack index instead of loading the full document.
 * @param {{uuid?: string, identifier?: string}} grant
 * @param {'skill'|'spell'} [expectedType]
 * @returns {Promise<string>} The name, or '' when nothing resolves
 */
export async function resolveGrantName(grant, expectedType) {
  if (!grant || typeof grant !== 'object') return '';
  const uuid = typeof grant.uuid === 'string' ? grant.uuid.trim() : '';
  if (uuid && typeof globalThis.fromUuidSync === 'function') {
    let hit = null;
    try { hit = globalThis.fromUuidSync(uuid); } catch (_) { /* falls through to the full lookup */ }
    if (hit?.name && (!expectedType || !hit.type || hit.type === expectedType)) return hit.name;
  }
  const identifier = typeof grant.identifier === 'string' ? grant.identifier.trim() : '';
  if (!uuid && identifier) {
    const world = Array.from(globalThis.game?.items ?? []);
    const worldDoc = world.find(i => i?.system?.identifier === identifier && (!expectedType || !i.type || i.type === expectedType));
    if (worldDoc) return worldDoc.name || '';
    const found = await findPackIndexEntry(identifier, expectedType);
    if (found?.entry?.name) return found.entry.name;
  }
  return (await resolveGrantDocument(grant, expectedType))?.name || '';
}

/**
 * Resolves the item document a typed grant row references. Resolution is by reference only; names
 * are never matched.
 * 1. `grant.uuid` through `fromUuid`.
 * 2. `grant.identifier` against `system.identifier` on world items, then each Item compendium's index
 *    (the system's packs first), then the bundled catalogs.
 *
 * @param {{uuid?: string, identifier?: string}} grant
 * @param {'skill'|'spell'} [expectedType]
 * @returns {Promise<object|null>} The resolved item document or catalog entry, or null
 */
export async function resolveGrantDocument(grant, expectedType) {
  if (!grant || typeof grant !== 'object') return null;

  const uuid = typeof grant.uuid === 'string' ? grant.uuid.trim() : '';
  if (uuid && typeof globalThis.fromUuid === 'function') {
    let doc = null;
    try { doc = await globalThis.fromUuid(uuid); } catch (_) { /* unresolvable uuid falls through to identifier */ }
    if (doc && (!expectedType || !doc.type || doc.type === expectedType)) return doc;
  }

  const identifier = typeof grant.identifier === 'string' ? grant.identifier.trim() : '';
  if (!identifier) return null;

  const world = Array.from(globalThis.game?.items ?? []);
  const worldDoc = world.find(i => i?.system?.identifier === identifier && (!expectedType || !i.type || i.type === expectedType));
  if (worldDoc) return worldDoc;

  const packDoc = await findPackDocumentByIdentifier(identifier, expectedType);
  if (packDoc) return packDoc;

  const catalog = expectedType === 'spell' ? catalogEntries('spells') : (expectedType === 'skill' ? catalogEntries('skills') : []);
  return catalog.find(d => d?.system?.identifier === identifier) || null;
}

/** The skill / spell data a grant row creates: `resolvedSys` is the resolved document's system data. */
const GRANT_SYSTEM = {
  skill: (s, resolvedSys) => ({
    ...resolvedSys,
    rank: s.rank ?? resolvedSys.rank ?? 1,
    stat: s.stat || resolvedSys.stat || 'str',
    checkType: s.checkType || resolvedSys.checkType || 'stat',
    checkNote: s.checkNote ?? resolvedSys.checkNote ?? '',
    baseDamage: normalizeBaseDamage(s.baseDamage?.dice ? s.baseDamage : resolvedSys.baseDamage),
    canGainRanks: s.canGainRanks !== undefined ? s.canGainRanks : (resolvedSys.canGainRanks ?? true),
    cooldown: pickCooldown(s.cooldown, resolvedSys.cooldown),
    notes: s.notes || resolvedSys.notes || '',
    upgrades: s.upgrades || resolvedSys.upgrades || '',
    isPassive: Boolean(s.isPassive ?? resolvedSys.isPassive)
  }),
  spell: (sp, resolvedSys) => ({
    ...resolvedSys,
    rank: sp.rank ?? resolvedSys.rank ?? 1,
    stat: sp.stat || resolvedSys.stat || 'int',
    manaCost: (sp.mpCost ? sp.mpCost : resolvedSys.manaCost) ?? 0,
    range: sp.range || resolvedSys.range || 'Self',
    duration: sp.duration || resolvedSys.duration || 'Instantaneous',
    checkType: sp.checkType || resolvedSys.checkType || 'attack',
    description: sp.description || resolvedSys.description || '',
    baseDamage: normalizeBaseDamage(sp.baseDamage?.dice ? sp.baseDamage : resolvedSys.baseDamage)
  })
};

/** Image a granted item gets when neither its resolved document nor its grant row names one. */
const GRANT_DEFAULT_IMG = { skill: 'icons/svg/sword.svg', spell: 'icons/svg/lightning.svg' };

/**
 * What differs between applying a race and applying a class. `find` / `parse` / `remove` take the applier so a test
 * that patches `COGRaceClassApplier.findRace` (and the rest) is seen.
 */
export const RACE_CLASS_KINDS = {
  race: {
    label: 'Race',
    detailsKey: 'race',
    flagKey: 'appliedRace',
    markerFlag: 'isAppliedRace',
    createdKey: 'createdByRace',
    itemType: 'race',
    defaultImg: 'icons/svg/mystery-man.svg',
    hasSize: true,
    find: (applier, id, actor, options) => applier.findRace(id, { actor, ...options }),
    parse: (applier, def) => applier.parseRaceBonuses(def),
    remove: (applier, actor) => applier.removeRace(actor),
    itemSystem: (bonuses) => ({
      heritage: bonuses.heritage,
      size: bonuses.size,
      drBonus: bonuses.drBonus,
      movement: bonuses.movement
    })
  },
  class: {
    label: 'Class',
    detailsKey: 'class',
    flagKey: 'appliedClass',
    markerFlag: 'isAppliedClass',
    createdKey: 'createdByClass',
    itemType: 'class',
    defaultImg: 'icons/svg/book.svg',
    hasSize: false,
    find: (applier, id) => applier.findClass(id),
    parse: (applier, def) => applier.parseClassBonuses(def),
    remove: (applier, actor) => applier.removeClass(actor),
    itemSystem: (bonuses) => ({
      archetypes: bonuses.archetypes,
      drBonus: bonuses.drBonus,
      movement: bonuses.movement
    })
  }
};

/**
 * Whether a race or class apply may open its choice and stat pool dialogs: an explicit `interactive: false` never does
 * (a headless re-apply, a floor simulation), `interactive: true` always does, and with neither it does when a browser
 * document exists and `skipDialog` is not set.
 * @param {{ interactive?: boolean, skipDialog?: boolean }} [options]
 * @returns {boolean}
 */
export function mayOpenDialogs(options = {}) {
  if (options.interactive === false) return false;
  return Boolean(options.interactive || (typeof document !== 'undefined' && !options.skipDialog));
}

/**
 * Resolves the skill / spell choices of a definition: from `options.choices`, from the choices dialog, or the headless
 * defaults.
 * @param {object} applier COGRaceClassApplier
 * @param {object} def
 * @param {object} options
 * @returns {Promise<{chosenSkills: object[], chosenSpells: object[], chosenRankCaps: object[]}|null>} null when cancelled
 */
export async function resolveKindChoices(applier, def, options) {
  const choices = applier.detectChoices(def);
  if (choices.length === 0) return { chosenSkills: [], chosenSpells: [], chosenRankCaps: [] };
  if (options.choices !== undefined) return applier.resolveChoices(def, choices, options.choices);
  if (mayOpenDialogs(options)) {
    const userSelections = await applier.promptChoicesDialog(def, choices, options);
    if (userSelections === null) return null; // User cancelled
    return applier.resolveChoices(def, choices, userSelections);
  }
  // Headless default fallback
  return applier.resolveChoices(def, choices, {});
}

/**
 * Grants each row as an item of `itemType` ('skill' or 'spell') on the actor: an item the actor already has gains
 * the row's rank, any other is created from the resolved document merged with the row.
 * @param {object} actor
 * @param {'race'|'class'} kind
 * @param {'skill'|'spell'} itemType
 * @param {object[]} rows
 * @returns {Promise<object[]>} The applied records for the actor's applied flag
 */
export async function grantKindItems(actor, kind, itemType, rows) {
  const { createdKey } = RACE_CLASS_KINDS[kind];
  const applied = [];
  for (const row of rows) {
    const resolvedDoc = await resolveGrantDocument(row, itemType);
    const grantIdentifier = row.identifier || resolvedDoc?.system?.identifier || '';
    const existing = grantIdentifier
      ? actor.items?.find(i => i.type === itemType && i.system?.identifier === grantIdentifier)
      : null;
    if (existing) {
      const curRank = Number(existing.system?.rank) || 0;
      await existing.update?.({ 'system.rank': curRank + row.rank });
      applied.push({ id: existing.id, name: existing.name, rank: row.rank, preExistingRank: curRank, [createdKey]: false, isChoice: Boolean(row.choiceId) });
      continue;
    }
    const resolvedSys = (typeof resolvedDoc?.toObject === 'function')
      ? resolvedDoc.toObject().system
      : (resolvedDoc?.system ? structuredClone(resolvedDoc.system) : {});
    const itemName = resolvedDoc?.name || row.name || row.identifier;
    const itemImg = resolvedDoc?.img || row.img || GRANT_DEFAULT_IMG[itemType];

    const mergedSystem = GRANT_SYSTEM[itemType](row, resolvedSys);
    if (row.identifier || resolvedDoc?.system?.identifier) {
      mergedSystem.identifier = row.identifier || resolvedDoc?.system?.identifier;
    }
    if (Array.isArray(resolvedDoc?.tags) && !mergedSystem.tags?.length) {
      mergedSystem.tags = [...resolvedDoc.tags];
    }

    if (typeof actor.createEmbeddedDocuments === 'function') {
      const [created] = await actor.createEmbeddedDocuments('Item', [stampCompendiumLink({
        name: itemName,
        type: itemType,
        img: itemImg,
        system: mergedSystem,
        flags: {
          ...(resolvedDoc?.flags ? structuredClone(resolvedDoc.flags) : {}),
          [SYSTEM_ID]: {
            ...(resolvedDoc?.flags?.[SYSTEM_ID] || {}),
            grantedBy: kind,
            isChoice: Boolean(row.choiceId)
          }
        }
      }, resolvedDoc)]);
      applied.push({ id: created?.id, name: itemName, rank: row.rank, preExistingRank: 0, [createdKey]: true, isChoice: Boolean(row.choiceId) });
    }
  }
  return applied;
}

/**
 * What a granted effect's item gets on top of its stored copy: a racial or class trait does not wear off, so it is
 * untimed (and a buff is on). This overrides a catalog buff's own timer. A debuff has no `active` field.
 */
export const GRANTED_EFFECT_STATE = Object.freeze({
  buff: Object.freeze({
    active: true,
    duration: 'Permanent',
    durationConfig: Object.freeze({ type: 'permanent', value: 0, scaleBy: null, endsWithCombat: false, remainingRounds: 0, expiresAt: null })
  }),
  debuff: Object.freeze({
    duration: 'Permanent',
    durationConfig: Object.freeze({ type: 'permanent', value: 0, scaleBy: null, endsWithCombat: false, remainingRounds: 0, expiresAt: null })
  })
});

/**
 * Embeds each of the race or class's `system.grantedEffects[]` (a frozen buff or debuff payload) on the
 * actor, active and untimed, flagged `grantedBy: kind` so removing the race or class removes them. An effect the actor
 * already has (same type and identifier) is left alone and not flagged, so removal leaves it too.
 * @param {object} actor
 * @param {'race'|'class'} kind
 * @param {object} def the race or class definition
 * @returns {Promise<void>}
 */
export async function grantKindEffects(actor, kind, def) {
  const effects = def?.system?.grantedEffects;
  for (const entry of Array.isArray(effects) ? effects : []) {
    const state = GRANTED_EFFECT_STATE[entry?.type];
    if (!state || !entry.system) continue;
    const identifier = entry.system.identifier;
    if (identifier && actor.items?.find(i => i.type === entry.type && i.system?.identifier === identifier)) continue;
    await actor.createEmbeddedDocuments?.('Item', [{
      name: entry.name,
      type: entry.type,
      img: entry.img,
      system: { ...structuredClone(entry.system), ...structuredClone(state) },
      flags: { [SYSTEM_ID]: { grantedBy: kind } }
    }]);
  }
}

/**
 * Embeds the race / class item, carrying the chosen skills and spells.
 * @param {object} actor
 * @param {'race'|'class'} kind
 * @param {{def: object, grantDef: object, bonuses: object, resolvedChoices: object, ruleBreak: boolean}} stage
 * @returns {Promise<string|null|undefined>} The embedded item id
 */
export async function embedKindItem(actor, kind, { def, grantDef, bonuses, resolvedChoices, ruleBreak }) {
  const profile = RACE_CLASS_KINDS[kind];
  let embeddedId = null;
  if (typeof actor.createEmbeddedDocuments === 'function') {
    const [embedded] = await actor.createEmbeddedDocuments('Item', [stampCompendiumLink({
      name: def.name,
      type: profile.itemType,
      img: def.img || profile.defaultImg,
      system: {
        ...(grantDef.system || {}),
        ...profile.itemSystem(bonuses),
        chosenSkills: resolvedChoices.chosenSkills || [],
        chosenSpells: resolvedChoices.chosenSpells || []
      },
      flags: {
        [SYSTEM_ID]: {
          [profile.markerFlag]: true,
          ...(ruleBreak ? { ruleBreak: true } : {})
        }
      }
    }, def)]);
    embeddedId = embedded?.id;
  }
  return embeddedId;
}

/**
 * The applied record the actor's `appliedRace` / `appliedClass` flag stores (what removal reverses).
 * @param {'race'|'class'} kind
 * @param {object} stage
 * @returns {object}
 */
export function appliedKindRecord(kind, { def, bonuses, appliedSkills, appliedSpells, resolvedChoices, embeddedId, originalSize }) {
  return {
    name: def.name,
    stats: bonuses.stats,
    drBonus: bonuses.drBonus,
    movement: bonuses.movement,
    skills: appliedSkills,
    spells: appliedSpells,
    chosenSkills: resolvedChoices.chosenSkills || [],
    chosenSpells: resolvedChoices.chosenSpells || [],
    ...(RACE_CLASS_KINDS[kind].hasSize ? { size: bonuses.size, originalSize } : {}),
    itemId: embeddedId
  };
}
